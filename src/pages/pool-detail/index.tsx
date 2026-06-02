// 资金池详情页 —— 子项管理与追踪
// PRD §4 模块 2+3 的核心交互

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
    ChevronLeft,
    GripVertical,
    Package,
    Pencil,
    PiggyBank,
    Plus,
    Trash2,
    Wallet,
    Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { ModalBackdrop } from "@/horizon/modal-backdrop";
import {
    getPoolStash,
    isExpensePool,
    isQuotaFullyDeducted,
    poolQuota,
} from "@/horizon/pool";
import type { FundPool, PoolSubItem, TrackingMode } from "@/horizon/types";
import { useHorizonStore } from "@/store/horizon";

// ─── 显示名映射 ───

const RULE_LABELS: Record<string, string> = {
    fixed: "固定金额",
    percent: "按比例",
    "monthly-list": "月费清单",
    "residual-factor": "剩余比例",
    remainder: "兜底",
};

const TRACKING_LABELS: Record<TrackingMode, string> = {
    "per-use": "按次",
    "monthly-estimate": "按月估算",
    "fixed-monthly": "固定月费",
};

const TRACKING_BADGE_CLASS: Record<TrackingMode, string> = {
    "per-use":
        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    "monthly-estimate":
        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    "fixed-monthly":
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};

// ─── 轮胎倒计数指示器 ───

function TireIndicator({ used, total }: { used: number; total: number }) {
    return (
        <span className="inline-flex gap-0.5 items-center">
            {Array.from({ length: total }).map((_, i) => (
                <motion.span
                    key={`${i}-${i < total - used ? "on" : "off"}`}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.15, delay: i * 0.03 }}
                    className={i < total - used ? "" : "opacity-25"}
                >
                    {i < total - used ? "🛞" : "⬜"}
                </motion.span>
            ))}
        </span>
    );
}

// ─── 可拖拽子项卡片 ───

