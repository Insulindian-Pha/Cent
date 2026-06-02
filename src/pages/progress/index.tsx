// 目标进度页

import { ChevronLeft, ChevronRight, Image, List, Target } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
    deriveImageProgresses,
    deriveMilestoneProgresses,
    getAccelerationEstimate,
    getGoalProgress,
} from "@/horizon/goal";
import type { GoalImage, Milestone } from "@/horizon/types";
import { useHorizonStore } from "@/store/horizon";

const MODE_LABELS: Record<string, string> = {
    "multi-image": "多图模式",
    "single-image": "单图模式",
    text: "文字模式",
};

// ─── 单图切格：整格随进度均匀变亮（灰度 → 彩色） ───

function GridCell({
    src,
    col,
    row,
    cols,
    rows,
    progress,
    cellRatio,
}: {
    src: string;
    col: number;
    row: number;
    cols: number;
    rows: number;
    progress: number;
    cellRatio: string;
}) {
    const lit = Math.min(1, Math.max(0, progress));
    const grayscale = 1 - lit;
    const brightness = 0.32 + lit * 0.68;

    return (
        <div
            className="relative overflow-hidden"
            style={{ aspectRatio: cellRatio }}
        >
            <div
                className="size-full transition-[filter] duration-700 ease-out"
                style={{
                    backgroundImage: `url(${src})`,
                    backgroundSize: `${cols * 100}% ${rows * 100}%`,
                    backgroundPosition: `${cols > 1 ? col * (100 / (cols - 1)) : 0}% ${rows > 1 ? row * (100 / (rows - 1)) : 0}%`,
                    filter: `grayscale(${grayscale}) brightness(${brightness})`,
                }}
            />
        </div>
    );
}

// ─── 单图切格组件 ───

function SingleImageGrid({
    images,
    cellProgresses,
    gridCols,
    gridRows,
}: {
    images: GoalImage[];
    cellProgresses: number[];
    gridCols: number;
    gridRows: number;
}) {
    const [imgW, setImgW] = useState<number | null>(null);
    const [imgH, setImgH] = useState<number | null>(null);

    const onLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        setImgW(e.currentTarget.naturalWidth);
        setImgH(e.currentTarget.naturalHeight);
    }, []);

    const src = images[0]?.src ?? "";
    const cols = gridCols || 4;
    const rows = gridRows || 4;
    const hasDims = imgW && imgH && imgW > 0 && imgH > 0;
    const cellRatio = hasDims ? `${imgW / cols} / ${imgH / rows}` : "1 / 1";
    const gridRatio = hasDims ? `${imgW} / ${imgH}` : undefined;

    // 缓存格子渲染，避免每次重渲染都重新计算
    const cells = useMemo(
        () =>
            images.map((img, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const cellProgress = cellProgresses[i] ?? 0;
                return (
                    <GridCell
                        key={img.id ?? i}
                        src={img.src}
                        col={col}
                        row={row}
                        cols={cols}
                        rows={rows}
                        progress={cellProgress}
                        cellRatio={cellRatio}
                    />
                );
            }),
        [images, cellProgresses, cols, rows, cellRatio],
    );

    return (
        <div>
            {src && !hasDims && (
                <img src={src} alt="" onLoad={onLoad} className="hidden" />
            )}

            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                <Image className="size-4" />
                格子进度
            </h3>
            <div
                className="grid gap-0.5 rounded-lg overflow-hidden border border-border w-full"
                style={{
                    gridTemplateColumns: `repeat(${cols}, 1fr)`,
                    gridTemplateRows: `repeat(${rows}, 1fr)`,
                    ...(gridRatio ? { aspectRatio: gridRatio } : {}),
                }}
            >
                {cells}
            </div>
        </div>
    );
}

// ─── 文字模式清单行 ───

function MilestoneRow({
    milestone,
    index,
    progress,
}: {
    milestone: Milestone;
    index: number;
    progress: number;
}) {
    const lit = Math.min(1, Math.max(0, progress));
    const done = lit >= 1;

    return (
        <div className="relative overflow-hidden rounded-xl border border-border bg-card">
            <div
                className="absolute inset-y-0 left-0 bg-emerald-500/15 transition-[width] duration-700 ease-out"
                style={{ width: `${lit * 100}%` }}
            />
            <div className="relative flex items-center gap-3 p-3">
                <span
                    className={`size-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors duration-500 ${
                        done
                            ? "bg-emerald-500 text-white"
                            : lit > 0
                              ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                              : "bg-muted text-muted-foreground"
                    }`}
                >
                    {done ? "✓" : index + 1}
                </span>
                <div className="flex-1 min-w-0">
                    <span
                        className={`text-sm block truncate ${done ? "text-muted-foreground line-through" : ""}`}
                    >
                        {milestone.label}
                    </span>
                    {lit > 0 && !done && (
                        <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                            <div
                                className="h-full rounded-full bg-emerald-500 transition-[width] duration-700 ease-out"
                                style={{ width: `${lit * 100}%` }}
                            />
                        </div>
                    )}
                </div>
                <span className="text-sm tabular-nums shrink-0">
                    ¥{milestone.amount.toLocaleString()}
                </span>
            </div>
        </div>
    );
}

