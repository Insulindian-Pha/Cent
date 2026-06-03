// 资金池列表页 —— Horizon 主页面

import {
    closestCenter,
    DndContext,
    type DragEndEvent,
    DragOverlay,
    type DragStartEvent,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    CalendarDays,
    GripVertical,
    Image,
    List,
    Plus,
    Target,
    Wallet,
    X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { getGoalProgress } from "@/horizon/goal";
import { ModalBackdrop } from "@/horizon/modal-backdrop";
import { isExpensePool, isQuotaFullyDeducted, poolQuota } from "@/horizon/pool";
import type { AllocationRule, FundPool } from "@/horizon/types";
import { useHorizonStore } from "@/store/horizon";

// ─── 规则显示名 ───

const RULE_LABELS: Record<string, string> = {
    fixed: "固定金额",
    percent: "按比例",
    "monthly-list": "月费清单",
    "residual-factor": "剩余比例",
    remainder: "兜底",
};

// ─── 确认删除弹窗 ───

function ConfirmModal({
    open,
    title,
    message,
    onConfirm,
    onCancel,
}: {
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    if (!open) return null;
    return (
        <ModalBackdrop onClose={onCancel} align="center">
            <motion.div
                className="relative bg-card w-80 rounded-2xl p-6 shadow-xl text-center"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                onClick={(e) => e.stopPropagation()}
            >
                <p className="text-lg font-bold mb-1">{title}</p>
                <p className="text-sm text-muted-foreground mb-5">{message}</p>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        className="flex-1"
                        onClick={onCancel}
                    >
                        取消
                    </Button>
                    <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={onConfirm}
                    >
                        确认删除
                    </Button>
                </div>
            </motion.div>
        </ModalBackdrop>
    );
}

// ─── 可拖拽池子卡片 ───

function PoolCard({
    pool,
    onTap,
    onDelete,
    isLiving,
    livingDaily,
}: {
    pool: FundPool;
    onTap: (id: string) => void;
    onDelete: (pool: FundPool) => void;
    isLiving?: boolean;
    livingDaily?: number;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: pool.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
    };

    return (
        <motion.div
            ref={setNodeRef}
            style={style}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.2 }}
        >
            <div className="p-4 rounded-xl border border-border bg-card text-card-foreground group hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3">
                    <button
                        {...attributes}
                        {...listeners}
                        className="touch-none text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
                        aria-label="拖拽排序"
                    >
                        <GripVertical className="size-5" />
                    </button>

                    <button
                        type="button"
                        className="flex flex-1 items-center gap-3 min-w-0 text-left border-0 bg-transparent p-0 cursor-pointer"
                        onClick={() => onTap(pool.id)}
                    >
                        <span className="text-2xl">{pool.icon}</span>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-foreground truncate">
                                    {pool.name}
                                </span>
                                {isLiving ? (
                                    <span className="text-xs shrink-0 px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium">
                                        生活费
                                    </span>
                                ) : (
                                    <span className="text-xs shrink-0 px-1.5 py-0.5 rounded-md bg-secondary text-secondary-foreground font-medium">
                                        {RULE_LABELS[pool.rule] ?? pool.rule}
                                    </span>
                                )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                                {isLiving
                                    ? `每 ¥${(livingDaily ?? 0).toLocaleString()}/天`
                                    : `优先级 ${pool.priority}${pool.subItems.length > 0 ? ` · ${pool.subItems.length} 个子项` : ""}`}
                            </span>
                        </div>

                        <div className="text-right shrink-0 flex items-center gap-2">
                            {isLiving ? (
                                // 生活费池：迷你环形进度条
                                (() => {
                                    const sv = 40;
                                    const sw = 4;
                                    const sr = (sv - sw) / 2;
                                    const sc = 2 * Math.PI * sr;
                                    const alloc =
                                        pool.fixedAmount ?? pool.balance;
                                    const hasBalance = pool.balance > 0;
                                    const s = hasBalance
                                        ? Math.max(0, alloc - pool.balance)
                                        : 0;
                                    const pct =
                                        hasBalance && alloc > 0
                                            ? (s / alloc) * 100
                                            : 0;
                                    const so =
                                        sc - (Math.min(pct, 100) / 100) * sc;
                                    const scolor = hasBalance
                                        ? pct > 90
                                            ? "stroke-red-500"
                                            : pct > 70
                                              ? "stroke-amber-500"
                                              : "stroke-emerald-500"
                                        : "stroke-muted-foreground/30";
                                    return (
                                        <div className="relative shrink-0">
                                            <svg
                                                width={sv}
                                                height={sv}
                                                className="-rotate-90"
                                                role="img"
                                                aria-label={`生活费剩余 ¥${pool.balance.toLocaleString()}`}
                                            >
                                                <circle
                                                    cx={sv / 2}
                                                    cy={sv / 2}
                                                    r={sr}
                                                    fill="none"
                                                    className="stroke-muted-foreground/20"
                                                    strokeWidth={sw}
                                                />
                                                <circle
                                                    cx={sv / 2}
                                                    cy={sv / 2}
                                                    r={sr}
                                                    fill="none"
                                                    className={scolor}
                                                    strokeWidth={sw}
                                                    strokeLinecap="round"
                                                    strokeDasharray={sc}
                                                    strokeDashoffset={so}
                                                />
                                            </svg>
                                            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold tabular-nums">
                                                {hasBalance
                                                    ? `¥${(
                                                          pool.balance >= 1000
                                                              ? `${(pool.balance / 1000).toFixed(1)}k`
                                                              : pool.balance.toLocaleString()
                                                      ).replace(",", "")}`
                                                    : "待分"}
                                            </span>
                                        </div>
                                    );
                                })()
                            ) : isExpensePool(pool) ? (
                                isQuotaFullyDeducted(pool) ? (
                                    <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                        <span className="size-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs">
                                            ✓
                                        </span>
                                        已扣 ¥{poolQuota(pool).toLocaleString()}
                                    </span>
                                ) : (
                                    <span className="text-sm text-muted-foreground tabular-nums">
                                        待扣 ¥
                                        {(
                                            poolQuota(pool) -
                                            (pool.quotaDeducted ?? 0)
                                        ).toLocaleString()}
                                    </span>
                                )
                            ) : (
                                <motion.span
                                    className="text-lg font-bold tabular-nums text-foreground"
                                    key={pool.balance}
                                    initial={{ scale: 1.2 }}
                                    animate={{ scale: 1 }}
                                    transition={{
                                        type: "spring",
                                        stiffness: 300,
                                        damping: 20,
                                    }}
                                >
                                    ¥{pool.balance.toLocaleString()}
                                </motion.span>
                            )}
                        </div>
                    </button>

                    <button
                        type="button"
                        onClick={() => onDelete(pool)}
                        className="size-5 rounded-full bg-muted text-muted-foreground hover:bg-destructive hover:text-destructive-foreground flex items-center justify-center shrink-0 transition-colors opacity-0 group-hover:opacity-100 ml-1"
                        title="删除资金池"
                    >
                        <X className="size-3" />
                    </button>
                </div>
            </div>
        </motion.div>
    );
}

// ─── 添加资金池弹窗 ───

const POOL_ICONS = [
    "🏠",
    "🛡️",
    "📋",
    "🌅",
    "⛵",
    "💳",
    "🎓",
    "🏥",
    "🐱",
    "✈️",
    "🍔",
    "🎮",
];

function AddPoolModal({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const addPool = useHorizonStore((s) => s.addPool);
    const poolCount = useHorizonStore((s) => s.pools.length);

    const [name, setName] = useState("");
    const [icon, setIcon] = useState("💰");
    const [rule, setRule] = useState<AllocationRule>("fixed");
    const [amount, setAmount] = useState("");
    const [error, setError] = useState("");

    if (!open) return null;

    const handleSave = () => {
        const trimmed = name.trim();
        if (!trimmed) {
            setError("请输入名称");
            return;
        }

        const needsAmount =
            rule === "fixed" ||
            rule === "percent" ||
            rule === "residual-factor";
        let num = 0;
        if (needsAmount) {
            num = Number.parseFloat(amount);
            if (Number.isNaN(num) || num <= 0) {
                setError("请输入有效金额/比例");
                return;
            }
        }

        const transfers = addPool({
            name: trimmed,
            icon,
            color: "slate",
            rule,
            priority: poolCount + 1,
            subItems: [],
            ...(rule === "fixed" ? { fixedAmount: num } : {}),
            ...(rule === "percent" ? { percentRate: num / 100 } : {}),
            ...(rule === "monthly-list" ? { monthlyFeeItems: [] } : {}),
            ...(rule === "residual-factor"
                ? { residualFactor: num / 100 }
                : {}),
        });

        const filled = transfers.reduce((s, t) => s + t.amount, 0);
        if (filled > 0) {
            toast(
                `已添加「${trimmed}」，已从兜底扣款 ¥${filled.toLocaleString()}`,
            );
        } else {
            toast(`已添加「${trimmed}」`);
        }
        setName("");
        setIcon("💰");
        setRule("fixed");
        setAmount("");
        setError("");
        onClose();
    };

    const labelByRule: Record<string, string> = {
        fixed: "固定金额 ¥",
        percent: "比例 %",
        "monthly-list": "（月费清单，稍后在详情页添加）",
        "residual-factor": "剩余系数 %",
        remainder: "（自动兜底，无需设置金额）",
    };

    return (
        <ModalBackdrop onClose={() => onClose()}>
            <motion.div
                className="relative bg-card w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6 shadow-xl max-h-[85vh] overflow-auto"
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className="text-lg font-bold mb-4">添加资金池</h2>

                <div className="space-y-4">
                    {/* 名称 */}
                    <div>
                        <Label className="text-sm">名称</Label>
                        <Input
                            placeholder='例如"养宠基金"'
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                setError("");
                            }}
                            autoFocus
                        />
                    </div>

                    {/* 图标 */}
                    <div>
                        <Label className="text-sm mb-1.5 block">图标</Label>
                        <div className="flex flex-wrap gap-1.5">
                            {POOL_ICONS.map((emoji) => (
                                <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => setIcon(emoji)}
                                    className={`size-9 text-lg flex items-center justify-center rounded-lg transition-colors ${
                                        icon === emoji
                                            ? "bg-primary/15 ring-2 ring-primary/30"
                                            : "hover:bg-muted"
                                    }`}
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 分配规则 */}
                    <div>
                        <Label className="text-sm mb-2 block">分配规则</Label>
                        <RadioGroup
                            value={rule}
                            onValueChange={(v) => {
                                setRule(v as AllocationRule);
                                setAmount("");
                                setError("");
                            }}
                        >
                            {(
                                [
                                    {
                                        value: "fixed",
                                        label: "固定金额",
                                        desc: "每次拿走确定的金额",
                                    },
                                    {
                                        value: "percent",
                                        label: "按比例",
                                        desc: "拿走收入的 X%",
                                    },
                                    {
                                        value: "monthly-list",
                                        label: "月费清单",
                                        desc: "多项固定月费自动加总",
                                    },
                                    {
                                        value: "residual-factor",
                                        label: "剩余×系数",
                                        desc: "前面分完剩余的 × 比例",
                                    },
                                    {
                                        value: "remainder",
                                        label: "兜底",
                                        desc: "前面全部分完，剩多少全归它",
                                    },
                                ] as const
                            ).map((opt) => (
                                <label
                                    key={opt.value}
                                    htmlFor={`rule-${opt.value}`}
                                    className="flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors has-[:checked]:bg-primary/5 has-[:checked]:ring-1 has-[:checked]:ring-primary/20"
                                >
                                    <RadioGroupItem
                                        id={`rule-${opt.value}`}
                                        value={opt.value}
                                        className="mt-0.5"
                                    />
                                    <div>
                                        <span className="text-sm font-medium">
                                            {opt.label}
                                        </span>
                                        <p className="text-xs text-muted-foreground">
                                            {opt.desc}
                                        </p>
                                    </div>
                                </label>
                            ))}
                        </RadioGroup>
                    </div>

                    {/* 金额/比例 */}
                    {rule !== "remainder" && rule !== "monthly-list" && (
                        <div>
                            <Label className="text-sm">
                                {labelByRule[rule]}
                            </Label>
                            <Input
                                type="number"
                                placeholder={
                                    rule === "percent" ||
                                    rule === "residual-factor"
                                        ? "10"
                                        : "2000"
                                }
                                value={amount}
                                onChange={(e) => {
                                    setAmount(e.target.value);
                                    setError("");
                                }}
                            />
                            {rule === "percent" && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    例如输入 10 表示薪水的 10%
                                </p>
                            )}
                            {rule === "residual-factor" && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    例如输入 60 表示前面分完后剩余的 60%
                                </p>
                            )}
                        </div>
                    )}

                    {rule === "monthly-list" && (
                        <p className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/50">
                            月费清单将在池子详情页中添加具体项目
                        </p>
                    )}

                    {rule === "remainder" && (
                        <p className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/50">
                            此池子自动接收所有分配后剩余的钱，无需额外设置
                        </p>
                    )}

                    {/* 错误 */}
                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}

                    {/* 按钮 */}
                    <div className="flex gap-2 pt-2">
                        <Button
                            variant="outline"
                            className="flex-1"
                            onClick={onClose}
                        >
                            取消
                        </Button>
                        <Button className="flex-1" onClick={handleSave}>
                            添加
                        </Button>
                    </div>
                </div>
            </motion.div>
        </ModalBackdrop>
    );
}

