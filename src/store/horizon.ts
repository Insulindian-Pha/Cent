// Horizon 主 Store —— 目标 + 资金池 + 装备 + 成长记录

import { produce } from "immer";
import { v4 } from "uuid";
import { create, type StateCreator } from "zustand";
import { type PersistOptions, persist } from "zustand/middleware";
import { createIndexedDBStorage } from "zustand-indexeddb";
import { createGoal, updateProgress } from "@/horizon/goal";
import {
    applyDistribution,
    chargeFixedMonthlySubItems,
    distributeSalary,
    fillPoolsFromRemainder,
    type MonthEndFlow,
    type PoolDeletionResult,
    type PoolFillTransfer,
    resolveMonthEnd,
    resolvePoolDeletion,
} from "@/horizon/pool";
import type {
    DailyExpense,
    Equipment,
    FundPool,
    Goal,
    GrowthEvent,
    HorizonState,
    LivingConfig,
    PoolSubItem,
    SalaryDistribution,
} from "@/horizon/types";
import { DEFAULT_LIVING_CONFIG, DEFAULT_POOLS } from "@/horizon/types";

/** 按绑定池余额刷新所有目标进度 */
function syncGoalsToPoolBalances(state: HorizonState): void {
    for (const goal of state.goals) {
        const pool = state.pools.find((p) => p.id === goal.boundPoolId);
        if (!pool) continue;
        const { goal: updated } = updateProgress(goal, pool.balance);
        Object.assign(goal, updated);
    }
}

function applyFillToState(state: HorizonState): PoolFillTransfer[] {
    const { pools, transfers } = fillPoolsFromRemainder(state.pools);
    state.pools = pools;
    syncGoalsToPoolBalances(state);
    return transfers;
}

// ─── Store 类型 ───

interface HorizonActions {
    // 发薪日
    doDistributeSalary: (amount: number) => SalaryDistribution[];

    // 资金池
    addPool: (pool: Omit<FundPool, "id" | "balance">) => PoolFillTransfer[];
    rebalancePools: () => PoolFillTransfer[];
    removePool: (id: string) => PoolDeletionResult;
    updatePool: (id: string, patch: Partial<FundPool>) => void;
    reorderPools: (orderedIds: string[]) => void;

    // 子项
    addSubItem: (
        poolId: string,
        item: Omit<PoolSubItem, "id" | "spent">,
    ) => void;
    updateSubItem: (
        poolId: string,
        itemId: string,
        patch: Partial<PoolSubItem>,
    ) => void;
    removeSubItem: (poolId: string, itemId: string) => void;
    tapPerUse: (poolId: string, itemId: string) => void; // "又做了一次"
    chargePoolFixedMonthly: (poolId: string) => void;

    // 目标
    addGoal: (params: Parameters<typeof createGoal>[0]) => {
        goal: Goal;
        pool: FundPool;
    };
    updateGoalAmount: (goalId: string, newAmount: number) => void;
    deleteGoal: (goalId: string) => void;

    // 装备
    addEquipment: (equip: Omit<Equipment, "id">) => void;
    harvestEquipment: (equipId: string) => void;
    updateEquipment: (id: string, patch: Partial<Equipment>) => void;

    // 手动校准
    adjustEstimate: (poolId: string, newBalance: number) => void;

    // 月底处理
    resolveMonthEnd: () => MonthEndFlow[];

    // 成长记录
    addGrowthEvent: (event: Omit<GrowthEvent, "id">) => void;

    // 生活费
    setLivingConfig: (patch: Partial<LivingConfig>) => void;
    ensureDailyDecrement: () => void; // 每日自动扣减生活费池
    linkLivingPool: (poolId: string) => void; // 绑定/切换生活费池
    calibrateLivingBalance: (newBalance: number) => void; // 校准余额
}

type HorizonStore = HorizonState & HorizonActions;

// ─── 初始状态 ⎯

function buildInitialState(): HorizonState {
    const pools: FundPool[] = DEFAULT_POOLS.map((tpl) => ({
        ...tpl,
        id: v4(),
        balance: 0,
        subItems: [],
        monthlyFeeItems: tpl.monthlyFeeItems ?? [],
    }));

    // 自动绑定「生活费」池子
    const livingPool = pools.find((p) => p.name === "生活费");

    return {
        goals: [],
        pools,
        equipments: [],
        growthEvents: [],
        expenses: [],
        livingConfig: {
            ...DEFAULT_LIVING_CONFIG,
            linkedPoolId: livingPool?.id,
        },
        tapEvents: [],
        salaryDay: 1,
        lastDistributedDate: null,
    };
}