function CelebrationOverlay({ onDone }: { onDone: () => void }) {
    useEffect(() => {
        const t = setTimeout(onDone, 2200);
        return () => clearTimeout(t);
    }, [onDone]);

    // 预生成粒子参数，避免每次渲染随机
    const particles = useMemo(
        () =>
            Array.from({ length: 40 }).map((_, i) => ({
                id: i,
                left: `${Math.random() * 100}%`,
                delay: Math.random() * 1.2,
                duration: 1.2 + Math.random() * 1.6,
                size: 3 + Math.random() * 6,
                drift: (Math.random() - 0.5) * 120,
                shape: Math.random() > 0.5 ? "rounded-full" : "rotate-45",
            })),
        [],
    );

    return (
        <motion.div
            className="fixed inset-0 z-50 pointer-events-none overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
        >
            {/* 金色粒子雨 */}
            {particles.map((p) => (
                <motion.div
                    key={p.id}
                    className={`absolute ${p.shape} bg-amber-400`}
                    style={{ left: p.left, width: p.size, height: p.size }}
                    initial={{ y: -20, opacity: 1, x: 0 }}
                    animate={{ y: "105vh", opacity: 0, x: p.drift }}
                    transition={{
                        duration: p.duration,
                        delay: p.delay,
                        ease: [0.32, 0.72, 0.45, 1],
                    }}
                />
            ))}

            {/* 金色光晕 */}
            <motion.div
                className="absolute inset-0 bg-amber-400/5"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.3, 0] }}
                transition={{ duration: 2, times: [0, 0.3, 1] }}
            />

            {/* 中央庆祝文字 */}
            <div className="absolute inset-0 flex items-center justify-center">
                <motion.div
                    className="bg-background/90 backdrop-blur-md px-10 py-6 rounded-3xl border-2 border-amber-400/40 shadow-2xl shadow-amber-400/20 text-center"
                    initial={{ scale: 0, rotate: -15 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0, rotate: 10, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                >
                    <motion.p
                        className="text-4xl mb-2"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{
                            delay: 0.3,
                            type: "spring",
                            stiffness: 300,
                        }}
                    >
                        🎉
                    </motion.p>
                    <p className="text-2xl font-bold text-amber-500">
                        目标达成！
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                        恭喜你完成了这个目标
                    </p>
                </motion.div>
            </div>
        </motion.div>
    );
}

// ─── 多图轮播组件 ───

