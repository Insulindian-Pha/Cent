// Horizon 核心类型定义

/** 资金池分配规则 */
export type AllocationRule =
    | "fixed" // 固定金额
    | "percent" // 按比例
    | "monthly-list" // 月费清单
    | "residual-factor" // 剩余×系数
    | "remainder"; // 兜底

/** 子项追踪方式 */
export type TrackingMode =
    | "per-use" // 按次追踪
    | "monthly-estimate" // 按月估算（系统每天自动扣估算值）
    | "fixed-monthly"; // 固定月费（每月自动扣，不追踪次数）

/** 目标进度展示模式 */
export type GoalMode =
    | "multi-image" // 多图：一张图一个阶段
    | "single-image" // 单图：一张大图切格
    | "text"; // 文字：清单+进度条

/** 装备状态 */
export type EquipmentStatus = "want" | "owned" | "maintenance";

/** 成长事件类型 */
export type GrowthEventType =
    | "milestone" // 阶段完成
    | "subitem-adjust" // 子项调整
    | "equipment-harvest" // 装备收割
    | "note" // 随手记
    | "balance-redirect"; // 结余分配

// ─── 资金池子项 ───

export interface PoolSubItem {
    id: string;
    name: string;
    icon: string; // emoji
    budget: number; // 本月预算
    tracking: TrackingMode;
    unitPrice?: number; // 按次追踪：单次价格
    estimatedCount?: number; // 按次追踪：本月预估次数
    spent: number; // 本月已花
}

// ─── 资金池 ───

export interface FundPool {
    id: string;
    name: string;
    icon: string; // emoji
    color: string; // tailwind color class, e.g. "amber"
    rule: AllocationRule;

    // 分配参数（按 rule 取不同字段）
    fixedAmount?: number; // rule=fixed 时用
    percentRate?: number; // rule=percent 时用（0-1）
    monthlyFeeItems?: { name: string; amount: number }[]; // rule=monthly-list 时用
    residualFactor?: number; // rule=residual-factor 时用（0-1）

    priority: number; // 分配顺序（越小越先分）
    balance: number; // 当前余额（可动用资金）
    /** 固定金额/月费清单：本期已从总资金中扣走的金额（不计入 balance） */
    quotaDeducted?: number;

    subItems: PoolSubItem[]; // 池子内部的子项
    autoFlowTo?: string; // 暂存的钱月底默认转入哪个池子的 id
}

// ─── 目标 ───

export interface GoalImage {
    id: string;
    src: string; // base64 or blob URL
    label: string;
    budget: number; // 这张图/这格对应的金额
    progress: number; // 0-1
    manualBudget?: boolean; // 用户是否手动设定了预算（false = 自动均分）
}

export interface Milestone {
    id: string;
    label: string;
    amount: number; // 该步骤所需金额（按清单顺序依次扣减）
    completed: boolean;
    completedDate?: string; // ISO date
    progress?: number; // 0-1，当前步骤完成度
}

export interface Goal {
    id: string;
    name: string;
    mode: GoalMode;
    targetAmount: number; // 总目标金额
    currentAmount: number; // 当前已攒

    images: GoalImage[]; // 多图/单图模式用
    gridCols?: number; // 单图模式：列数
    gridRows?: number; // 单图模式：行数

    milestones: Milestone[]; // 文字模式用
    boundPoolId: string; // 绑定的梦想基金池 id
}

// ─── 装备 ───

export interface Equipment {
    id: string;
    name: string;
    category: string;
    price: number;
    status: EquipmentStatus;
    boundPoolId: string;
    image?: string; // base64 or blob URL
    purchasedDate?: string;
}

// ─── 成长记录 ───

export interface GrowthEvent {
    id: string;
    date: string; // ISO date
    type: GrowthEventType;
    summary: string;
    amount?: number;
    linkedGoalId?: string;
}

// ─── 分配结果（中间类型） ───

export interface SalaryDistribution {
    poolId: string;
    poolName: string;
    allocated: number;
    rule: AllocationRule;
    remaining: number; // 分配后工资剩余
}

// ─── 每日生活费 ───

export interface DailyExpense {
    id: string;
    date: string; // YYYY-MM-DD
    budget: number; // 当日预算
    actual: number; // 实际花费（0 = 未手动输入，视为等于预算）
    isManual: boolean; // 是否手动校准过
    note?: string;
}

export interface LivingConfig {
    dailyBudget: number; // 每日预算
    monthlyRent: number; // 月房租（已由池子管理，仅作参考）
    rentDayOfMonth: number; // 交租日（已由池子管理，仅作参考）
    linkedPoolId?: string; // 绑定的生活费资金池 id
    lastDecrementDate: string | null; // 上次自动扣减日期 YYYY-MM-DD
}

export const DEFAULT_LIVING_CONFIG: LivingConfig = {
    dailyBudget: 60,
    monthlyRent: 2180,
    rentDayOfMonth: 1,
    lastDecrementDate: null,
};

// ─── Per-use 打卡记录 ───

export interface TapEvent {
    id: string;
    poolId: string;
    itemId: string;
    itemName: string; // 冗余存储，加速日历展示
    poolName: string; // 冗余存储，加速日历展示
    amount: number;
    timestamp: string; // ISO datetime
}

// ─── Store 状态 ───

export interface HorizonState {
    goals: Goal[];
    pools: FundPool[];
    equipments: Equipment[];
    growthEvents: GrowthEvent[];
    expenses: DailyExpense[];
    livingConfig: LivingConfig;
    tapEvents: TapEvent[];
    salaryDay: number; // 每月几号发工资（1-28）
    lastDistributedDate: string | null; // ISO date，上次发薪日
}

// ─── 初始模板 ───

export const LIVING_POOL_MARK = "__living__";

export const DEFAULT_POOLS: Omit<FundPool, "id" | "balance">[] = [
    {
        name: "固定开销",
        icon: "🏠",
        color: "slate",
        rule: "fixed",
        fixedAmount: 2180,
        priority: 1,
        subItems: [],
    },
    {
        name: "应急金",
        icon: "🛡️",
        color: "blue",
        rule: "percent",
        percentRate: 0.1,
        priority: 2,
        subItems: [],
    },
    {
        name: "固定月费",
        icon: "📋",
        color: "violet",
        rule: "monthly-list",
        monthlyFeeItems: [],
        priority: 3,
        subItems: [],
    },
    {
        name: "梦想基金",
        icon: "🌅",
        color: "amber",
        rule: "fixed",
        fixedAmount: 2000,
        priority: 4,
        subItems: [],
    },
    {
        name: "爱好基金",
        icon: "⛵",
        color: "emerald",
        rule: "residual-factor",
        residualFactor: 0.6,
        priority: 5,
        subItems: [],
    },
    {
        name: "零花钱",
        icon: "💳",
        color: "pink",
        rule: "remainder",
        priority: 999,
        subItems: [],
    },
    {
        name: "生活费",
        icon: "🍜",
        color: "teal",
        rule: "residual-factor",
        residualFactor: 0,
        fixedAmount: 1800,
        priority: 2,
        subItems: [],
        autoFlowTo: undefined,
    },
];
