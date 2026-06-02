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
    upsertExpense: (date: string, actual: number, note?: string) => void;
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

    return {
        goals: [],
        pools,
        equipments: [],
        growthEvents: [],
        expenses: [],
        livingConfig: { ...DEFAULT_LIVING_CONFIG },
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
                const results = distributeSalary(amount, get().pools);
                set(
                    produce((state: HorizonStore) => {
                        state.pools = applyDistribution(state.pools, results);
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

            upsertExpense: (date, actual, note) => {
                set(
                    produce((state: HorizonStore) => {
                        const idx = state.expenses.findIndex(
                            (e) => e.date === date,
                        );
                        const config = state.livingConfig;
                        const d = Number.parseInt(
                            date.split("-")[2] ?? "1",
                            10,
                        );
                        const isRentDay = d === config.rentDayOfMonth;
                        const budget = isRentDay
                            ? config.monthlyRent + config.dailyBudget
                            : config.dailyBudget;

                        if (idx >= 0) {
                            state.expenses[idx].actual = actual;
                            state.expenses[idx].isManual = true;
                            if (note !== undefined)
                                state.expenses[idx].note = note;
                        } else {
                            state.expenses.push({
                                id: v4(),
                                date,
                                budget,
                                actual,
                                isManual: true,
                                note,
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
                salaryDay: state.salaryDay,
                lastDistributedDate: state.lastDistributedDate,
            }),
        },
    ),
);
