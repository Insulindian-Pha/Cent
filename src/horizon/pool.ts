// 资金池分配管道引擎

import type { FundPool, SalaryDistribution } from "./types";

/** 按优先级排序 */
function sortByPriority(pools: FundPool[]): FundPool[] {
    return [...pools].sort((a, b) => a.priority - b.priority);
}

/**
 * 核心引擎：工资到账 → 按优先级流过所有池子 → 返回分配结果
 * 参考 PRD §4 模块 2 的管道设计
 */
export function distributeSalary(
    amount: number,
    pools: FundPool[],
): SalaryDistribution[] {
    const sorted = sortByPriority(pools);
    const results: SalaryDistribution[] = [];
    let remaining = amount;

    for (const pool of sorted) {
        let allocated = 0;

        switch (pool.rule) {
            case "fixed": {
                allocated = Math.min(pool.fixedAmount ?? 0, remaining);
                break;
            }
            case "percent": {
                allocated = Math.round(amount * (pool.percentRate ?? 0));
                if (allocated > remaining) allocated = remaining;
                break;
            }
            case "monthly-list": {
                const total = (pool.monthlyFeeItems ?? []).reduce(
                    (sum, item) => sum + item.amount,
                    0,
                );
                allocated = Math.min(total, remaining);
                break;
            }
            case "residual-factor": {
                // 只有这个池子之前分配完后 remaining > 0 才参与分配
                allocated = Math.round(remaining * (pool.residualFactor ?? 0));
                break;
            }
            case "remainder": {
                // 兜底：前面全部分完，剩多少全归它
                allocated = remaining;
                break;
            }
        }

        allocated = Math.max(0, allocated);
        remaining -= allocated;

        results.push({
            poolId: pool.id,
            poolName: pool.name,
            allocated,
            rule: pool.rule,
            remaining,
        });
    }

    return results;
}

/**
 * 将分配结果应用到池子：更新 balance，初始化子项本月预算
 */
export function applyDistribution(
    pools: FundPool[],
    results: SalaryDistribution[],
): FundPool[] {
    return pools.map((pool) => {
        const result = results.find((r) => r.poolId === pool.id);
        if (!result) return pool;

        const reset: FundPool = {
            ...pool,
            subItems: pool.subItems.map((si) => ({
                ...si,
                spent: 0, // 新月开始，已花归零
            })),
            quotaDeducted: isExpensePool(pool) ? 0 : pool.quotaDeducted,
        };

        if (isExpensePool(pool)) {
            reset.quotaDeducted = result.allocated;
        } else {
            reset.balance = pool.balance + result.allocated;
        }

        return chargeFixedMonthlySubItems(reset);
    });
}

/**
 * 固定月费子项：从池余额扣款并记入 spent（发薪后 / 新建子项时调用）
 */
export function chargeFixedMonthlySubItems(pool: FundPool): FundPool {
    let balance = pool.balance;
    const subItems = pool.subItems.map((si) => {
        if (si.tracking !== "fixed-monthly" || si.budget <= 0) {
            return si;
        }
        const due = si.budget - si.spent;
        if (due <= 0) return si;
        const charge = Math.min(due, balance);
        if (charge <= 0) return si;
        balance -= charge;
        return { ...si, spent: si.spent + charge };
    });
    return { ...pool, balance, subItems };
}

/** 是否存在未扣清的固定月费 */
export function hasPendingFixedMonthlyCharges(pool: FundPool): boolean {
    return pool.subItems.some(
        (si) =>
            si.tracking === "fixed-monthly" &&
            si.budget > 0 &&
            si.spent < si.budget,
    );
}

export interface PoolDeletionResult {
    pools: FundPool[];
    /** 删除的池子名称 */
    removedPoolName: string;
    /** 余额转入的目标池（余额为 0 时为空） */
    releasedTo?: { poolId: string; poolName: string; amount: number };
}

/**
 * 删除资金池：余额转入兜底池（或优先级最高的其他池），不凭空消失
 */
export function resolvePoolDeletion(
    pools: FundPool[],
    poolIdToRemove: string,
): PoolDeletionResult {
    const pool = pools.find((p) => p.id === poolIdToRemove);
    if (!pool) {
        return { pools, removedPoolName: "" };
    }

    const amount = pool.balance;
    let remaining = pools.filter((p) => p.id !== poolIdToRemove);

    if (remaining.length === 0) {
        return { pools: [], removedPoolName: pool.name };
    }

    let releaseTarget: FundPool | undefined;

    if (amount > 0) {
        // 优先转入「兜底」池；若删的就是兜底，则转入优先级最高（数字最小）的其他池
        if (pool.rule !== "remainder") {
            releaseTarget =
                remaining.find((p) => p.rule === "remainder") ??
                [...remaining].sort((a, b) => a.priority - b.priority)[0];
        } else {
            releaseTarget =
                [...remaining]
                    .filter((p) => p.rule !== "remainder")
                    .sort((a, b) => a.priority - b.priority)[0] ?? remaining[0];
        }

        remaining = remaining.map((p) =>
            p.id === releaseTarget!.id
                ? { ...p, balance: p.balance + amount }
                : p,
        );
    }

    const releasePoolId = releaseTarget?.id;
    remaining = remaining.map((p) => ({
        ...p,
        autoFlowTo:
            p.autoFlowTo === poolIdToRemove
                ? (releasePoolId ?? undefined)
                : p.autoFlowTo,
    }));

    return {
        pools: remaining,
        removedPoolName: pool.name,
        releasedTo:
            amount > 0 && releaseTarget
                ? {
                      poolId: releaseTarget.id,
                      poolName: releaseTarget.name,
                      amount,
                  }
                : undefined,
    };
}

