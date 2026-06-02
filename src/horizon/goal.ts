// 目标 CRUD + 进度计算

import type { Goal, GoalImage, Milestone } from "./types";

/** 生成简单 ID */
function uid(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 单图模式格子总数 */
function singleImageCellCount(goal: Goal): number {
    const fromGrid = (goal.gridCols ?? 4) * (goal.gridRows ?? 4);
    return Math.max(goal.images.length, fromGrid);
}

/** 各格预算之和是否与目标一致（允许 1 元误差） */
function cellBudgetsMatchTarget(goal: Goal): boolean {
    const sum = goal.images.reduce((s, img) => s + img.budget, 0);
    return sum > 0 && Math.abs(sum - goal.targetAmount) <= 1;
}

/**
 * 单格有效预算。
 * 单图模式：始终按 targetAmount ÷ 格子数均分，保证「总进度 50% ≈ 亮 50% 格」。
 * 多图模式：用各图 budget，为 0 时均分目标额。
 */
function effectiveCellBudget(goal: Goal, img: GoalImage): number {
    if (goal.mode === "single-image") {
        const count = singleImageCellCount(goal);
        if (goal.targetAmount > 0 && count > 0) {
            return goal.targetAmount / count;
        }
        return 0;
    }
    if (img.budget > 0) return img.budget;
    if (goal.images.length > 0 && goal.targetAmount > 0) {
        return goal.targetAmount / goal.images.length;
    }
    return 0;
}

/** 根据当前已攒金额推导各格 progress（展示用，不依赖可能过期的持久化值） */
export function deriveImageProgresses(goal: Goal): number[] {
    if (
        (goal.mode === "multi-image" || goal.mode === "single-image") &&
        goal.images.length > 0
    ) {
        return distributeCellProgress(
            goal.images,
            goal,
            goal.currentAmount,
        ).images.map((img) => img.progress);
    }
    return goal.images.map((img) => img.progress);
}

/** 创建/更新前：单图模式把各格 budget 归一化为均分目标额 */
export function normalizeSingleImageBudgets(goal: Goal): GoalImage[] {
    if (goal.mode !== "single-image" || goal.images.length === 0) {
        return goal.images;
    }
    if (cellBudgetsMatchTarget(goal)) return goal.images;
    const perCell = goal.targetAmount / goal.images.length;
    return goal.images.map((img) => ({ ...img, budget: perCell }));
}

/** 文字模式：单步有效金额 */
function effectiveMilestoneBudget(goal: Goal, m: Milestone): number {
    const sum = goal.milestones.reduce((s, x) => s + x.amount, 0);
    const count = goal.milestones.length;
    if (m.amount > 0 && sum > 0 && Math.abs(sum - goal.targetAmount) <= 1) {
        return m.amount;
    }
    if (goal.targetAmount > 0 && count > 0) {
        return goal.targetAmount / count;
    }
    return m.amount > 0 ? m.amount : 0;
}

/** 按已攒金额顺序分配各里程碑 progress (0-1) */
function distributeMilestoneProgress(
    milestones: Milestone[],
    goal: Goal,
    amount: number,
): { milestones: Milestone[]; newlyCompleted: Milestone[] } {
    const newlyCompleted: Milestone[] = [];
    let remaining = amount;
    const updated = milestones.map((m) => {
        const needed = effectiveMilestoneBudget(goal, m);
        if (needed <= 0) {
            return {
                ...m,
                progress: 0,
                completed: false,
                completedDate: undefined,
            };
        }
        if (remaining >= needed) {
            remaining -= needed;
            const wasComplete = m.completed;
            const next: Milestone = {
                ...m,
                progress: 1,
                completed: true,
                completedDate: m.completedDate ?? new Date().toISOString(),
            };
            if (!wasComplete) newlyCompleted.push(next);
            return next;
        }
        const next: Milestone = {
            ...m,
            progress: remaining / needed,
            completed: false,
            completedDate: undefined,
        };
        remaining = 0;
        return next;
    });
    return { milestones: updated, newlyCompleted };
}

/** 根据当前已攒金额推导各里程碑 progress（展示用） */
export function deriveMilestoneProgresses(goal: Goal): number[] {
    if (goal.mode === "text" && goal.milestones.length > 0) {
        return distributeMilestoneProgress(
            goal.milestones,
            goal,
            goal.currentAmount,
        ).milestones.map((m) => m.progress ?? 0);
    }
    return goal.milestones.map((m) => (m.completed ? 1 : 0));
}

/** 按累计金额顺序分配各格 progress (0-1) */
function distributeCellProgress(
    images: GoalImage[],
    goal: Goal,
    amount: number,
): { images: GoalImage[]; newlyCompleted: GoalImage[] } {
    const newlyCompleted: GoalImage[] = [];
    let remaining = amount;
    const updated = images.map((img) => {
        const needed = effectiveCellBudget(goal, img);
        if (needed <= 0) {
            return { ...img, progress: 0 };
        }
        if (remaining >= needed) {
            remaining -= needed;
            const wasComplete = img.progress >= 1;
            const next = { ...img, progress: 1 };
            if (!wasComplete) newlyCompleted.push(next);
            return next;
        }
        const next = { ...img, progress: remaining / needed };
        remaining = 0;
        return next;
    });
    return { images: updated, newlyCompleted };
}

/** 创建目标 */
export function createGoal(params: {
    name: string;
    mode: Goal["mode"];
    targetAmount: number;
    images?: Omit<GoalImage, "progress" | "id">[];
    gridCols?: number;
    gridRows?: number;
    milestones?: Omit<Milestone, "id" | "completed">[];
    boundPoolId: string;
}): Goal {
    const now = new Date().toISOString();
    return {
        id: uid(),
        name: params.name,
        mode: params.mode,
        targetAmount: params.targetAmount,
        currentAmount: 0,
        images:
            params.images?.map((img) => ({ ...img, id: uid(), progress: 0 })) ??
            [],
        gridCols: params.gridCols,
        gridRows: params.gridRows,
        milestones:
            params.milestones?.map((m) => ({
                ...m,
                id: uid(),
                completed: false,
            })) ?? [],
        boundPoolId: params.boundPoolId,
    };
}

/**
 * 更新目标进度，自动计算每张图片/每个里程碑的状态
 * 返回更新后的 goal 和刚完成的图片/里程碑列表
 */
export function updateProgress(
    goal: Goal,
    newAmount: number,
): {
    goal: Goal;
    newlyCompletedImages: GoalImage[];
    newlyCompletedMilestones: Milestone[];
} {
    const updated = { ...goal, currentAmount: newAmount };
    const newlyCompletedImages: GoalImage[] = [];
    const newlyCompletedMilestones: Milestone[] = [];

    // 多图 / 单图模式：按每格预算顺序分配进度
    if (
        (goal.mode === "multi-image" || goal.mode === "single-image") &&
        goal.images.length > 0
    ) {
        const baseImages =
            goal.mode === "single-image"
                ? normalizeSingleImageBudgets(goal)
                : goal.images;
        const { images, newlyCompleted } = distributeCellProgress(
            baseImages,
            goal,
            newAmount,
        );
        updated.images = images;
        newlyCompletedImages.push(...newlyCompleted);
    }

    // 文字模式：按清单顺序依次填满各步骤
    if (goal.mode === "text" && goal.milestones.length > 0) {
        const { milestones, newlyCompleted } = distributeMilestoneProgress(
            goal.milestones,
            goal,
            newAmount,
        );
        updated.milestones = milestones;
        newlyCompletedMilestones.push(...newlyCompleted);
    }

    return { goal: updated, newlyCompletedImages, newlyCompletedMilestones };
}

/** 获取目标的整体进度百分比 (0-1) */
export function getGoalProgress(goal: Goal): number {
    if (goal.targetAmount <= 0) return 0;
    return Math.min(goal.currentAmount / goal.targetAmount, 1);
}

/**
 * 计算"如果每月多放 X 元，可提前多少天完成"
 * @param currentMonthlyRate 当前每月存入金额（绑定的资金池 fixedAmount）；传 0 或不传则用里程碑均值估算
 */
export function getAccelerationEstimate(
    goal: Goal,
    extraPerMonth: number,
    currentMonthlyRate?: number,
): { daysSaved: number; monthsSaved: number } | null {
    if (goal.targetAmount <= goal.currentAmount) return null;
    if (extraPerMonth <= 0) return null;
    const remaining = goal.targetAmount - goal.currentAmount;

    let rate = currentMonthlyRate ?? 0;
    if (rate <= 0 && goal.milestones.length > 0) {
        rate =
            goal.milestones.reduce((sum, m) => sum + m.amount, 0) /
            goal.milestones.length;
    }
    if (rate <= 0) return null;

    const currentMonths = remaining / rate;
    const acceleratedMonths = remaining / (rate + extraPerMonth);
    const monthsSaved = currentMonths - acceleratedMonths;

    return {
        daysSaved: Math.round(monthsSaved * 30),
        monthsSaved: Math.round(monthsSaved * 10) / 10,
    };
}
