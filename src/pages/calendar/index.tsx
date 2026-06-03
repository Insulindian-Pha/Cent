// 日历 + 生活费一体化页面
// 上方：电池电量条（瞄一眼就知道情况）
// 下方：日历每日花销记录（生活费估算 + per-use 打卡 + 手动备注）

import dayjs from "dayjs";
import { ChevronLeft, ChevronRight, Pencil, Settings } from "lucide-react";
import {
    AnimatePresence,
    motion,
    useMotionValue,
    useSpring,
} from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    type DayJournalEntry,
    daysInMonth,
    elapsedDays,
    generateMonthEntries,
    getDayJournal,
    getMonthBudget,
    getMonthSpent,
} from "@/horizon/living";
import { ModalBackdrop } from "@/horizon/modal-backdrop";
import { useHorizonStore } from "@/store/horizon";

// ═══════════════════════════════════════════════════════════════
// 环形电池条
// ═══════════════════════════════════════════════════════════════

const RING_SIZE = 160;
const RING_STROKE = 12;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function BatteryRing({
    spentPercent,
    remaining,
    daysLeft,
}: {
    spentPercent: number;
    remaining: number;
    daysLeft: number;
}) {
    const targetOffset =
        RING_CIRCUMFERENCE -
        (Math.min(spentPercent, 100) / 100) * RING_CIRCUMFERENCE;

    const motionOffset = useMotionValue(RING_CIRCUMFERENCE);
    const springOffset = useSpring(motionOffset, {
        stiffness: 80,
        damping: 18,
    });

    useEffect(() => {
        motionOffset.set(targetOffset);
    }, [motionOffset, targetOffset]);

    const colorClass =
        spentPercent > 90
            ? "stroke-red-500"
            : spentPercent > 70
              ? "stroke-amber-500"
              : "stroke-emerald-500";

    const textColorClass =
        spentPercent > 90
            ? "text-red-500"
            : spentPercent > 70
              ? "text-amber-500"
              : "text-emerald-500";

    return (
        <div className="relative inline-flex items-center justify-center">
            <svg
                width={RING_SIZE}
                height={RING_SIZE}
                className="transform -rotate-90"
                style={{ willChange: "transform" }}
                role="img"
                aria-label={`月度预算已花费 ${Math.round(spentPercent)}%`}
            >
                <circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    fill="none"
                    strokeWidth={RING_STROKE}
                    className="stroke-muted-foreground/20"
                    strokeLinecap="round"
                />
                <motion.circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    fill="none"
                    className={colorClass}
                    strokeWidth={RING_STROKE}
                    strokeLinecap="round"
                    strokeDasharray={RING_CIRCUMFERENCE}
                    style={{ strokeDashoffset: springOffset }}
                    transition={{ type: "spring", stiffness: 80, damping: 18 }}
                />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <motion.span
                    className={`text-xl font-bold tabular-nums ${textColorClass}`}
                    key={remaining}
                    initial={{ scale: 1.2 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                >
                    {remaining >= 0 ? "¥" : "-¥"}
                    {Math.abs(remaining).toLocaleString()}
                </motion.span>
                <span className="text-[10px] text-muted-foreground mt-0.5">
                    {remaining >= 0 ? "剩余" : "超支"} · 剩 {daysLeft} 天
                </span>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// 每日预算 + 余额校准（PRD 模块 6）
// ═══════════════════════════════════════════════════════════════

function LivingControls({
    dailyBudget,
    autoRemaining,
    daysLeft,
    todayDate,
    onDailyBudgetChange,
    onCalibrate,
}: {
    dailyBudget: number;
    autoRemaining: number;
    daysLeft: number;
    todayDate: string;
    onDailyBudgetChange: (v: number) => void;
    onCalibrate: (newRemaining: number) => void;
}) {
    const [calValue, setCalValue] = useState("");
    const [showCal, setShowCal] = useState(false);
    const [showBudgetInput, setShowBudgetInput] = useState(false);
    const [budgetInput, setBudgetInput] = useState("");

    const effectiveDaily =
        daysLeft > 0 ? Math.round(autoRemaining / daysLeft) : 0;

    const handleCalibrate = () => {
        const userRemaining = Number.parseFloat(calValue);
        if (Number.isNaN(userRemaining) || userRemaining < 0) return;
        onCalibrate(userRemaining);
        setCalValue("");
        setShowCal(false);
    };

    return (
        <div className="pt-2 border-t border-border/50 space-y-2">
            {/* 紧凑信息行 */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                    每 {dailyBudget.toLocaleString()}/天
                    {daysLeft > 0 &&
                        ` · 剩余约 ¥${effectiveDaily.toLocaleString()}/天`}
                </span>
                <span className="flex items-center gap-2">
                    {!showBudgetInput ? (
                        <button
                            type="button"
                            onClick={() => {
                                setBudgetInput(String(dailyBudget));
                                setShowBudgetInput(true);
                            }}
                            className="hover:text-primary transition-colors"
                        >
                            调整每日预算
                        </button>
                    ) : (
                        <span className="flex items-center gap-1">
                            <Input
                                type="number"
                                value={budgetInput}
                                onChange={(e) => setBudgetInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        const v = Number(budgetInput);
                                        if (v >= 20 && v <= 500)
                                            onDailyBudgetChange(v);
                                        setShowBudgetInput(false);
                                    }
                                }}
                                className="h-7 w-16 text-center text-xs"
                                autoFocus
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    const v = Number(budgetInput);
                                    if (v >= 20 && v <= 500)
                                        onDailyBudgetChange(v);
                                    setShowBudgetInput(false);
                                }}
                                className="text-primary text-xs hover:underline"
                            >
                                确定
                            </button>
                        </span>
                    )}
                </span>
            </div>

            {/* 余额校准：输入本月生活费总额剩余 */}
            {!showCal ? (
                <button
                    type="button"
                    onClick={() => setShowCal(true)}
                    className="w-full text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                    觉得不对？校准本月剩余总额
                </button>
            ) : (
                <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground text-center">
                        本月生活费实际还剩多少？
                    </p>
                    <div className="flex gap-2">
                        <Input
                            type="number"
                            placeholder={`估 ¥${autoRemaining.toLocaleString()}`}
                            value={calValue}
                            onChange={(e) => setCalValue(e.target.value)}
                            onKeyDown={(e) =>
                                e.key === "Enter" && handleCalibrate()
                            }
                            className="h-8 text-center font-bold text-sm"
                            autoFocus
                        />
                        <Button size="sm" onClick={handleCalibrate}>
                            校准
                        </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground/70 text-center">
                        差额将记入今天，后续日均自动重算
                    </p>
                    <button
                        type="button"
                        onClick={() => setShowCal(false)}
                        className="w-full text-[10px] text-muted-foreground hover:text-foreground"
                    >
                        取消
                    </button>
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// 生活费设置弹窗
// ═══════════════════════════════════════════════════════════════

function SettingsPanel({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const config = useHorizonStore((s) => s.livingConfig);
    const setLivingConfig = useHorizonStore((s) => s.setLivingConfig);

    const [daily, setDaily] = useState(String(config.dailyBudget ?? ""));

    if (!open) return null;

    const handleSave = () => {
        const d = Number.parseInt(daily, 10);
        if (d > 0) setLivingConfig({ dailyBudget: d });
        toast("每日预算已更新");
        onClose();
    };

    return (
        <ModalBackdrop onClose={onClose}>
            <motion.div
                className="relative bg-card w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6 shadow-xl"
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="font-bold mb-4">生活费设置</h3>
                <div className="space-y-3">
                    <div>
                        <Label className="text-sm">每日预算 ¥</Label>
                        <Input
                            type="number"
                            value={daily}
                            onChange={(e) => setDaily(e.target.value)}
                        />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                        房租由资金池「固定开销」管理，不在此处计算
                    </p>
                    <div className="flex gap-2 pt-1">
                        <Button
                            variant="outline"
                            className="flex-1"
                            onClick={onClose}
                        >
                            取消
                        </Button>
                        <Button className="flex-1" onClick={handleSave}>
                            保存
                        </Button>
                    </div>
                </div>
            </motion.div>
        </ModalBackdrop>
    );
}

// ═══════════════════════════════════════════════════════════════
// 某天详情弹窗
// ═══════════════════════════════════════════════════════════════

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function todayStr(): string {
    return dayjs().format("YYYY-MM-DD");
}

function DayDetailModal({
    entry,
    onClose,
}: {
    entry: DayJournalEntry;
    onClose: () => void;
}) {
    const upsertExpense = useHorizonStore((s) => s.upsertExpense);
    const [editing, setEditing] = useState(false);
    const [actualStr, setActualStr] = useState(
        entry.isLivingManual ? String(entry.livingActual) : "",
    );
    const [note, setNote] = useState(entry.livingNote ?? "");

    const handleSaveCalibration = () => {
        const num = Number.parseFloat(actualStr);
        if (Number.isNaN(num) || num < 0) return;
        upsertExpense(entry.date, num, note || undefined);
        toast("已校准");
        setEditing(false);
    };

    const hasTaps = entry.taps.length > 0;
    const showEdit = !editing;
    const d = dayjs(entry.date);

    return (
        <ModalBackdrop onClose={onClose}>
            <motion.div
                className="relative bg-card w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6 shadow-xl max-h-[80vh] overflow-auto"
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="text-center mb-4">
                    <p className="text-lg font-bold">{d.format("M月D日")}</p>
                    <p className="text-xs text-muted-foreground">
                        {d.format("dddd")}
                    </p>
                </div>

                {/* 生活费行 */}
                <div className="rounded-xl border border-border p-3 mb-3">
                    {showEdit ? (
                        <div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">
                                    生活费
                                </span>
                                <span className="text-sm tabular-nums">
                                    ¥{entry.livingActual.toLocaleString()}
                                </span>
                            </div>
                            {entry.isLivingManual && entry.livingNote && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    {entry.livingNote}
                                </p>
                            )}
                            <div className="flex items-center gap-2 mt-2">
                                {entry.isLivingManual ? (
                                    <span className="text-[10px] text-muted-foreground">
                                        预算 ¥
                                        {entry.livingBudget.toLocaleString()}
                                    </span>
                                ) : (
                                    <span className="text-[10px] text-muted-foreground">
                                        此为估算值
                                    </span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setEditing(true)}
                                    className="ml-auto text-xs text-primary hover:underline flex items-center gap-1"
                                >
                                    <Pencil className="size-3" />
                                    {entry.isLivingManual ? "修改" : "校准"}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <Label className="text-sm">
                                实际花费 ¥（留空=用估算）
                            </Label>
                            <Input
                                type="number"
                                placeholder={`¥${entry.livingBudget.toLocaleString()}`}
                                value={actualStr}
                                onChange={(e) => setActualStr(e.target.value)}
                                autoFocus
                            />
                            <Input
                                placeholder="备注（可选）"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                            />
                            <div className="flex gap-2 pt-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1"
                                    onClick={() => setEditing(false)}
                                >
                                    取消
                                </Button>
                                <Button
                                    size="sm"
                                    className="flex-1"
                                    onClick={handleSaveCalibration}
                                >
                                    保存
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* 打卡列表 */}
                {hasTaps && (
                    <div className="rounded-xl border border-border p-3 mb-3">
                        <p className="text-sm font-medium mb-2">
                            打卡记录 · {entry.taps.length} 笔
                        </p>
                        <div className="space-y-2">
                            {entry.taps.map((tap) => (
                                <div
                                    key={tap.id}
                                    className="flex items-center gap-2 text-sm"
                                >
                                    <span className="text-xs shrink-0 bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">
                                        {dayjs(tap.timestamp).format("HH:mm")}
                                    </span>
                                    <span className="text-muted-foreground">
                                        {tap.poolName}
                                    </span>
                                    <span className="text-muted-foreground">
                                        ·
                                    </span>
                                    <span className="flex-1 truncate">
                                        {tap.itemName}
                                    </span>
                                    <span className="font-mono tabular-nums shrink-0 font-medium">
                                        ¥{tap.amount.toLocaleString()}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {!hasTaps && !entry.isLivingManual && (
                    <div className="text-center py-4 text-sm text-muted-foreground">
                        当日无额外花销记录
                    </div>
                )}

                {/* 当日总计 */}
                <div className="flex items-center justify-between rounded-xl bg-secondary/30 p-3">
                    <span className="text-sm font-bold">当日总计</span>
                    <motion.span
                        className="text-lg font-bold tabular-nums"
                        key={entry.grandTotal}
                        initial={{ scale: 1.2 }}
                        animate={{ scale: 1 }}
                        transition={{
                            type: "spring",
                            stiffness: 300,
                            damping: 20,
                        }}
                    >
                        ¥{entry.grandTotal.toLocaleString()}
                    </motion.span>
                </div>
            </motion.div>
        </ModalBackdrop>
    );
}

// ═══════════════════════════════════════════════════════════════
// 日历网格
// ═══════════════════════════════════════════════════════════════

function JournalGrid({
    entries,
    year,
    month,
    onDayClick,
}: {
    entries: DayJournalEntry[];
    year: number;
    month: number;
    onDayClick: (entry: DayJournalEntry) => void;
}) {
    const today = dayjs();
    const days = daysInMonth(year, month);
    const firstDow = dayjs(
        `${year}-${String(month).padStart(2, "0")}-01`,
    ).day();
    const startOffset = firstDow === 0 ? 6 : firstDow - 1;

    const entryMap = useMemo(() => {
        const m = new Map<string, DayJournalEntry>();
        for (const e of entries) m.set(e.date, e);
        return m;
    }, [entries]);

    const cells: (DayJournalEntry | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= days; d++) {
        const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        cells.push(entryMap.get(date) ?? null);
    }

    return (
        <div>
            <div className="grid grid-cols-7 mb-1">
                {WEEKDAYS.map((w) => (
                    <div
                        key={w}
                        className="text-center text-[10px] font-medium text-muted-foreground py-1"
                    >
                        {w}
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
                {cells.map((entry, i) => {
                    if (!entry) return <div key={`empty-${i}`} />;

                    const dateStr = entry.date;
                    const d = Number.parseInt(dateStr.split("-")[2] ?? "1", 10);
                    const isToday = dateStr === today.format("YYYY-MM-DD");
                    const isFuture = dateStr > today.format("YYYY-MM-DD");
                    const hasTaps = entry.taps.length > 0;
                    // 生活费差额 = 实际 - 预算
                    const livingDiff = entry.livingActual - entry.livingBudget;
                    const isOver = livingDiff > 0;
                    const isUnder = livingDiff < 0;
                    const hasCalibration = entry.isLivingManual;
                    const showLiving = !isFuture && entry.livingBudget > 0;

                    // 颜色：超支红 / 节省绿 / 持平灰
                    let bgClass = "bg-muted/30 hover:bg-muted/50";
                    let amountClass = "text-muted-foreground";
                    if (showLiving) {
                        if (isOver) {
                            bgClass =
                                "bg-red-500/10 hover:bg-red-500/20 border border-red-500/20";
                            amountClass = "text-red-600 dark:text-red-400";
                        } else if (isUnder) {
                            bgClass =
                                "bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20";
                            amountClass =
                                "text-emerald-600 dark:text-emerald-400";
                        } else {
                            bgClass =
                                "bg-card hover:bg-muted/60 border border-border/50";
                            amountClass = "text-foreground";
                        }
                    }

                    return (
                        <button
                            key={dateStr}
                            type="button"
                            onClick={() => onDayClick(entry)}
                            className={`relative rounded-lg p-1.5 text-left transition-colors cursor-pointer ${bgClass} ${
                                isToday
                                    ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
                                    : ""
                            }`}
                        >
                            <div
                                className={`text-xs font-medium mb-0.5 ${
                                    isToday
                                        ? "text-primary"
                                        : "text-foreground/80"
                                }`}
                            >
                                {d}
                            </div>

                            {/* 生活费金额 */}
                            {showLiving && (
                                <div
                                    className={`text-xs font-mono font-semibold tabular-nums ${amountClass}`}
                                >
                                    ¥
                                    {entry.livingActual >= 1000
                                        ? `${(entry.livingActual / 1000).toFixed(1)}k`
                                        : entry.livingActual.toLocaleString()}
                                </div>
                            )}

                            {/* 差额标记 */}
                            {showLiving && livingDiff !== 0 && (
                                <div
                                    className={`text-[10px] font-mono tabular-nums mt-0.5 ${
                                        isOver
                                            ? "text-red-500"
                                            : "text-emerald-500"
                                    }`}
                                >
                                    {isOver ? "+" : "-"}¥
                                    {Math.abs(livingDiff).toLocaleString()}
                                </div>
                            )}

                            {/* 校准过标记 */}
                            {hasCalibration && (
                                <div className="absolute top-1 right-1 text-[8px] text-muted-foreground/60">
                                    ✎
                                </div>
                            )}

                            {/* Tap 标记点 */}
                            {hasTaps && (
                                <div className="absolute bottom-1 right-1 size-1.5 rounded-full bg-primary" />
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// 主页面
// ═══════════════════════════════════════════════════════════════

export default function CalendarPage() {
    const navigate = useNavigate();
    const config = useHorizonStore((s) => s.livingConfig);
    const setLivingConfig = useHorizonStore((s) => s.setLivingConfig);
    const expenses = useHorizonStore((s) => s.expenses);
    const tapEvents = useHorizonStore((s) => s.tapEvents);
    const upsertExpense = useHorizonStore((s) => s.upsertExpense);
    const pools = useHorizonStore((s) => s.pools);
    const calibrateLivingBalance = useHorizonStore(
        (s) => s.calibrateLivingBalance,
    );
    const ensureDailyDecrement = useHorizonStore((s) => s.ensureDailyDecrement);

    const today = dayjs();
    const [viewYear, setViewYear] = useState(today.year());
    const [viewMonth, setViewMonth] = useState(today.month() + 1);
    const [detailDate, setDetailDate] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);

    // 进入日历页时检查每日扣减
    useEffect(() => {
        ensureDailyDecrement();
    }, [ensureDailyDecrement]);

    // ── 生活费数据 ──
    const livingPool = pools.find((p) => p.id === config.linkedPoolId);
    const allocated = livingPool?.fixedAmount ?? 0;
    const poolBalance = livingPool?.balance ?? 0;

    // 有池子时：余额即剩余。没池子时（旧数据）：用旧计算方式 fallback
    const monthEntries = useMemo(
        () => generateMonthEntries(config, viewYear, viewMonth, expenses),
        [config, viewYear, viewMonth, expenses],
    );
    const configBudget = getMonthBudget(config, viewYear, viewMonth);
    const configSpent = getMonthSpent(monthEntries, viewYear, viewMonth);

    const monthBudget = allocated > 0 ? allocated : configBudget;
    const monthSpent =
        allocated > 0 && poolBalance > 0
            ? Math.max(0, monthBudget - poolBalance)
            : configSpent;
    const remaining =
        allocated > 0 && poolBalance > 0
            ? poolBalance
            : configBudget - configSpent;
    const spentPercent = monthBudget > 0 ? (monthSpent / monthBudget) * 100 : 0;
    const elapsed = elapsedDays(viewYear, viewMonth);
    const totalDays = daysInMonth(viewYear, viewMonth);
    const daysLeft = Math.max(0, totalDays - elapsed);

    // ── 日记数据 ──
    const monthJournal = useMemo(
        () => getDayJournal(config, expenses, tapEvents, viewYear, viewMonth),
        [config, expenses, tapEvents, viewYear, viewMonth],
    );

    const detailEntry = detailDate
        ? (monthJournal.find((j) => j.date === detailDate) ?? null)
        : null;

    const isCurrentMonth =
        viewYear === today.year() && viewMonth === today.month() + 1;

    const goMonth = (delta: number) => {
        let m = viewMonth + delta;
        let y = viewYear;
        if (m < 1) {
            m = 12;
            y--;
        }
        if (m > 12) {
            m = 1;
            y++;
        }
        setViewMonth(m);
        setViewYear(y);
    };

    const goToday = () => {
        setViewMonth(today.month() + 1);
        setViewYear(today.year());
    };

    const monthLivingTotal = monthJournal.reduce(
        (s, j) => s + j.livingActual,
        0,
    );
    const monthTapTotal = monthJournal.reduce((s, j) => s + j.tapTotal, 0);

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <header className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate("/")}
                >
                    <ChevronLeft className="size-5" />
                </Button>
                <h1 className="font-bold text-lg flex-1">每日记录</h1>
                {!isCurrentMonth && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={goToday}
                        className="text-xs"
                    >
                        今天
                    </Button>
                )}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSettingsOpen(true)}
                >
                    <Settings className="size-4" />
                </Button>
            </header>

            <div className="flex-1 overflow-auto px-4 py-4">
                <div className="max-w-lg mx-auto space-y-4">
                    {/* 月份导航 */}
                    <div className="flex items-center justify-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => goMonth(-1)}
                        >
                            <ChevronLeft className="size-4" />
                        </Button>
                        <span className="font-bold text-sm w-28 text-center">
                            {viewYear}年{viewMonth}月
                        </span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => goMonth(1)}
                        >
                            <ChevronRight className="size-4" />
                        </Button>
                    </div>

                    {/* ── 电池条区域 ── */}
                    <motion.div
                        className="rounded-2xl bg-card border border-border p-5 space-y-4"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                    >
                        {/* 环形电池 + 3 格概览 */}
                        <div className="flex items-center gap-5">
                            <BatteryRing
                                spentPercent={spentPercent}
                                remaining={remaining}
                                daysLeft={daysLeft}
                            />

                            <div className="flex-1 grid grid-cols-3 gap-1.5">
                                <div className="text-center p-2 rounded-lg bg-secondary/30">
                                    <p className="text-[10px] text-muted-foreground">
                                        月度预算
                                    </p>
                                    <p className="text-sm font-bold tabular-nums">
                                        ¥{monthBudget.toLocaleString()}
                                    </p>
                                </div>
                                <div className="text-center p-2 rounded-lg bg-secondary/30">
                                    <p className="text-[10px] text-muted-foreground">
                                        已花费
                                    </p>
                                    <p
                                        className={`text-sm font-bold tabular-nums ${
                                            remaining < 0
                                                ? "text-red-500"
                                                : "text-emerald-500"
                                        }`}
                                    >
                                        ¥{monthSpent.toLocaleString()}
                                    </p>
                                </div>
                                <div className="text-center p-2 rounded-lg bg-secondary/30">
                                    <p className="text-[10px] text-muted-foreground">
                                        日均
                                    </p>
                                    <p className="text-sm font-bold tabular-nums">
                                        {elapsed > 0
                                            ? `¥${Math.round(monthSpent / elapsed).toLocaleString()}`
                                            : "-"}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* 反馈语 */}
                        <div className="text-center">
                            {remaining >= 0 ? (
                                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                    还在可控范围
                                </p>
                            ) : (
                                <p className="text-xs text-red-500 font-medium">
                                    本月已超支，建议调整每日预算
                                </p>
                            )}
                            <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                                此为估算值，欢迎随时校准
                            </p>
                        </div>

                        {/* 每日预算 + 余额校准（仅当月） */}
                        {isCurrentMonth && (
                            <LivingControls
                                dailyBudget={config.dailyBudget}
                                autoRemaining={remaining}
                                daysLeft={daysLeft}
                                todayDate={today.format("YYYY-MM-DD")}
                                onDailyBudgetChange={(v) =>
                                    setLivingConfig({ dailyBudget: v })
                                }
                                onCalibrate={(newRemaining) => {
                                    calibrateLivingBalance(newRemaining);
                                    toast("已校准");
                                }}
                            />
                        )}
                    </motion.div>

                    {/* ── 月度合计卡片 ── */}
                    <div className="grid grid-cols-2 gap-2">
                        <motion.div
                            className="p-3 rounded-xl bg-card border border-border text-center"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <p className="text-[10px] text-muted-foreground mb-0.5">
                                生活费合计
                            </p>
                            <motion.p
                                className="text-lg font-bold tabular-nums"
                                key={monthLivingTotal}
                                initial={{ scale: 1.15 }}
                                animate={{ scale: 1 }}
                                transition={{
                                    type: "spring",
                                    stiffness: 300,
                                    damping: 20,
                                }}
                            >
                                ¥{monthLivingTotal.toLocaleString()}
                            </motion.p>
                        </motion.div>
                        <div className="p-3 rounded-xl bg-card border border-border text-center">
                            <p className="text-[10px] text-muted-foreground mb-0.5">
                                打卡合计
                            </p>
                            <p className="text-lg font-bold tabular-nums">
                                ¥{monthTapTotal.toLocaleString()}
                            </p>
                        </div>
                    </div>

                    {/* ── 日历网格 ── */}
                    <div className="p-3 rounded-xl bg-card/50 border border-border">
                        <JournalGrid
                            entries={monthJournal}
                            year={viewYear}
                            month={viewMonth}
                            onDayClick={(entry) => {
                                if (entry.date > todayStr()) return;
                                setDetailDate(entry.date);
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* 弹窗 */}
            <AnimatePresence>
                {detailEntry && (
                    <DayDetailModal
                        entry={detailEntry}
                        onClose={() => setDetailDate(null)}
                    />
                )}
                {settingsOpen && (
                    <SettingsPanel
                        open={settingsOpen}
                        onClose={() => setSettingsOpen(false)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