function MultiImageCarousel({ images }: { images: GoalImage[] }) {
    // 找到"当前正在点亮"的图片（0 < progress < 1），默认首张未完成
    const activeIndex = useMemo(() => {
        const partialIdx = images.findIndex(
            (img) => img.progress > 0 && img.progress < 1,
        );
        if (partialIdx >= 0) return partialIdx;
        const pendingIdx = images.findIndex((img) => img.progress < 1);
        if (pendingIdx >= 0) return pendingIdx;
        return Math.max(0, images.length - 1);
    }, [images]);

    const [index, setIndex] = useState(activeIndex);

    // 数据变化时回到该在的位置
    useEffect(() => {
        setIndex(activeIndex);
    }, [activeIndex]);

    const goTo = useCallback(
        (i: number) => {
            if (i >= 0 && i < images.length) setIndex(i);
        },
        [images.length],
    );

    const img = images[index];
    if (!img) return null;

    const canPrev = index > 0;
    const canNext = index < images.length - 1;
    const lit = Math.min(1, Math.max(0, img.progress));
    const completed = img.progress >= 1;

    return (
        <div>
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                <Image className="size-4" />
                阶段图片 · {index + 1}/{images.length}
            </h3>

            {/* 图片展示区 */}
            <div className="relative overflow-hidden rounded-xl bg-muted select-none">
                <motion.div
                    key={index}
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.12}
                    onDragEnd={(_, info) => {
                        if (info.offset.x > 60) goTo(index - 1);
                        else if (info.offset.x < -60) goTo(index + 1);
                    }}
                    initial={{ x: 80, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 28 }}
                    className="aspect-[4/3] w-full"
                >
                    {img.src ? (
                        <img
                            src={img.src}
                            alt={img.label || `第${index + 1}张`}
                            className="size-full object-cover pointer-events-none"
                            style={{
                                filter: `grayscale(${1 - lit}) brightness(${0.3 + lit * 0.7})`,
                            }}
                            draggable={false}
                        />
                    ) : (
                        <div className="size-full flex items-center justify-center text-muted-foreground">
                            <Image className="size-12 opacity-30" />
                        </div>
                    )}

                    {/* 完成标记 */}
                    {completed && (
                        <div className="absolute top-3 right-3 size-8 rounded-full bg-amber-500 text-white flex items-center justify-center shadow-lg">
                            ✓
                        </div>
                    )}
                </motion.div>

                {/* 左箭头 */}
                {canPrev && (
                    <button
                        type="button"
                        onClick={() => goTo(index - 1)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 size-8 rounded-full bg-background/80 backdrop-blur shadow flex items-center justify-center text-foreground hover:bg-background transition-colors"
                    >
                        <ChevronLeft className="size-5" />
                    </button>
                )}

                {/* 右箭头 */}
                {canNext && (
                    <button
                        type="button"
                        onClick={() => goTo(index + 1)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 size-8 rounded-full bg-background/80 backdrop-blur shadow flex items-center justify-center text-foreground hover:bg-background transition-colors"
                    >
                        <ChevronRight className="size-5" />
                    </button>
                )}
            </div>

            {/* 图片标签 + 进度 */}
            <div className="flex items-center justify-between mt-2 px-1">
                <span className="text-sm font-medium truncate">
                    {img.label || `第${index + 1}张`}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-2">
                    {Math.round(lit * 100)}%
                </span>
            </div>
            <Progress value={lit * 100} className="h-1 mt-1" />

            {/* 底部指示点 */}
            <div className="flex items-center justify-center gap-1.5 mt-3">
                {images.map((image, i) => {
                    const isActive = i === index;
                    const isDone = image.progress >= 1;
                    return (
                        <button
                            key={image.id ?? i}
                            type="button"
                            onClick={() => goTo(i)}
                            className={`rounded-full transition-all ${
                                isActive
                                    ? "bg-primary size-2.5 shadow-sm shadow-primary/40"
                                    : isDone
                                      ? "bg-emerald-500 size-1.5"
                                      : "bg-muted-foreground/25 size-1.5"
                            }`}
                            aria-label={image.label || `第${i + 1}张`}
                        />
                    );
                })}
            </div>
        </div>
    );
}

export default function ProgressPage() {
    const { goalId } = useParams<{ goalId: string }>();
    const navigate = useNavigate();
    const goal = useHorizonStore((s) => s.goals.find((g) => g.id === goalId));
    const pool = useHorizonStore((s) =>
        goal ? s.pools.find((p) => p.id === goal.boundPoolId) : undefined,
    );
    const updateGoalAmount = useHorizonStore((s) => s.updateGoalAmount);

    // 进入页面时始终用资金池余额重算格子（修复 budget 与目标不一致、progress 过期等）
    useEffect(() => {
        if (!goalId) return;
        const amount =
            pool?.balance ??
            useHorizonStore.getState().goals.find((x) => x.id === goalId)
                ?.currentAmount;
        if (amount !== undefined) {
            updateGoalAmount(goalId, amount);
        }
    }, [goalId, pool?.balance, updateGoalAmount]);

    const celebratedRef = useRef(false);
    const [showCelebration, setShowCelebration] = useState(false);
    const [extraAmount, setExtraAmount] = useState("");

    const progress = goal ? getGoalProgress(goal) : 0;

    useEffect(() => {
        if (!goal) return;
        const key = `horizon-celebrated-${goal.id}`;
        if (
            progress >= 1 &&
            !celebratedRef.current &&
            !localStorage.getItem(key)
        ) {
            celebratedRef.current = true;
            setShowCelebration(true);
            localStorage.setItem(key, "1");
        }
    }, [progress, goal]);

    const poolMonthlyRate = pool?.fixedAmount ?? 0;
    const estimate =
        goal && extraAmount && Number(extraAmount) > 0
            ? getAccelerationEstimate(
                  goal,
                  Number(extraAmount),
                  poolMonthlyRate,
              )
            : null;

    if (!goal) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <Target className="size-12 text-muted-foreground opacity-30" />
                <p className="text-muted-foreground">目标未找到</p>
                <Button variant="outline" onClick={() => navigate("/")}>
                    返回
                </Button>
            </div>
        );
    }

    const cellProgresses =
        goal.mode === "single-image" ? deriveImageProgresses(goal) : [];
    const milestoneProgresses =
        goal.mode === "text" ? deriveMilestoneProgresses(goal) : [];

    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate("/")}
                >
                    <ChevronLeft className="size-5" />
                </Button>
                <div>
                    <h1 className="font-bold">{goal.name}</h1>
                    <span className="text-xs text-muted-foreground">
                        {MODE_LABELS[goal.mode] ?? goal.mode}
                    </span>
                </div>
            </header>

            <div className="flex-1 overflow-auto px-4 py-6">
                <div className="max-w-lg mx-auto space-y-6">
                    {/* 进度概览 */}
                    <motion.div
                        className="p-6 rounded-2xl border border-border bg-card text-center"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                    >
                        <p className="text-sm text-muted-foreground mb-2">
                            梦想进度
                        </p>
                        <motion.p
                            className="text-4xl font-bold tabular-nums mb-3"
                            initial={{ scale: 1.2 }}
                            animate={{ scale: 1 }}
                            transition={{
                                type: "spring",
                                stiffness: 200,
                                damping: 20,
                            }}
                        >
                            {Math.round(progress * 100)}%
                        </motion.p>
                        <Progress value={progress * 100} className="h-2 mb-3" />
                        <div className="flex justify-between text-sm text-muted-foreground">
                            <span>
                                已攒 ¥{goal.currentAmount.toLocaleString()}
                            </span>
                            <span>
                                目标 ¥{goal.targetAmount.toLocaleString()}
                            </span>
                        </div>
                        {pool && (
                            <div className="mt-4 pt-4 border-t border-border text-sm text-muted-foreground">
                                绑定资金池：{pool.icon} {pool.name}（余额 ¥
                                {pool.balance.toLocaleString()}）
                            </div>
                        )}

                        {/* 加速建议（内嵌在进度卡片中） */}
                        {progress < 1 && poolMonthlyRate > 0 && (
                            <div className="mt-4 pt-4 border-t border-border space-y-2">
                                <div className="flex items-center gap-2 flex-wrap justify-center">
                                    <span className="text-xs text-muted-foreground">
                                        💡 如果每月多放
                                    </span>
                                    <Input
                                        type="number"
                                        placeholder="500"
                                        value={extraAmount}
                                        onChange={(e) =>
                                            setExtraAmount(e.target.value)
                                        }
                                        className="h-7 w-20 text-center text-xs"
                                    />
                                    <span className="text-xs text-muted-foreground">
                                        元
                                    </span>
                                </div>
                                {estimate && (
                                    <motion.p
                                        className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 text-center"
                                        initial={{ opacity: 0, y: -4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                    >
                                        可提前约 {estimate.monthsSaved}{" "}
                                        个月达成目标
                                    </motion.p>
                                )}
                            </div>
                        )}
                    </motion.div>

                    {/* 图片/里程碑预览 */}
                    {goal.mode === "text" && goal.milestones.length > 0 && (
                        <div className="space-y-2">
                            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                                <List className="size-4" />
                                清单
                            </h3>
                            {goal.milestones.map((m, i) => (
                                <MilestoneRow
                                    key={m.id ?? i}
                                    milestone={m}
                                    index={i}
                                    progress={milestoneProgresses[i] ?? 0}
                                />
                            ))}
                        </div>
                    )}

                    {goal.mode === "multi-image" && goal.images.length > 0 && (
                        <MultiImageCarousel images={goal.images} />
                    )}

                    {goal.mode === "single-image" && goal.images.length > 0 && (
                        <SingleImageGrid
                            images={goal.images}
                            cellProgresses={cellProgresses}
                            gridCols={goal.gridCols ?? 4}
                            gridRows={goal.gridRows ?? 4}
                        />
                    )}

                    {goal.images.length === 0 &&
                        goal.milestones.length === 0 && (
                            <div className="text-center py-8 text-sm text-muted-foreground">
                                还没有添加图片或里程碑。
                            </div>
                        )}
                </div>
            </div>

            {/* 庆祝覆盖层 */}
            <AnimatePresence>
                {showCelebration && (
                    <CelebrationOverlay
                        onDone={() => setShowCelebration(false)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
