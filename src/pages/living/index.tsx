// 生活费页面 —— 每日预算 + 日历 + 月度统计

import dayjs from "dayjs";
import {
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    PiggyBank,
    Settings,
    TrendingDown,
    TrendingUp,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    daysInMonth,
    generateMonthEntries,
    getDailyRemaining,
    getMonthStats,
    todayStr,
} from "@/horizon/living";
import { ModalBackdrop } from "@/horizon/modal-backdrop";
import type { DailyExpense } from "@/horizon/types";
import { useHorizonStore } from "@/store/horizon";

// ─── 今日快捷校准弹窗 ───

function QuickCalibrateModal({
    open,
    date,
    currentActual,
    budget,
    onSave,
    onClose,
}: {
    open: boolean;
    date: string;
    currentActual: number;
    budget: number;
    onSave: (actual: number, note?: string) => void;
    onClose: () => void;
}) {
    const [actual, setActual] = useState("");
    const [note, setNote] = useState("");

    if (!open) return null;

    const handleSave = () => {
        const num = Number.parseFloat(actual);
        if (Number.isNaN(num) || num < 0) return;
        onSave(num, note || undefined);
        onClose();
    };

    const diff = actual ? Number.parseFloat(actual) - budget : 0;

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
                <h3 className="font-bold mb-1">{date} 花销</h3>
                <p className="text-xs text-muted-foreground mb-4">
                    当日预算 ¥{budget.toLocaleString()}
                </p>

                <div className="space-y-3">
                    <div>
                        <Label className="text-sm">实际花费 ¥</Label>
                        <Input
                            type="number"
                            placeholder={String(budget)}
                            value={actual}
                            onChange={(e) => setActual(e.target.value)}
                            autoFocus
                        />
                        {actual && diff !== 0 && (
                            <p
                                className={`text-xs mt-1 ${diff > 0 ? "text-destructive" : "text-emerald-600"}`}
                            >
                                {diff > 0 ? "比预算多" : "比预算少"} ¥
                                {Math.abs(diff).toLocaleString()}
                            </p>
                        )}
                    </div>

                    <div>
                        <Label className="text-sm">备注（可选）</Label>
                        <Input
                            placeholder="例如：聚餐"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                        />
                    </div>

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

// ─── 设置面板 ───

function SettingsPanel({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const config = useHorizonStore((s) => s.livingConfig);
    const setLivingConfig = useHorizonStore((s) => s.setLivingConfig);
    const pools = useHorizonStore((s) => s.pools);

    const [daily, setDaily] = useState(String(config.dailyBudget || ""));
    const [rent, setRent] = useState(String(config.monthlyRent || ""));
    const [rentDay, setRentDay] = useState(
        String(config.rentDayOfMonth || "1"),
    );

    if (!open) return null;

    const handleSave = () => {
        const d = Number.parseInt(daily, 10);
        const r = Number.parseInt(rent, 10);
        const rd = Number.parseInt(rentDay, 10);
        if (d > 0) setLivingConfig({ dailyBudget: d });
        if (r > 0) setLivingConfig({ monthlyRent: r });
        if (rd >= 1 && rd <= 28) setLivingConfig({ rentDayOfMonth: rd });
        toast("生活费设置已更新");
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
                    <div>
                        <Label className="text-sm">月房租 ¥</Label>
                        <Input
                            type="number"
                            value={rent}
                            onChange={(e) => setRent(e.target.value)}
                        />
                    </div>
                    <div>
                        <Label className="text-sm">交租日</Label>
                        <Input
                            type="number"
                            min={1}
                            max={28}
                            value={rentDay}
                            onChange={(e) => setRentDay(e.target.value)}
                        />
                    </div>

                    {pools.length > 0 && (
                        <div>
                            <Label className="text-sm">
                                绑定资金池（可选）
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                当前{" "}
                                {pools.find((p) => p.id === config.linkedPoolId)
                                    ?.name ?? "未绑定"}
                            </p>
                        </div>
                    )}

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

// ─── 日历网格 ───

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function CalendarGrid({
    entries,
    year,
    month,
    rentDay,
    onDayClick,
}: {
    entries: DailyExpense[];
    year: number;
    month: number;
    rentDay: number;
    onDayClick: (entry: DailyExpense) => void;
}) {
    const today = dayjs();
    const days = daysInMonth(year, month);
    const firstDow = dayjs(
        `${year}-${String(month).padStart(2, "0")}-01`,
    ).day(); // 0=Sun
    const startOffset = firstDow === 0 ? 6 : firstDow - 1; // Mon=0

    const entryMap = useMemo(() => {
        const m = new Map<string, DailyExpense>();
        for (const e of entries) m.set(e.date, e);
        return m;
    }, [entries]);

    const cells: (DailyExpense | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= days; d++) {
        const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const entry = entryMap.get(date);
        cells.push(
            entry ?? {
                id: "",
                date,
                budget: 0,
                actual: 0,
                isManual: false,
            },
        );
    }

    return (
        <div>
            {/* 星期头 */}
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

            {/* 日期格子 */}
            <div className="grid grid-cols-7 gap-0.5">
                {cells.map((entry, i) => {
                    if (!entry) return <div key={`empty-${i}`} />;

                    const d = Number.parseInt(
                        entry.date.split("-")[2] ?? "1",
                        10,
                    );
                    const isToday = entry.date === today.format("YYYY-MM-DD");
                    const isFuture = entry.date > today.format("YYYY-MM-DD");
                    const isRentDay = d === rentDay;
                    const actual = entry.isManual ? entry.actual : entry.budget;
                    const diff = actual - entry.budget;

                    let bgClass = "bg-muted/30";
                    let textClass = "text-muted-foreground";
                    if (!isFuture && entry.budget > 0) {
                        if (diff > 0) {
                            bgClass = "bg-red-500/10 hover:bg-red-500/20";
                            textClass = "text-red-600 dark:text-red-400";
                        } else if (diff < 0) {
                            bgClass =
                                "bg-emerald-500/10 hover:bg-emerald-500/20";
                            textClass =
                                "text-emerald-600 dark:text-emerald-400";
                        } else {
                            bgClass = "bg-muted/50 hover:bg-muted";
                            textClass = "text-foreground";
                        }
                    }

                    return (
                        <button
                            key={entry.date}
                            type="button"
                            onClick={() => onDayClick(entry)}
                            className={`relative rounded-lg p-1.5 text-center transition-colors cursor-pointer ${bgClass} ${
                                isToday
                                    ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
                                    : ""
                            } ${!entry.isManual && !isFuture ? "" : ""}`}
                        >
                            <div
                                className={`text-xs font-medium ${isToday ? "text-primary" : textClass}`}
                            >
                                {d}
                                {isRentDay && (
                                    <span className="ml-0.5 text-[9px]">
                                        🏠
                                    </span>
                                )}
                            </div>
                            {entry.budget > 0 && (
                                <div
                                    className={`text-[10px] font-mono mt-0.5 truncate ${textClass} ${
                                        entry.isManual
                                            ? "underline decoration-dotted underline-offset-2"
                                            : ""
                                    }`}
                                >
                                    ¥{actual.toLocaleString()}
                                </div>
                            )}
                            {entry.note && (
                                <div className="text-[9px] text-muted-foreground truncate mt-0.5">
                                    {entry.note}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* 图例 */}
            <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground justify-center">
                <span className="flex items-center gap-1">
                    <span className="size-2 rounded-sm bg-emerald-500/30" />{" "}
                    低于预算
                </span>
                <span className="flex items-center gap-1">
                    <span className="size-2 rounded-sm bg-red-500/30" />{" "}
                    超出预算
                </span>
                <span className="flex items-center gap-1">
                    <span className="underline decoration-dotted">_</span>{" "}
                    已校准
                </span>
            </div>
        </div>
    );
}

// ─── 主页面 ───

export default function LivingPage() {
    const navigate = useNavigate();
    const config = useHorizonStore((s) => s.livingConfig);
    const rawExpenses = useHorizonStore((s) => s.expenses);
    const setLivingConfig = useHorizonStore((s) => s.setLivingConfig);
    const upsertExpense = useHorizonStore((s) => s.upsertExpense);

    const today = dayjs();
    const [viewYear, setViewYear] = useState(today.year());
    const [viewMonth, setViewMonth] = useState(today.month() + 1);

    const [settingsOpen, setSettingsOpen] = useState(false);
    const [calibrateDate, setCalibrateDate] = useState<string | null>(null);

    // 生成当月完整 entries
    const monthEntries = useMemo(
        () => generateMonthEntries(config, viewYear, viewMonth, rawExpenses),
        [config, viewYear, viewMonth, rawExpenses],
    );

    const stats = useMemo(
        () => getMonthStats(config, monthEntries, viewYear, viewMonth),
        [config, monthEntries, viewYear, viewMonth],
    );

    const remainingDaily = useMemo(
        () => getDailyRemaining(config, monthEntries, viewYear, viewMonth),
        [config, monthEntries, viewYear, viewMonth],
    );

    const todayDate = todayStr();
    const todayEntry = monthEntries.find((e) => e.date === todayDate);
    const todayBudget = todayEntry?.budget ?? config.dailyBudget;
    const todayActual = todayEntry?.isManual ? todayEntry.actual : todayBudget;
    const todayDiff = todayActual - todayBudget;

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

    const monthLabel = `${viewYear}年${viewMonth}月`;

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
                <h1 className="font-bold text-lg flex-1">生活费</h1>
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
                    {/* 月份选择 */}
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
                            {monthLabel}
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

                    {/* 月度概览卡片 */}
                    <div className="grid grid-cols-3 gap-2">
                        <div className="p-3 rounded-xl bg-card border border-border text-center">
                            <p className="text-[10px] text-muted-foreground mb-0.5">
                                月度预算
                            </p>
                            <p className="text-sm font-bold tabular-nums">
                                ¥{stats.monthBudget.toLocaleString()}
                            </p>
                        </div>
                        <div className="p-3 rounded-xl bg-card border border-border text-center">
                            <p className="text-[10px] text-muted-foreground mb-0.5">
                                已花费
                            </p>
                            <p
                                className={`text-sm font-bold tabular-nums ${
                                    stats.balance < 0
                                        ? "text-destructive"
                                        : "text-emerald-600 dark:text-emerald-400"
                                }`}
                            >
                                ¥{stats.monthSpent.toLocaleString()}
                            </p>
                        </div>
                        <div className="p-3 rounded-xl bg-card border border-border text-center">
                            <p className="text-[10px] text-muted-foreground mb-0.5">
                                日均
                            </p>
                            <p className="text-sm font-bold tabular-nums">
                                ¥{stats.dailyAvg.toLocaleString()}
                            </p>
                        </div>
                    </div>

                    {/* 房租行 */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                        <span>
                            🏠 房租 ¥{config.monthlyRent.toLocaleString()}
                        </span>
                        <span>·</span>
                        <span>每 {config.dailyBudget.toLocaleString()}/天</span>
                        {isCurrentMonth && remainingDaily > 0 && (
                            <>
                                <span>·</span>
                                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                    剩余约 ¥{remainingDaily.toLocaleString()}/天
                                </span>
                            </>
                        )}
                    </div>

                    {/* 今日卡片（仅当月） */}
                    {isCurrentMonth && (
                        <motion.div
                            className={`p-4 rounded-2xl border-2 text-center ${
                                todayDiff > 0
                                    ? "border-red-500/30 bg-red-500/5"
                                    : todayDiff < 0
                                      ? "border-emerald-500/30 bg-emerald-500/5"
                                      : "border-border bg-card"
                            }`}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <p className="text-xs text-muted-foreground mb-1">
                                今天 {todayDate}
                            </p>
                            <div className="flex items-center justify-center gap-4">
                                <div>
                                    <p className="text-[10px] text-muted-foreground">
                                        预算
                                    </p>
                                    <p className="text-lg font-bold tabular-nums">
                                        ¥{todayBudget.toLocaleString()}
                                    </p>
                                </div>
                                <div className="text-muted-foreground">vs</div>
                                <div>
                                    <p className="text-[10px] text-muted-foreground">
                                        实际
                                    </p>
                                    <p
                                        className={`text-lg font-bold tabular-nums ${
                                            todayDiff > 0
                                                ? "text-destructive"
                                                : todayDiff < 0
                                                  ? "text-emerald-600 dark:text-emerald-400"
                                                  : ""
                                        }`}
                                    >
                                        ¥{todayActual.toLocaleString()}
                                    </p>
                                </div>
                            </div>
                            {todayDiff !== 0 && (
                                <p
                                    className={`text-xs mt-1.5 ${
                                        todayDiff > 0
                                            ? "text-destructive"
                                            : "text-emerald-600 dark:text-emerald-400"
                                    }`}
                                >
                                    {todayDiff > 0 ? "比预算多" : "比预算少"} ¥
                                    {Math.abs(todayDiff).toLocaleString()}
                                </p>
                            )}
                            <Button
                                variant="outline"
                                size="sm"
                                className="mt-3"
                                onClick={() => setCalibrateDate(todayDate)}
                            >
                                {todayEntry?.isManual
                                    ? "修改今日花费"
                                    : "校准今日花费"}
                            </Button>
                        </motion.div>
                    )}

                    {/* 日历 */}
                    <div className="p-3 rounded-xl bg-card border border-border">
                        <CalendarGrid
                            entries={monthEntries}
                            year={viewYear}
                            month={viewMonth}
                            rentDay={config.rentDayOfMonth}
                            onDayClick={(entry) => {
                                const entryDate = entry.date;
                                // 未来日期不允许编辑
                                if (entryDate > todayDate) return;
                                setCalibrateDate(entryDate);
                            }}
                        />
                    </div>

                    {/* 月度统计 */}
                    <div className="p-4 rounded-xl bg-card border border-border space-y-2">
                        <h3 className="text-sm font-medium flex items-center gap-1.5">
                            <CalendarDays className="size-4 text-muted-foreground" />
                            月度统计
                        </h3>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                            <span className="text-muted-foreground">
                                预算执行率
                            </span>
                            <span
                                className={`text-right tabular-nums font-medium ${
                                    stats.executionRate > 1
                                        ? "text-destructive"
                                        : stats.executionRate > 0.9
                                          ? "text-amber-500"
                                          : ""
                                }`}
                            >
                                {Math.round(stats.executionRate * 100)}%
                            </span>

                            <span className="text-muted-foreground">
                                超支天数
                            </span>
                            <span className="text-right tabular-nums">
                                {stats.overDays > 0 && (
                                    <TrendingUp className="size-3 inline text-destructive mr-1" />
                                )}
                                {stats.overDays} 天
                            </span>

                            <span className="text-muted-foreground">
                                低于预算
                            </span>
                            <span className="text-right tabular-nums">
                                {stats.underDays > 0 && (
                                    <TrendingDown className="size-3 inline text-emerald-500 mr-1" />
                                )}
                                {stats.underDays} 天
                            </span>

                            <span className="text-muted-foreground">
                                手动校准
                            </span>
                            <span className="text-right tabular-nums">
                                {stats.manualDays} 天
                            </span>

                            <span className="text-muted-foreground">
                                月度结余
                            </span>
                            <span
                                className={`text-right tabular-nums font-bold ${
                                    stats.balance >= 0
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : "text-destructive"
                                }`}
                            >
                                {stats.balance >= 0 ? "+" : "-"}¥
                                {Math.abs(stats.balance).toLocaleString()}
                            </span>
                        </div>
                    </div>

                    {/* 快捷提示 */}
                    {isCurrentMonth && stats.balance < 0 && (
                        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive text-center">
                            本月已超支，建议控制后续每日花销在 ¥
                            {Math.max(
                                0,
                                Math.round(
                                    (stats.monthBudget - stats.monthSpent) /
                                        Math.max(
                                            1,
                                            daysInMonth(viewYear, viewMonth) -
                                                new Date().getDate(),
                                        ),
                                ),
                            ).toLocaleString()}{" "}
                            以内
                        </div>
                    )}
                </div>
            </div>

            {/* 校准弹窗 */}
            <AnimatePresence>
                {calibrateDate &&
                    (() => {
                        const entry = monthEntries.find(
                            (e) => e.date === calibrateDate,
                        );
                        const budget = entry?.budget ?? config.dailyBudget;
                        const actual = entry?.isManual ? entry.actual : 0;
                        return (
                            <QuickCalibrateModal
                                open={!!calibrateDate}
                                date={calibrateDate}
                                currentActual={actual}
                                budget={budget}
                                onSave={(val, note) => {
                                    upsertExpense(calibrateDate, val, note);
                                    toast("已记录");
                                }}
                                onClose={() => setCalibrateDate(null)}
                            />
                        );
                    })()}
            </AnimatePresence>

            {/* 设置弹窗 */}
            <AnimatePresence>
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