// ─── 薪资分配弹窗 ───

function SalaryModal({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const [amount, setAmount] = useState("");
    const [results, setResults] = useState<
        | {
              poolId: string;
              poolName: string;
              allocated: number;
              rule: string;
              remaining: number;
          }[]
        | null
    >(null);
    const doDistributeSalary = useHorizonStore((s) => s.doDistributeSalary);
    const salaryAmountId = useId();

    if (!open) return null;

    const handleDistribute = () => {
        const num = Number.parseFloat(amount);
        if (Number.isNaN(num) || num <= 0) return;
        const res = doDistributeSalary(num);
        setResults(res);
    };

    const handleClose = () => {
        setAmount("");
        setResults(null);
        onClose();
    };

    return (
        <ModalBackdrop onClose={handleClose}>
            <motion.div
                className="relative bg-card w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6 shadow-xl max-h-[80vh] overflow-auto"
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className="text-lg font-bold mb-4">💰 发薪日分配</h2>

                {!results ? (
                    <div className="space-y-4">
                        <div>
                            <Label
                                htmlFor={salaryAmountId}
                                className="text-sm text-muted-foreground mb-1 block"
                            >
                                这个月到手的钱
                            </Label>
                            <Input
                                id={salaryAmountId}
                                type="number"
                                placeholder="12,000"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                onKeyDown={(e) =>
                                    e.key === "Enter" && handleDistribute()
                                }
                                autoFocus
                            />
                        </div>
                        <Button
                            className="w-full"
                            size="lg"
                            onClick={handleDistribute}
                        >
                            分配
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            {results.map((r) => (
                                <div
                                    key={r.poolId}
                                    className="flex items-center justify-between py-2 border-b border-border last:border-0"
                                >
                                    <span className="text-sm">
                                        {r.poolName}
                                    </span>
                                    <motion.span
                                        className="font-mono font-semibold text-emerald-600 dark:text-emerald-400"
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{
                                            delay: 0.05 * results.indexOf(r),
                                        }}
                                    >
                                        +¥{r.allocated.toLocaleString()}
                                    </motion.span>
                                </div>
                            ))}
                        </div>
                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={handleClose}
                        >
                            完成
                        </Button>
                    </div>
                )}
            </motion.div>
        </ModalBackdrop>
    );
}