// ─── 持久化类型（排除函数） ───

type PersistedState = HorizonState;

type Persist<S, U = S> = (
    config: StateCreator<S>,
    options: PersistOptions<S, U>,
) => StateCreator<S>;

// ─── Store ───

export const useHorizonStore = create<HorizonStore>()(
    (persist as Persist<HorizonStore, PersistedState>)(
        (set, get) => ({
            ...buildInitialState(),

            // ── 发薪日 ──

            doDistributeSalary: (amount: number) => {
                const now = new Date();
                const days = new Date(
                    now.getFullYear(),
                    now.getMonth() + 1,
                    0,
                ).getDate();

                // 生活费池：直接从工资中扣钱入余额（不走管道，避免被 isExpensePool 误杀）
                let remainingForPools = amount;
                const s = get();
                const livingPoolId = s.livingConfig.linkedPoolId;
                const livingAlloc = s.livingConfig.dailyBudget * days;

                if (livingPoolId) {
                    remainingForPools = Math.max(0, amount - livingAlloc);
                }

                // 其余资金池走管道
                const results = distributeSalary(
                    remainingForPools,
                    get().pools.filter((p) => p.id !== livingPoolId),
                );

                set(
                    produce((state: HorizonStore) => {
                        // 生活费池：直接入余额
                        if (livingPoolId) {
                            const lp = state.pools.find(
                                (p) => p.id === livingPoolId,
                            );
                            if (lp) {
                                lp.balance += livingAlloc;
                                lp.fixedAmount = livingAlloc;
                            }
                            // 设为上月最后一天，让 ensureDailyDecrement
                            // 补扣从本月 1 号到今天的全部天数
                            const lastDayPrev = new Date(
                                now.getFullYear(),
                                now.getMonth(),
                                0,
                            );
                            state.livingConfig.lastDecrementDate = `${lastDayPrev.getFullYear()}-${String(lastDayPrev.getMonth() + 1).padStart(2, "0")}-${String(lastDayPrev.getDate()).padStart(2, "0")}`;
                        }

                        // 其余池子：管道分配
                        const otherPools = state.pools.filter(
                            (p) => p.id !== livingPoolId,
                        );
                        const updatedOthers = applyDistribution(
                            otherPools,
                            results,
                        );
                        state.pools = state.pools.map((p) =>
                            p.id === livingPoolId
                                ? p
                                : (updatedOthers.find((u) => u.id === p.id) ??
                                  p),
                        );

                        state.lastDistributedDate = new Date().toISOString();

                        // 自动更新绑定的目标进度
                        for (const goal of state.goals) {
                            const boundPool = state.pools.find(
                                (p) => p.id === goal.boundPoolId,
                            );
                            if (boundPool) {
                                const { goal: updatedGoal } = updateProgress(
                                    goal,
                                    boundPool.balance,
                                );
                                Object.assign(goal, updatedGoal);
                            }
                        }
                    }),
                );
                return results;
            },

            // ── 资金池 CRUD ──

            addPool: (input) => {
                let transfers: PoolFillTransfer[] = [];
                set(
                    produce((state: HorizonStore) => {
                        state.pools.push({
                            ...input,
                            id: v4(),
                            balance: 0,
                            monthlyFeeItems: input.monthlyFeeItems ?? [],
                        });
                        transfers = applyFillToState(state);
                    }),
                );
                return transfers;
            },

            rebalancePools: () => {
                let transfers: PoolFillTransfer[] = [];
                set(
                    produce((state: HorizonStore) => {
                        transfers = applyFillToState(state);
                    }),
                );
                return transfers;
            },

            removePool: (id) => {
                let result: PoolDeletionResult = {
                    pools: get().pools,
                    removedPoolName: "",
                };
                set(
                    produce((state: HorizonStore) => {
                        result = resolvePoolDeletion(state.pools, id);
                        state.pools = result.pools;

                        const releasePoolId = result.releasedTo?.poolId;
                        for (const goal of state.goals) {
                            if (goal.boundPoolId !== id) continue;
                            if (releasePoolId) {
                                goal.boundPoolId = releasePoolId;
                                const boundPool = state.pools.find(
                                    (p) => p.id === releasePoolId,
                                );
                                if (boundPool) {
                                    const { goal: updatedGoal } =
                                        updateProgress(goal, boundPool.balance);
                                    Object.assign(goal, updatedGoal);
                                }
                            }
                        }

                        for (const equip of state.equipments) {
                            if (equip.boundPoolId === id && releasePoolId) {
                                equip.boundPoolId = releasePoolId;
                            }
                        }

                        if (result.releasedTo) {
                            state.growthEvents.push({
                                id: v4(),
                                date: new Date().toISOString(),
                                type: "balance-redirect",
                                summary: `「${result.removedPoolName}」已删除，¥${result.releasedTo.amount.toLocaleString()} 已转入「${result.releasedTo.poolName}」`,
                                amount: result.releasedTo.amount,
                            });
                        }
                    }),
                );
                return result;
            },

            updatePool: (id, patch) => {
                set(
                    produce((state: HorizonStore) => {
                        const pool = state.pools.find((p) => p.id === id);
                        if (pool) Object.assign(pool, patch);
                        applyFillToState(state);
                    }),
                );
            },

            reorderPools: (orderedIds) => {
                set(
                    produce((state: HorizonStore) => {
                        const map = new Map(state.pools.map((p) => [p.id, p]));
                        state.pools = orderedIds
                            .filter((id) => map.has(id))
                            .map((id, i) => ({
                                ...map.get(id)!,
                                priority: i + 1,
                            }));
                        applyFillToState(state);
                    }),
                );
            },

            // ── 子项 CRUD ──

            addSubItem: (poolId, item) => {
                set(
                    produce((state: HorizonStore) => {
                        const pool = state.pools.find((p) => p.id === poolId);
                        if (!pool) return;
                        pool.subItems.push({ ...item, id: v4(), spent: 0 });
                        Object.assign(pool, chargeFixedMonthlySubItems(pool));
                    }),
                );
            },

            updateSubItem: (poolId, itemId, patch) => {
                set(
                    produce((state: HorizonStore) => {
                        const pool = state.pools.find((p) => p.id === poolId);
                        if (!pool) return;
                        const item = pool.subItems.find(
                            (si) => si.id === itemId,
                        );
                        if (item) Object.assign(item, patch);
                        Object.assign(pool, chargeFixedMonthlySubItems(pool));
                    }),
                );
            },

            chargePoolFixedMonthly: (poolId) => {
                set(
                    produce((state: HorizonStore) => {
                        const pool = state.pools.find((p) => p.id === poolId);
                        if (!pool) return;
                        Object.assign(pool, chargeFixedMonthlySubItems(pool));
                    }),
                );
            },

            removeSubItem: (poolId, itemId) => {
                set(
                    produce((state: HorizonStore) => {
                        const pool = state.pools.find((p) => p.id === poolId);
                        if (pool) {
                            pool.subItems = pool.subItems.filter(
                                (si) => si.id !== itemId,
                            );
                        }
                    }),
                );
            },

            tapPerUse: (poolId, itemId) => {
                set(
                    produce((state: HorizonStore) => {
                        const pool = state.pools.find((p) => p.id === poolId);
                        if (!pool) return;
                        const item = pool.subItems.find(
                            (si) => si.id === itemId,
                        );
                        if (
                            !item ||
                            item.tracking !== "per-use" ||
                            !item.unitPrice
                        )
                            return;
                        const remaining =
                            (item.estimatedCount ?? 0) -
                            item.spent / item.unitPrice;
                        if (remaining <= 0) return; // 本月次数已用完
                        item.spent += item.unitPrice;
                        pool.balance -= item.unitPrice;

                        // 记录打卡事件（供日历页面展示）
                        state.tapEvents.push({
                            id: v4(),
                            poolId,
                            itemId,
                            itemName: item.name,
                            poolName: pool.name,
                            amount: item.unitPrice,
                            timestamp: new Date().toISOString(),
                        });
                    }),
                );
            },

            // ── 目标 CRUD ──

            addGoal: (params) => {
                let goal = createGoal(params);
                // 自动创建/绑定梦想基金池
                let boundPool = get().pools.find(
                    (p) => p.id === params.boundPoolId,
                );
                if (!boundPool) {
                    boundPool = {
                        id: params.boundPoolId || v4(),
                        name: `${goal.name}基金`,
                        icon: "🌅",
                        color: "amber",
                        rule: "fixed",
                        fixedAmount: 2000,
                        priority: 4,
                        balance: 0,
                        subItems: [],
                    };
                }
                if (boundPool && boundPool.balance > 0) {
                    goal = updateProgress(goal, boundPool.balance).goal;
                }
                set(
                    produce((state: HorizonStore) => {
                        state.goals.push(goal);
                        if (!state.pools.find((p) => p.id === boundPool!.id)) {
                            state.pools.push(boundPool!);
                        }
                    }),
                );
                return { goal, pool: boundPool };
            },

            updateGoalAmount: (goalId, newAmount) => {
                set(
                    produce((state: HorizonStore) => {
                        const goal = state.goals.find((g) => g.id === goalId);
                        if (!goal) return;
                        const {
                            goal: updated,
                            newlyCompletedImages,
                            newlyCompletedMilestones,
                        } = updateProgress(goal, newAmount);
                        Object.assign(goal, updated);
                        for (const img of newlyCompletedImages) {
                            state.growthEvents.push({
                                id: v4(),
                                date: new Date().toISOString(),
                                type: "milestone",
                                summary: `🏞️ "${img.label}" 点亮！`,
                                amount: img.budget,
                                linkedGoalId: goalId,
                            });
                        }
                        for (const m of newlyCompletedMilestones) {
                            state.growthEvents.push({
                                id: v4(),
                                date: new Date().toISOString(),
                                type: "milestone",
                                summary: `✅ "${m.label}" 完成！`,
                                amount: m.amount,
                                linkedGoalId: goalId,
                            });
                        }
                    }),
                );
            },

            deleteGoal: (goalId) => {
                set(
                    produce((state: HorizonStore) => {
                        state.goals = state.goals.filter(
                            (g) => g.id !== goalId,
                        );
                    }),
                );
            },

            // ── 装备 CRUD ──

            addEquipment: (equip) => {
                set(
                    produce((state: HorizonStore) => {
                        state.equipments.push({ ...equip, id: v4() });
                    }),
                );
            },

            harvestEquipment: (equipId) => {
                set(
                    produce((state: HorizonStore) => {
                        const equip = state.equipments.find(
                            (e) => e.id === equipId,
                        );
                        if (!equip || equip.status !== "want") return;
                        const pool = state.pools.find(
                            (p) => p.id === equip.boundPoolId,
                        );
                        if (!pool || pool.balance < equip.price) return;
                        equip.status = "owned";
                        equip.purchasedDate = new Date().toISOString();
                        pool.balance -= equip.price;
                        state.growthEvents.push({
                            id: v4(),
                            date: new Date().toISOString(),
                            type: "equipment-harvest",
                            summary: `🔧 "${equip.name}" 收割！`,
                            amount: equip.price,
                        });
                    }),
                );
            },

            updateEquipment: (id, patch) => {
                set(
                    produce((state: HorizonStore) => {
                        const equip = state.equipments.find((e) => e.id === id);
                        if (equip) Object.assign(equip, patch);
                    }),
                );
            },

            // ── 手动校准 ──

            adjustEstimate: (poolId, newBalance) => {
                set(
                    produce((state: HorizonStore) => {
                        const pool = state.pools.find((p) => p.id === poolId);
                        if (pool) {
                            pool.balance = newBalance;
                        }
                        for (const goal of state.goals) {
                            if (goal.boundPoolId !== poolId) continue;
                            const { goal: updatedGoal } = updateProgress(
                                goal,
                                newBalance,
                            );
                            Object.assign(goal, updatedGoal);
                        }
                    }),
                );
            },

            // ── 月底处理 ──

            resolveMonthEnd: () => {
                const flows = resolveMonthEnd(get().pools);
                set(
                    produce((state: HorizonStore) => {
                        for (const flow of flows) {
                            const fromPool = state.pools.find(
                                (p) => p.id === flow.fromPoolId,
                            );
                            const toPool = state.pools.find(
                                (p) => p.id === flow.toPoolId,
                            );
                            if (fromPool && toPool) {
                                fromPool.balance -= flow.amount;
                                toPool.balance += flow.amount;
                            }
                        }
                    }),
                );
                return flows;
            },

            // ── 成长记录 ──

            addGrowthEvent: (event) => {
                set(
                    produce((state: HorizonStore) => {
                        state.growthEvents.push({ ...event, id: v4() });
                    }),
                );
            },

            // ── 生活费 ──

            setLivingConfig: (patch) => {
                set(
                    produce((state: HorizonStore) => {
                        Object.assign(state.livingConfig, patch);
                    }),
                );
            },

            // ── 每日自动扣减生活费池 ──
            ensureDailyDecrement: () => {
                const { livingConfig, pools } = get();
                const poolId = livingConfig.linkedPoolId;
                if (!poolId) return;
                const pool = pools.find((p) => p.id === poolId);
                if (!pool || pool.balance <= 0) return;

                const today = new Date();
                const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                const lastDate = livingConfig.lastDecrementDate;

                // 今天已经扣过
                if (lastDate === todayStr) return;

                // 计算需要扣几天
                let daysToDecrement = 1;
                if (lastDate) {
                    const last = new Date(lastDate);
                    const diffMs = today.getTime() - last.getTime();
                    daysToDecrement = Math.min(
                        Math.floor(diffMs / (1000 * 60 * 60 * 24)),
                        31, // 最多补扣一个月
                    );
                }

                const daily = livingConfig.dailyBudget;
                const totalDeduct = Math.min(
                    daily * daysToDecrement,
                    pool.balance,
                );

                if (totalDeduct <= 0) return;

                set(
                    produce((state: HorizonStore) => {
                        const p = state.pools.find((p2) => p2.id === poolId);
                        if (!p) return;
                        p.balance -= totalDeduct;
                        state.livingConfig.lastDecrementDate = todayStr;

                        // 为每一天创建一条自动记录
                        const startDate = lastDate
                            ? new Date(lastDate)
                            : new Date(today);
                        for (let i = 1; i <= daysToDecrement; i++) {
                            const d = new Date(startDate);
                            d.setDate(d.getDate() + i);
                            const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                            // 避免重复
                            if (state.expenses.some((e) => e.date === ds))
                                continue;
                            state.expenses.push({
                                id: v4(),
                                date: ds,
                                budget: daily,
                                actual: daily,
                            });
                        }
                    }),
                );
            },

            // ── 绑定生活费池 ──
            linkLivingPool: (poolId) => {
                set(
                    produce((state: HorizonStore) => {
                        state.livingConfig.linkedPoolId = poolId;
                    }),
                );
            },

            // ── 校准生活费余额 ──
            calibrateLivingBalance: (newBalance) => {
                const { livingConfig, pools } = get();
                const poolId = livingConfig.linkedPoolId;
                if (!poolId) return;
                const pool = pools.find((p) => p.id === poolId);
                if (!pool) return;

                const gap = pool.balance - newBalance;
                const today = new Date();
                const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                const daily = livingConfig.dailyBudget;

                set(
                    produce((state: HorizonStore) => {
                        const p = state.pools.find((p2) => p2.id === poolId);
                        if (!p) return;
                        p.balance = newBalance;

                        // 差额记入今日 expense，日历上可看到补偿了多少
                        const todayActual = daily + gap;
                        const idx = state.expenses.findIndex(
                            (e) => e.date === todayStr,
                        );
                        if (idx >= 0) {
                            state.expenses[idx].actual = Math.max(
                                0,
                                todayActual,
                            );
                        } else {
                            state.expenses.push({
                                id: v4(),
                                date: todayStr,
                                budget: daily,
                                actual: Math.max(0, todayActual),
                            });
                        }
                    }),
                );
            },
        }),
        {
            name: "horizon-store",
            storage: createIndexedDBStorage("horizon", "app-state"),
            partialize: (state) => ({
                goals: state.goals,
                pools: state.pools,
                equipments: state.equipments,
                growthEvents: state.growthEvents,
                expenses: state.expenses,
                livingConfig: state.livingConfig,
                tapEvents: state.tapEvents,
                salaryDay: state.salaryDay,
                lastDistributedDate: state.lastDistributedDate,
            }),
            // Rehydration 完成后仅做数据兼容性检查，
            // rebalance + dailyDecrement 由组件 useEffect 在 hydration 后触发
            onRehydrateStorage: () => {
                return (_state, error) => {
                    if (error || !_state) return;
                    const store = useHorizonStore.getState();

                    // 旧数据兼容：如果生活费池子不存在，创建一个
                    const lpId = store.livingConfig.linkedPoolId;
                    if (!lpId || !store.pools.some((p) => p.id === lpId)) {
                        const days = new Date(
                            new Date().getFullYear(),
                            new Date().getMonth() + 1,
                            0,
                        ).getDate();
                        store.addPool({
                            name: "生活费",
                            icon: "🍜",
                            color: "teal",
                            rule: "residual-factor",
                            residualFactor: 0,
                            fixedAmount: store.livingConfig.dailyBudget * days,
                            priority: 2,
                            subItems: [],
                        });
                        const newPool = useHorizonStore
                            .getState()
                            .pools.find((p) => p.name === "生活费");
                        if (newPool) {
                            store.linkLivingPool(newPool.id);
                        }
                    }
                };
            },
        },
    ),
);