/** 从兜底池补款到高优先级池的记录 */
export interface PoolFillTransfer {
    fromPoolId: string;
    fromPoolName: string;
    toPoolId: string;
    toPoolName: string;
    amount: number;
}

/** 固定开销池：从总资金扣款，不在池内留存余额 */
export function isExpensePool(pool: FundPool): boolean {
    return pool.rule === "fixed" || pool.rule === "monthly-list";
}

/** 池子应扣的配额（固定金额 / 月费清单合计） */
export function poolQuota(pool: FundPool): number {
    switch (pool.rule) {
        case "fixed":
            return pool.fixedAmount ?? 0;
        case "monthly-list":
            return (pool.monthlyFeeItems ?? []).reduce(
                (s, i) => s + i.amount,
                0,
            );
        default:
            return 0;
    }
}

/** 本期固定开销是否已扣清 */
export function isQuotaFullyDeducted(pool: FundPool): boolean {
    if (!isExpensePool(pool)) return false;
    const quota = poolQuota(pool);
    return quota > 0 && (pool.quotaDeducted ?? 0) >= quota;
}

/**
 * 高优先级固定开销池：从兜底池扣款（总资金减少），记入 quotaDeducted
 */
export function fillPoolsFromRemainder(pools: FundPool[]): {
    pools: FundPool[];
    transfers: PoolFillTransfer[];
} {
    const next = pools.map((p) => ({ ...p, subItems: [...p.subItems] }));

    // 迁移：旧逻辑误把扣款记入了 balance
    for (const pool of next) {
        if (isExpensePool(pool) && pool.balance > 0) {
            pool.quotaDeducted = (pool.quotaDeducted ?? 0) + pool.balance;
            pool.balance = 0;
        }
    }

    const transfers: PoolFillTransfer[] = [];

    const deductFromRemainder = (amount: number, target: FundPool) => {
        let need = amount;
        const sources = next
            .filter((p) => p.rule === "remainder" && p.balance > 0)
            .sort((a, b) => b.priority - a.priority);

        for (const src of sources) {
            if (need <= 0) break;
            const take = Math.min(need, src.balance);
            if (take <= 0) continue;
            src.balance -= take;
            target.quotaDeducted = (target.quotaDeducted ?? 0) + take;
            need -= take;
            transfers.push({
                fromPoolId: src.id,
                fromPoolName: src.name,
                toPoolId: target.id,
                toPoolName: target.name,
                amount: take,
            });
        }
    };

    for (const pool of sortByPriority(next)) {
        if (!isExpensePool(pool)) continue;
        const quota = poolQuota(pool);
        if (quota <= 0) continue;
        const shortfall = Math.max(0, quota - (pool.quotaDeducted ?? 0));
        if (shortfall > 0) deductFromRemainder(shortfall, pool);
    }

    return {
        pools: next.map((p) => chargeFixedMonthlySubItems(p)),
        transfers,
    };
}

/**
 * 计算池子内部的暂存金额（子项预算 - 已花 = 暂存）
 */
export function getPoolStash(pool: FundPool): number {
    return pool.subItems.reduce((stash, si) => {
        const unspent = si.budget - si.spent;
        return stash + Math.max(0, unspent);
    }, 0);
}

/**
 * 月底结余处理：各池子暂存按 autoFlowTo 流转
 * 返回需要执行的操作列表
 */
export interface MonthEndFlow {
    fromPoolId: string;
    fromPoolName: string;
    toPoolId: string;
    toPoolName: string;
    amount: number;
}

export function resolveMonthEnd(pools: FundPool[]): MonthEndFlow[] {
    const flows: MonthEndFlow[] = [];

    for (const pool of pools) {
        const stash = getPoolStash(pool);
        if (stash <= 0 || !pool.autoFlowTo) continue;

        const targetPool = pools.find((p) => p.id === pool.autoFlowTo);
        if (!targetPool) continue;

        flows.push({
            fromPoolId: pool.id,
            fromPoolName: pool.name,
            toPoolId: targetPool.id,
            toPoolName: targetPool.name,
            amount: stash,
        });
    }

    return flows;
}