// ─── 主页面 ───

export default function PoolsPage() {
    const navigate = useNavigate();
    const pools = useHorizonStore((s) => s.pools);
    const goals = useHorizonStore((s) => s.goals);
    const livingConfig = useHorizonStore((s) => s.livingConfig);
    const deleteGoal = useHorizonStore((s) => s.deleteGoal);
    const removePool = useHorizonStore((s) => s.removePool);
    const reorderPools = useHorizonStore((s) => s.reorderPools);
    const rebalancePools = useHorizonStore((s) => s.rebalancePools);
    const ensureDailyDecrement = useHorizonStore((s) => s.ensureDailyDecrement);
    const didRebalance = useRef(false);

    // 打开首页时补平历史数据 + 每日生活费扣减
    useEffect(() => {
        if (didRebalance.current) return;
        didRebalance.current = true;
        rebalancePools();
        ensureDailyDecrement();

        // 旧数据兼容：如果生活费池子不存在，创建一个
        const st = useHorizonStore.getState();
        const lpId = st.livingConfig.linkedPoolId;
        if (!lpId || !st.pools.some((p) => p.id === lpId)) {
            const days = new Date(
                new Date().getFullYear(),
                new Date().getMonth() + 1,
                0,
            ).getDate();
            st.addPool({
                name: "生活费",
                icon: "🍜",
                color: "teal",
                rule: "residual-factor",
                residualFactor: 0,
                fixedAmount: st.livingConfig.dailyBudget * days,
                priority: 2,
                subItems: [],
            });
            // addPool 之后 pool 已同步写入，找名字匹配的
            const newPool = useHorizonStore
                .getState()
                .pools.find((p) => p.name === "生活费");
            if (newPool) {
                st.linkLivingPool(newPool.id);
            }
        }
    }, [rebalancePools, ensureDailyDecrement]);

    const livingPoolId = livingConfig.linkedPoolId;

    const [salaryOpen, setSalaryOpen] = useState(false);
    const [addPoolOpen, setAddPoolOpen] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);

    // 确认删除状态
    const [confirmDelete, setConfirmDelete] = useState<{
        type: "pool" | "goal";
        id: string;
        name: string;
    } | null>(null);

    const activePool = activeId
        ? (pools.find((p) => p.id === activeId) ?? null)
        : null;

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 },
        }),
    );

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const orderedIds = pools.map((p) => p.id);
            const oldIndex = orderedIds.indexOf(active.id as string);
            const newIndex = orderedIds.indexOf(over.id as string);
            if (oldIndex !== -1 && newIndex !== -1) {
                orderedIds.splice(oldIndex, 1);
                orderedIds.splice(newIndex, 0, active.id as string);
                reorderPools(orderedIds);
                toast("分配顺序已更新，下次发薪日会按新顺序分配");
            }
        }
        setActiveId(null);
    };

    const handleTap = (id: string) => {
        if (id === livingPoolId) {
            navigate("/calendar");
        } else {
            navigate(`/pool/${id}`);
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* 顶部栏 */}
            <header className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <h1 className="text-xl font-bold">Horizon</h1>
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate("/calendar")}
                    >
                        <CalendarDays className="size-4 mr-1" />
                        日历
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate("/wizard")}
                    >
                        <Plus className="size-4 mr-1" />
                        目标
                    </Button>
                    <Button size="sm" onClick={() => setSalaryOpen(true)}>
                        <Wallet className="size-4 mr-1" />
                        发薪
                    </Button>
                </div>
            </header>

            {/* 总资金概览 */}
            <div className="px-4 pt-4 shrink-0">
                <motion.div
                    className="p-4 rounded-2xl bg-card border border-border flex items-center justify-between"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <div>
                        <p className="text-xs text-muted-foreground">总资金</p>
                        <motion.p
                            className="text-2xl font-bold tabular-nums"
                            key={pools.reduce((s, p) => s + p.balance, 0)}
                            initial={{ scale: 1.1 }}
                            animate={{ scale: 1 }}
                            transition={{
                                type: "spring",
                                stiffness: 300,
                                damping: 20,
                            }}
                        >
                            ¥
                            {pools
                                .reduce((s, p) => s + p.balance, 0)
                                .toLocaleString()}
                        </motion.p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                        <p>{pools.length} 个池子</p>
                        {goals.length > 0 && <p>{goals.length} 个目标</p>}
                    </div>
                </motion.div>
            </div>

            {/* 目标区域 */}
            {goals.length > 0 && (
                <div className="px-4 pt-4 shrink-0">
                    <div className="flex items-center gap-2 mb-2">
                        <Target className="size-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-muted-foreground">
                            我的目标
                        </span>
                    </div>
                    <div className="flex gap-3 overflow-visible pt-3 pb-2 -mx-1 px-1 flex-wrap">
                        {goals.map((goal) => {
                            const progress = getGoalProgress(goal);
                            const ModeIcon =
                                goal.mode === "text" ? List : Image;
                            const pool = pools.find(
                                (p) => p.id === goal.boundPoolId,
                            );
                            return (
                                <div
                                    key={goal.id}
                                    className="shrink-0 w-44 relative group"
                                >
                                    <button
                                        type="button"
                                        onClick={() =>
                                            navigate(`/progress/${goal.id}`)
                                        }
                                        className="w-full p-4 rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all text-left"
                                    >
                                        <div className="flex items-center gap-2 mb-2">
                                            <ModeIcon className="size-4 text-primary" />
                                            <span className="font-semibold text-sm truncate">
                                                {goal.name}
                                            </span>
                                        </div>
                                        <Progress
                                            value={progress * 100}
                                            className="h-1.5 mb-2"
                                        />
                                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                                            <span>
                                                {Math.round(progress * 100)}%
                                            </span>
                                            <span>
                                                ¥
                                                {(
                                                    goal.currentAmount / 10000
                                                ).toFixed(1)}
                                                万 / ¥
                                                {(
                                                    goal.targetAmount / 10000
                                                ).toFixed(1)}
                                                万
                                            </span>
                                        </div>
                                        {pool && (
                                            <div className="mt-2 text-xs text-muted-foreground truncate">
                                                {pool.icon} {pool.name} · ¥
                                                {pool.balance.toLocaleString()}
                                            </div>
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setConfirmDelete({
                                                type: "goal",
                                                id: goal.id,
                                                name: goal.name,
                                            });
                                        }}
                                        className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/90"
                                        title="删除目标"
                                    >
                                        <X className="size-3" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 资金池区域 */}
            <div className="px-4 pt-4 shrink-0">
                <div className="flex items-center gap-2 mb-2">
                    <Wallet className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">
                        资金池
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto">
                        长按拖拽排序
                    </span>
                </div>
            </div>

            {/* 池子卡片列表 */}
            <div className="flex-1 overflow-auto px-4 pb-4">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext
                        items={pools.map((p) => p.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        <div className="space-y-3">
                            <AnimatePresence>
                                {pools.map((pool) => (
                                    <PoolCard
                                        key={pool.id}
                                        pool={pool}
                                        onTap={handleTap}
                                        onDelete={(p) =>
                                            setConfirmDelete({
                                                type: "pool",
                                                id: p.id,
                                                name: p.name,
                                            })
                                        }
                                        isLiving={pool.id === livingPoolId}
                                        livingDaily={livingConfig.dailyBudget}
                                    />
                                ))}
                            </AnimatePresence>

                            {/* 添加资金池入口 */}
                            <motion.button
                                type="button"
                                onClick={() => setAddPoolOpen(true)}
                                className="w-full p-4 rounded-xl border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 hover:bg-primary/5 text-muted-foreground hover:text-primary transition-all flex items-center justify-center gap-2"
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: pools.length * 0.03 }}
                            >
                                <Plus className="size-5" />
                                <span className="text-sm font-medium">
                                    添加资金池
                                </span>
                            </motion.button>
                        </div>
                    </SortableContext>

                    <DragOverlay dropAnimation={null}>
                        {activePool ? (
                            <div className="rounded-xl border-2 border-primary bg-card shadow-2xl opacity-95 scale-[1.02] rotate-[0.5deg]">
                                <div className="p-4">
                                    <div className="flex items-center gap-3">
                                        <GripVertical className="size-5 text-primary" />
                                        <span className="text-2xl">
                                            {activePool.icon}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-foreground truncate">
                                                    {activePool.name}
                                                </span>
                                                <span className="text-xs shrink-0 px-1.5 py-0.5 rounded-md bg-secondary text-secondary-foreground font-medium">
                                                    {RULE_LABELS[
                                                        activePool.rule
                                                    ] ?? activePool.rule}
                                                </span>
                                            </div>
                                        </div>
                                        <span className="text-xl font-bold tabular-nums text-foreground">
                                            ¥
                                            {activePool.balance.toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>

                {pools.length === 0 && (
                    <div className="text-center text-muted-foreground py-20">
                        <Wallet className="size-12 mx-auto mb-3 opacity-30" />
                        <p>还没有资金池</p>
                        <p className="text-sm">点击"发薪"开始第一次分配</p>
                    </div>
                )}
            </div>

            {/* 发薪弹窗 */}
            <AnimatePresence>
                {salaryOpen && (
                    <SalaryModal
                        open={salaryOpen}
                        onClose={() => setSalaryOpen(false)}
                    />
                )}
                {addPoolOpen && (
                    <AddPoolModal
                        open={addPoolOpen}
                        onClose={() => setAddPoolOpen(false)}
                    />
                )}
                {confirmDelete && (
                    <ConfirmModal
                        open={!!confirmDelete}
                        title={
                            confirmDelete.type === "goal"
                                ? "删除目标"
                                : "删除资金池"
                        }
                        message={
                            confirmDelete.type === "goal"
                                ? `确认删除目标「${confirmDelete.name}」？此操作不可撤销。`
                                : `确认删除「${confirmDelete.name}」？池内余额将转入「零花钱」等兜底池，不会消失。`
                        }
                        onConfirm={() => {
                            if (confirmDelete.type === "goal") {
                                deleteGoal(confirmDelete.id);
                                toast("目标已删除");
                            } else {
                                const result = removePool(confirmDelete.id);
                                if (result.releasedTo) {
                                    toast(
                                        `已删除「${confirmDelete.name}」，¥${result.releasedTo.amount.toLocaleString()} 已转入「${result.releasedTo.poolName}」`,
                                    );
                                } else {
                                    toast(`已删除「${confirmDelete.name}」`);
                                }
                            }
                            setConfirmDelete(null);
                        }}
                        onCancel={() => setConfirmDelete(null)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