function SubItemCard({
    item,
    pool,
    onEdit,
}: {
    item: PoolSubItem;
    pool: FundPool;
    onEdit: (item: PoolSubItem) => void;
}) {
    const tapPerUse = useHorizonStore((s) => s.tapPerUse);
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: item.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
    };

    // 按次模式：计算剩余次数
    const remainingUses =
        item.tracking === "per-use" && item.unitPrice
            ? (item.estimatedCount ?? 0) -
              Math.floor(item.spent / item.unitPrice)
            : null;
    const isExhausted = remainingUses !== null && remainingUses <= 0;

    // 按月估算：计算百分比
    const estimatePercent =
        item.tracking === "monthly-estimate" && item.budget > 0
            ? Math.min(100, Math.round((item.spent / item.budget) * 100))
            : null;

    const handleTap = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isExhausted) return;
        tapPerUse(pool.id, item.id);
    };

    return (
        <motion.div
            ref={setNodeRef}
            style={style}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
        >
            <div
                className={`p-3 rounded-xl border transition-colors ${
                    isExhausted
                        ? "border-border bg-muted/40"
                        : "border-border bg-card hover:border-primary/30"
                }`}
            >
                {/* 第一行：拖拽手柄 + 图标 + 名称 + 标签 + 金额 */}
                <div className="flex items-center gap-2">
                    <button
                        {...attributes}
                        {...listeners}
                        className="touch-none text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing shrink-0"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="拖拽排序"
                    >
                        <GripVertical className="size-4" />
                    </button>

                    <span className="text-lg shrink-0">{item.icon}</span>
                    <span
                        className={`font-medium text-sm truncate flex-1 min-w-0 ${
                            isExhausted
                                ? "text-muted-foreground"
                                : "text-foreground"
                        }`}
                    >
                        {item.name}
                    </span>

                    <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0 ${TRACKING_BADGE_CLASS[item.tracking]}`}
                    >
                        {TRACKING_LABELS[item.tracking]}
                    </span>

                    <span className="text-sm font-mono tabular-nums shrink-0 text-muted-foreground">
                        ¥{item.spent.toLocaleString()}
                        <span className="text-muted-foreground/50">
                            /¥{item.budget.toLocaleString()}
                        </span>
                    </span>
                </div>

                {/* 第二行：追踪指示器 + 操作按钮 */}
                <div className="flex items-center gap-2 mt-2 ml-7">
                    {/* 按次：轮胎倒计数 */}
                    {item.tracking === "per-use" && remainingUses !== null && (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                            <TireIndicator
                                used={
                                    (item.estimatedCount ?? 0) - remainingUses
                                }
                                total={item.estimatedCount ?? 0}
                            />
                            <span
                                className={`text-xs ${
                                    isExhausted
                                        ? "text-destructive font-medium"
                                        : "text-muted-foreground"
                                }`}
                            >
                                {isExhausted
                                    ? "本月已用完"
                                    : `剩${remainingUses}次`}
                            </span>
                        </div>
                    )}

                    {/* 按月估算：进度条 */}
                    {item.tracking === "monthly-estimate" &&
                        estimatePercent !== null && (
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <Progress
                                    value={estimatePercent}
                                    className="h-1.5 w-20"
                                />
                                <span className="text-xs text-muted-foreground">
                                    {estimatePercent}%
                                </span>
                            </div>
                        )}

                    {/* 固定月费：按实际 spent 显示 */}
                    {item.tracking === "fixed-monthly" && item.budget > 0 && (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                            <Progress
                                value={Math.min(
                                    100,
                                    Math.round(
                                        (item.spent / item.budget) * 100,
                                    ),
                                )}
                                className="h-1.5 w-16 shrink-0"
                            />
                            {item.spent >= item.budget ? (
                                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                    ✓ 已扣除
                                </span>
                            ) : (
                                <span className="text-xs text-muted-foreground truncate">
                                    待扣 ¥
                                    {(
                                        item.budget - item.spent
                                    ).toLocaleString()}
                                    {pool.balance <= 0 ? "（池余额不足）" : ""}
                                </span>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-1 shrink-0">
                        {/* 按次模式："又做了一次" 按钮 */}
                        {item.tracking === "per-use" && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <motion.button
                                        whileTap={{ scale: 0.85 }}
                                        transition={{
                                            type: "spring",
                                            stiffness: 400,
                                            damping: 10,
                                        }}
                                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                                            isExhausted
                                                ? "bg-muted text-muted-foreground cursor-not-allowed"
                                                : "bg-primary/10 text-primary hover:bg-primary/20 active:bg-primary/30"
                                        }`}
                                        onClick={handleTap}
                                        disabled={isExhausted}
                                        type="button"
                                    >
                                        <Zap className="size-3" />
                                        又做了一次
                                    </motion.button>
                                </TooltipTrigger>
                                {isExhausted && (
                                    <TooltipContent side="top">
                                        本月已用完
                                    </TooltipContent>
                                )}
                            </Tooltip>
                        )}

                        {/* 编辑按钮 */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={(e) => {
                                e.stopPropagation();
                                onEdit(item);
                            }}
                            type="button"
                        >
                            <Pencil className="size-3.5" />
                        </Button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

// ─── 添加/编辑子项弹窗 ───

function SubItemFormModal({
    open,
    onClose,
    onSave,
    initial,
    onDelete,
}: {
    open: boolean;
    onClose: () => void;
    onSave: (data: {
        name: string;
        budget: number;
        tracking: TrackingMode;
        unitPrice?: number;
        estimatedCount?: number;
    }) => void;
    initial?: PoolSubItem;
    onDelete?: () => void;
}) {
    const [name, setName] = useState(initial?.name ?? "");
    const [budget, setBudget] = useState(initial?.budget?.toString() ?? "");
    const [tracking, setTracking] = useState<TrackingMode>(
        initial?.tracking ?? "monthly-estimate",
    );
    const [unitPrice, setUnitPrice] = useState(
        initial?.unitPrice?.toString() ?? "",
    );
    const [estimatedCount, setEstimatedCount] = useState(
        initial?.estimatedCount?.toString() ?? "",
    );
    const [error, setError] = useState("");
    const formId = useId();
    const nameId = `${formId}-name`;
    const budgetId = `${formId}-budget`;
    const trackPerUseId = `${formId}-track-per-use`;
    const trackMonthlyId = `${formId}-track-monthly`;
    const trackFixedId = `${formId}-track-fixed`;
    const unitPriceId = `${formId}-unit-price`;
    const estCountId = `${formId}-est-count`;

    if (!open) return null;

    const isEdit = !!initial;

    const handleSave = () => {
        // 校验
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError("请输入子项名称");
            return;
        }
        const budgetNum = Number.parseFloat(budget);
        if (Number.isNaN(budgetNum) || budgetNum <= 0) {
            setError("请输入有效的预算金额");
            return;
        }
        if (tracking === "per-use") {
            const price = Number.parseFloat(unitPrice);
            const count = Number.parseInt(estimatedCount);
            if (Number.isNaN(price) || price <= 0) {
                setError("请输入有效的单次价格");
                return;
            }
            if (Number.isNaN(count) || count <= 0) {
                setError("请输入有效的预估次数");
                return;
            }
            onSave({
                name: trimmedName,
                budget: budgetNum,
                tracking,
                unitPrice: price,
                estimatedCount: count,
            });
        } else {
            onSave({ name: trimmedName, budget: budgetNum, tracking });
        }
    };

    return (
        <ModalBackdrop onClose={onClose}>
            <motion.div
                className="relative bg-card w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6 shadow-xl max-h-[85vh] overflow-auto"
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className="text-lg font-bold mb-4">
                    {isEdit ? "编辑子项" : "添加子项"}
                </h2>

                <div className="space-y-4">
                    {/* 名称 */}
                    <div>
                        <Label htmlFor={nameId} className="text-sm">
                            名称
                        </Label>
                        <Input
                            id={nameId}
                            placeholder='例如"赛车"、"聚餐"'
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                setError("");
                            }}
                            autoFocus
                        />
                    </div>

                    {/* 预算 */}
                    <div>
                        <Label htmlFor={budgetId} className="text-sm">
                            月度预算 ¥
                        </Label>
                        <Input
                            id={budgetId}
                            type="number"
                            placeholder="1,000"
                            value={budget}
                            onChange={(e) => {
                                setBudget(e.target.value);
                                setError("");
                            }}
                        />
                    </div>

                    {/* 追踪方式 */}
                    <div>
                        <Label className="text-sm mb-2 block">追踪方式</Label>
                        <RadioGroup
                            value={tracking}
                            onValueChange={(v) => {
                                setTracking(v as TrackingMode);
                                setError("");
                            }}
                        >
                            <label
                                htmlFor={trackPerUseId}
                                className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:border-primary/40 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                            >
                                <RadioGroupItem
                                    id={trackPerUseId}
                                    value="per-use"
                                />
                                <div>
                                    <span className="text-sm font-medium">
                                        按次追踪
                                    </span>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        每次消费记一笔，自动倒计数
                                    </p>
                                </div>
                            </label>
                            <label
                                htmlFor={trackMonthlyId}
                                className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:border-primary/40 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                            >
                                <RadioGroupItem
                                    id={trackMonthlyId}
                                    value="monthly-estimate"
                                />
                                <div>
                                    <span className="text-sm font-medium">
                                        按月估算
                                    </span>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        每天自动扣估算值，懒得细分时用
                                    </p>
                                </div>
                            </label>
                            <label
                                htmlFor={trackFixedId}
                                className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:border-primary/40 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                            >
                                <RadioGroupItem
                                    id={trackFixedId}
                                    value="fixed-monthly"
                                />
                                <div>
                                    <span className="text-sm font-medium">
                                        固定月费
                                    </span>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        每月固定扣除，不追踪次数
                                    </p>
                                </div>
                            </label>
                        </RadioGroup>
                    </div>

                    {/* 按次模式：额外字段 */}
                    {tracking === "per-use" && (
                        <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-secondary/30">
                            <div>
                                <Label
                                    htmlFor={unitPriceId}
                                    className="text-sm"
                                >
                                    单次价格 ¥
                                </Label>
                                <Input
                                    id={unitPriceId}
                                    type="number"
                                    placeholder="470"
                                    value={unitPrice}
                                    onChange={(e) => {
                                        setUnitPrice(e.target.value);
                                        setError("");
                                    }}
                                />
                            </div>
                            <div>
                                <Label htmlFor={estCountId} className="text-sm">
                                    预估次数/月
                                </Label>
                                <Input
                                    id={estCountId}
                                    type="number"
                                    placeholder="4"
                                    value={estimatedCount}
                                    onChange={(e) => {
                                        setEstimatedCount(e.target.value);
                                        setError("");
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    {/* 错误提示 */}
                    {error && (
                        <p className="text-sm text-destructive font-medium">
                            {error}
                        </p>
                    )}

                    {/* 操作按钮 */}
                    <div className="flex gap-2 pt-2">
                        <Button
                            variant="outline"
                            className="flex-1"
                            onClick={onClose}
                        >
                            取消
                        </Button>
                        <Button className="flex-1" onClick={handleSave}>
                            {isEdit ? "保存修改" : "添加"}
                        </Button>
                    </div>

                    {/* 删除按钮（仅编辑模式） */}
                    {isEdit && onDelete && (
                        <Button
                            variant="destructive"
                            className="w-full"
                            onClick={() => {
                                onDelete();
                                onClose();
                            }}
                        >
                            <Trash2 className="size-4 mr-1" />
                            删除子项
                        </Button>
                    )}
                </div>
            </motion.div>
        </ModalBackdrop>
    );
}

// ─── 发薪弹窗 ───

function SalaryModal({
    open,
    onClose,
    poolId,
}: {
    open: boolean;
    onClose: () => void;
    poolId: string;
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
        toast(`已分配 ¥${num.toLocaleString()} 到 ${res.length} 个资金池`);
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
                                    className={`flex items-center justify-between py-2 border-b border-border last:border-0 ${
                                        r.poolId === poolId
                                            ? "bg-primary/5 -mx-2 px-2 rounded-md"
                                            : ""
                                    }`}
                                >
                                    <span className="text-sm">
                                        {r.poolName}
                                        {r.poolId === poolId && (
                                            <span className="text-xs text-primary ml-1">
                                                ← 当前
                                            </span>
                                        )}
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

// ─── 主页面：池子详情 ───

export default function PoolDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const poolId = id ?? "";

    // Store selectors
    const pool = useHorizonStore((s) => s.pools.find((p) => p.id === poolId));
    const allPools = useHorizonStore((s) => s.pools);
    const updatePool = useHorizonStore((s) => s.updatePool);
    const addSubItem = useHorizonStore((s) => s.addSubItem);
    const updateSubItem = useHorizonStore((s) => s.updateSubItem);
    const removeSubItem = useHorizonStore((s) => s.removeSubItem);
    const removePool = useHorizonStore((s) => s.removePool);
    const addGrowthEvent = useHorizonStore((s) => s.addGrowthEvent);
    const chargePoolFixedMonthly = useHorizonStore(
        (s) => s.chargePoolFixedMonthly,
    );

    // 进入页面时尝试扣清固定月费（修复历史未扣数据）
    useEffect(() => {
        if (poolId) chargePoolFixedMonthly(poolId);
    }, [poolId, chargePoolFixedMonthly]);

    // Local UI state
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
    const [salaryOpen, setSalaryOpen] = useState(false);
    const [addFormOpen, setAddFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<PoolSubItem | null>(null);
    const [activeId, setActiveId] = useState<string | null>(null);

    // dnd-kit sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 },
        }),
    );

    // ── Pool not found ──
    if (!pool) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <Package className="size-16 text-muted-foreground opacity-30" />
                <p className="text-muted-foreground font-medium">
                    资金池未找到
                </p>
                <p className="text-sm text-muted-foreground">
                    该资金池可能已被删除
                </p>
                <Button variant="outline" onClick={() => navigate("/")}>
                    <ChevronLeft className="size-4 mr-1" />
                    返回资金池列表
                </Button>
            </div>
        );
    }

    const subItems = pool.subItems ?? [];
    const stash = getPoolStash(pool);
    const otherPools = allPools.filter((p) => p.id !== pool.id);

    // ── Drag handlers ──
    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const oldIndex = subItems.findIndex((si) => si.id === active.id);
            const newIndex = subItems.findIndex((si) => si.id === over.id);
            if (oldIndex !== -1 && newIndex !== -1) {
                const reordered = [...subItems];
                const [moved] = reordered.splice(oldIndex, 1);
                reordered.splice(newIndex, 0, moved);
                updatePool(pool.id, { subItems: reordered });
            }
        }
        setActiveId(null);
    };

    const activeItem = activeId
        ? (subItems.find((si) => si.id === activeId) ?? null)
        : null;

    // ── Sub-item CRUD handlers ──
    const handleAddSubItem = (data: {
        name: string;
        budget: number;
        tracking: TrackingMode;
        unitPrice?: number;
        estimatedCount?: number;
    }) => {
        addSubItem(pool.id, {
            name: data.name,
            icon: "📌",
            budget: data.budget,
            tracking: data.tracking,
            unitPrice: data.unitPrice,
            estimatedCount: data.estimatedCount,
        });
        addGrowthEvent({
            date: new Date().toISOString(),
            type: "subitem-adjust",
            summary: `➕ 在「${pool.name}」中添加了子项"${data.name}"`,
        });
        setAddFormOpen(false);
    };

    const handleEditSubItem = (data: {
        name: string;
        budget: number;
        tracking: TrackingMode;
        unitPrice?: number;
        estimatedCount?: number;
    }) => {
        if (!editingItem) return;
        updateSubItem(pool.id, editingItem.id, {
            name: data.name,
            budget: data.budget,
            tracking: data.tracking,
            unitPrice: data.unitPrice,
            estimatedCount: data.estimatedCount,
        });
        addGrowthEvent({
            date: new Date().toISOString(),
            type: "subitem-adjust",
            summary: `✏️ 在「${pool.name}」中更新了子项"${data.name}"`,
        });
        setEditingItem(null);
    };

    const handleDeleteSubItem = () => {
        if (!editingItem) return;
        removeSubItem(pool.id, editingItem.id);
        addGrowthEvent({
            date: new Date().toISOString(),
            type: "subitem-adjust",
            summary: `🗑️ 在「${pool.name}」中删除了子项"${editingItem.name}"`,
        });
        setEditingItem(null);
    };

    return (
        <div className="flex flex-col h-full">
            {/* ── 顶部导航栏 ── */}
            <header className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
                <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => navigate("/")}
                >
                    <ChevronLeft className="size-5" />
                </Button>
                <span className="text-2xl">{pool.icon}</span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h1 className="font-bold text-lg truncate">
                            {pool.name}
                        </h1>
                        <span className="text-xs px-1.5 py-0.5 rounded-md bg-secondary text-secondary-foreground font-medium shrink-0">
                            {RULE_LABELS[pool.rule] ?? pool.rule}
                        </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        优先级 {pool.priority}
                    </p>
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSalaryOpen(true)}
                >
                    <Wallet className="size-4 mr-1" />
                    发薪
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDeleteOpen(true)}
                >
                    <Trash2 className="size-4" />
                </Button>
            </header>

            {/* ── 余额 / 扣款概览 ── */}
            <div className="px-4 pt-4 shrink-0">
                <div className="rounded-2xl bg-card border border-border p-4 flex items-center justify-between">
                    <div>
                        {isExpensePool(pool) ? (
                            <>
                                <p className="text-xs text-muted-foreground mb-1">
                                    本月固定开销
                                </p>
                                {isQuotaFullyDeducted(pool) ? (
                                    <div className="flex items-center gap-2">
                                        <span className="size-8 rounded-full bg-emerald-500 text-white flex items-center justify-center text-lg">
                                            ✓
                                        </span>
                                        <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                                            已扣 ¥
                                            {poolQuota(pool).toLocaleString()}
                                        </span>
                                    </div>
                                ) : (
                                    <p className="text-2xl font-bold tabular-nums text-foreground">
                                        待扣 ¥
                                        {(
                                            poolQuota(pool) -
                                            (pool.quotaDeducted ?? 0)
                                        ).toLocaleString()}
                                    </p>
                                )}
                            </>
                        ) : (
                            <>
                                <p className="text-xs text-muted-foreground mb-1">
                                    当前余额
                                </p>
                                <motion.span
                                    className="text-3xl font-bold tabular-nums text-foreground"
                                    key={pool.balance}
                                    initial={{ scale: 1.15 }}
                                    animate={{ scale: 1 }}
                                    transition={{
                                        type: "spring",
                                        stiffness: 300,
                                        damping: 20,
                                    }}
                                >
                                    ¥{pool.balance.toLocaleString()}
                                </motion.span>
                            </>
                        )}
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                        <p>{RULE_LABELS[pool.rule] ?? pool.rule}</p>
                        {pool.rule === "fixed" && pool.fixedAmount && (
                            <p>每月 ¥{pool.fixedAmount.toLocaleString()}</p>
                        )}
                        {pool.rule === "percent" && pool.percentRate && (
                            <p>收入 × {Math.round(pool.percentRate * 100)}%</p>
                        )}
                        {pool.rule === "residual-factor" &&
                            pool.residualFactor && (
                                <p>
                                    剩余 ×{" "}
                                    {Math.round(pool.residualFactor * 100)}%
                                </p>
                            )}
                        {pool.rule === "remainder" && <p>兜底接收</p>}
                    </div>
                </div>
            </div>

            {/* ── 子项列表标题 ── */}
            <div className="flex items-center justify-between px-4 pt-5 pb-2 shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">
                        子项管理
                    </span>
                    {subItems.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                            {subItems.length} 项
                        </span>
                    )}
                </div>
                {subItems.length > 1 && (
                    <span className="text-xs text-muted-foreground">
                        长按拖拽排序
                    </span>
                )}
            </div>

            {/* ── 子项列表（可拖拽） ── */}
            <div className="flex-1 overflow-auto px-4">
                {subItems.length === 0 ? (
                    <div className="text-center text-muted-foreground py-16">
                        <Package className="size-12 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">还没有子项</p>
                        <p className="text-sm mt-1">
                            点击下方按钮添加第一个消费项
                        </p>
                    </div>
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={subItems.map((si) => si.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            <div className="space-y-2 pb-2">
                                <AnimatePresence>
                                    {subItems.map((item) => (
                                        <SubItemCard
                                            key={item.id}
                                            item={item}
                                            pool={pool}
                                            onEdit={setEditingItem}
                                        />
                                    ))}
                                </AnimatePresence>
                            </div>
                        </SortableContext>

                        <DragOverlay dropAnimation={null}>
                            {activeItem ? (
                                <div className="rounded-xl border-2 border-primary bg-card shadow-2xl opacity-95 scale-[1.02] rotate-[0.3deg]">
                                    <div className="p-3">
                                        <div className="flex items-center gap-2">
                                            <GripVertical className="size-4 text-primary" />
                                            <span className="text-lg">
                                                {activeItem.icon}
                                            </span>
                                            <span className="font-medium text-sm text-foreground">
                                                {activeItem.name}
                                            </span>
                                            <span
                                                className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${TRACKING_BADGE_CLASS[activeItem.tracking]}`}
                                            >
                                                {
                                                    TRACKING_LABELS[
                                                        activeItem.tracking
                                                    ]
                                                }
                                            </span>
                                            <span className="text-sm font-mono tabular-nums text-muted-foreground">
                                                ¥
                                                {activeItem.spent.toLocaleString()}
                                                /¥
                                                {activeItem.budget.toLocaleString()}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </DragOverlay>
                    </DndContext>
                )}
            </div>

            {/* ── 添加子项按钮 ── */}
            <div className="px-4 pt-1 pb-3 shrink-0">
                <Button
                    variant="outline"
                    className="w-full border-dashed"
                    onClick={() => setAddFormOpen(true)}
                >
                    <Plus className="size-4 mr-1" />
                    添加子项
                </Button>
            </div>

            {/* ── 暂存区 ── */}
            <div className="px-4 pb-4 shrink-0">
                <div className="rounded-2xl bg-card border border-border p-4 space-y-3">
                    {/* 暂存金额 */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <PiggyBank className="size-5 text-muted-foreground" />
                            <span className="text-sm font-medium text-muted-foreground">
                                暂存
                            </span>
                        </div>
                        <motion.span
                            className="text-xl font-bold tabular-nums"
                            key={stash}
                            initial={{ scale: 1.15 }}
                            animate={{ scale: 1 }}
                            transition={{
                                type: "spring",
                                stiffness: 300,
                                damping: 20,
                            }}
                        >
                            ¥{stash.toLocaleString()}
                        </motion.span>
                    </div>

                    {stash > 0 && (
                        <p className="text-xs text-muted-foreground">
                            子项预算未花完的部分，自动归入暂存
                        </p>
                    )}
                    {stash === 0 && subItems.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                            所有子项预算都已用完
                        </p>
                    )}
                    {stash === 0 && subItems.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                            添加子项后，未花完的预算将在此暂存
                        </p>
                    )}

                    {/* 自动流转设置 */}
                    <div className="pt-2 border-t border-border">
                        <Label className="text-xs text-muted-foreground mb-1.5 block">
                            未花完的钱默认转入
                        </Label>
                        <Select
                            value={pool.autoFlowTo ?? ""}
                            onValueChange={(v) =>
                                updatePool(pool.id, {
                                    autoFlowTo: v || undefined,
                                })
                            }
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="选择目标池子" />
                            </SelectTrigger>
                            <SelectContent>
                                {otherPools.length > 0 ? (
                                    otherPools.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.icon} {p.name}
                                        </SelectItem>
                                    ))
                                ) : (
                                    <SelectItem value="__none__" disabled>
                                        没有可选择的目标池子
                                    </SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                        {pool.autoFlowTo && (
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1.5">
                                月底暂存将自动转入{" "}
                                {allPools.find((p) => p.id === pool.autoFlowTo)
                                    ?.name ?? ""}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* ── 弹窗 ── */}
            <AnimatePresence>
                {salaryOpen && (
                    <SalaryModal
                        open={salaryOpen}
                        onClose={() => setSalaryOpen(false)}
                        poolId={pool.id}
                    />
                )}
                {addFormOpen && (
                    <SubItemFormModal
                        open={addFormOpen}
                        onClose={() => setAddFormOpen(false)}
                        onSave={handleAddSubItem}
                    />
                )}
                {editingItem && (
                    <SubItemFormModal
                        open={!!editingItem}
                        onClose={() => setEditingItem(null)}
                        onSave={handleEditSubItem}
                        initial={editingItem}
                        onDelete={handleDeleteSubItem}
                    />
                )}
                {confirmDeleteOpen && (
                    <ConfirmModal
                        open={confirmDeleteOpen}
                        title="删除资金池"
                        message={`确认删除「${pool.name}」？池内余额将转入兜底池（如零花钱），不会消失。`}
                        onConfirm={() => {
                            const result = removePool(pool.id);
                            if (result.releasedTo) {
                                toast(
                                    `已删除「${pool.name}」，¥${result.releasedTo.amount.toLocaleString()} 已转入「${result.releasedTo.poolName}」`,
                                );
                            } else {
                                toast(`已删除「${pool.name}」`);
                            }
                            navigate("/", { replace: true });
                        }}
                        onCancel={() => setConfirmDeleteOpen(false)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
