// 目标设定向导 —— 首次使用 / 新增目标

import {
    Check,
    ChevronLeft,
    ChevronRight,
    Grid3X3,
    Image,
    List,
    Plus,
    Trash2,
    Upload,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ChangeEvent, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { FundPool, GoalMode, Milestone } from "@/horizon/types";
import { useHorizonStore } from "@/store/horizon";

// ─── 工具：File → base64 data URL ───

function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ─── 多图模式：预算自动分配 ───

type WizardImage = {
    id: string;
    label: string;
    budget: number;
    preview: string | null;
    manualBudget?: boolean;
};

function redistributeBudgets(
    images: WizardImage[],
    total: number,
): WizardImage[] {
    const manualImages = images.filter((img) => img.manualBudget);
    const manualTotal = manualImages.reduce((s, img) => s + img.budget, 0);
    const remaining = Math.max(0, total - manualTotal);
    const autoCount = images.filter((img) => !img.manualBudget).length;
    const perAuto = autoCount > 0 ? Math.round(remaining / autoCount) : 0;

    return images.map((img) => {
        if (img.manualBudget) return img;
        return { ...img, budget: perAuto };
    });
}

// ─── 步骤定义 ───

type Step = 1 | 2 | 3 | 4;
const STEPS = [
    { step: 1 as Step, label: "起名字" },
    { step: 2 as Step, label: "选方式" },
    { step: 3 as Step, label: "设细节" },
    { step: 4 as Step, label: "绑池子" },
];

const PRESET_NAMES = [
    "欧亚环线",
    "去日本读研",
    "提前退休",
    "买第一套房",
    "环球旅拍",
    "开咖啡馆",
];

// ─── 模式卡片 ───

const MODE_OPTIONS: {
    value: GoalMode;
    label: string;
    desc: string;
    icon: typeof Image;
}[] = [
    {
        value: "multi-image",
        label: "图片模式·多图",
        desc: "一张图 = 一个阶段，攒够一张亮一张",
        icon: Image,
    },
    {
        value: "single-image",
        label: "图片模式·单图",
        desc: "一张大图切格子，逐格点亮",
        icon: Grid3X3,
    },
    {
        value: "text",
        label: "文字模式",
        desc: "清单 + 进度条，清晰明了",
        icon: List,
    },
];

// ─── 步骤指示器 ───

function StepIndicator({ current }: { current: Step }) {
    return (
        <div className="flex items-center justify-center gap-2 mb-8">
            {STEPS.map((s, i) => (
                <div key={s.step} className="flex items-center gap-2">
                    <div
                        className={`size-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                            s.step < current
                                ? "bg-primary text-primary-foreground"
                                : s.step === current
                                  ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                                  : "bg-muted text-muted-foreground"
                        }`}
                    >
                        {s.step < current ? (
                            <Check className="size-4" />
                        ) : (
                            s.step
                        )}
                    </div>
                    <span
                        className={`text-xs hidden sm:block ${
                            s.step <= current
                                ? "text-foreground font-medium"
                                : "text-muted-foreground"
                        }`}
                    >
                        {s.label}
                    </span>
                    {i < STEPS.length - 1 && (
                        <div
                            className={`w-6 h-0.5 ${s.step < current ? "bg-primary" : "bg-muted"}`}
                        />
                    )}
                </div>
            ))}
        </div>
    );
}

// ─── Step 1: 起名字 ───

function StepName({
    value,
    onChange,
}: {
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div className="space-y-6">
            <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">给你的目标起个名字</h2>
                <p className="text-muted-foreground text-sm">
                    一个好名字让你一眼就知道在追什么
                </p>
            </div>

            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="例如：欧亚环线、去日本读研…"
                className="text-lg h-14 text-center"
                autoFocus
            />

            <div className="flex flex-wrap gap-2 justify-center">
                {PRESET_NAMES.map((name) => (
                    <button
                        key={name}
                        type="button"
                        onClick={() => onChange(name)}
                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                            value === name
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border hover:border-primary/50 text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {name}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ─── Step 2: 选呈现方式 ───

function StepMode({
    value,
    onChange,
}: {
    value: GoalMode | null;
    onChange: (v: GoalMode) => void;
}) {
    return (
        <div className="space-y-6">
            <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">你想怎么看见进度？</h2>
                <p className="text-muted-foreground text-sm">
                    三种方式，随时可切换
                </p>
            </div>

            <div className="grid gap-3">
                {MODE_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const selected = value === opt.value;
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => onChange(opt.value)}
                            className={`p-5 rounded-xl border-2 text-left transition-all ${
                                selected
                                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                                    : "border-border hover:border-primary/30 hover:bg-muted/50"
                            }`}
                        >
                            <div className="flex items-start gap-4">
                                <div
                                    className={`size-12 rounded-lg flex items-center justify-center shrink-0 ${
                                        selected
                                            ? "bg-primary/10 text-primary"
                                            : "bg-muted text-muted-foreground"
                                    }`}
                                >
                                    <Icon className="size-6" />
                                </div>
                                <div>
                                    <div className="font-semibold text-base">
                                        {opt.label}
                                    </div>
                                    <div className="text-sm text-muted-foreground mt-0.5">
                                        {opt.desc}
                                    </div>
                                </div>
                                {selected && (
                                    <div className="ml-auto size-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                                        <Check className="size-4 text-primary-foreground" />
                                    </div>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Step 3a: 多图模式 ───

function StepMultiImage({
    images,
    totalBudget,
    onChange,
    onTotalBudgetChange,
}: {
    images: WizardImage[];
    totalBudget: number;
    onChange: (imgs: WizardImage[]) => void;
    onTotalBudgetChange: (total: number) => void;
}) {
    const fileRef = useRef<HTMLInputElement>(null);

    const handleAddFiles = async (e: ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        const newImages = [...images];
        for (const file of files) {
            const dataUrl = await fileToDataUrl(file);
            newImages.push({
                id: crypto.randomUUID(),
                label: "",
                budget: 0,
                preview: dataUrl,
            });
        }
        // 上传后重新分配
        onChange(redistributeBudgets(newImages, totalBudget));
        e.target.value = "";
    };

    const removeImage = (id: string) => {
        const filtered = images.filter((img) => img.id !== id);
        onChange(redistributeBudgets(filtered, totalBudget));
    };

    // 用户手动修改单张图片预算 → 标记为手动，重新分配其余
    const handleBudgetChange = (id: string, raw: string) => {
        const val = Number(raw);
        if (raw === "" || Number.isNaN(val) || val <= 0) {
            // 清空 → 恢复自动分配
            const reverted = images.map((img) =>
                img.id === id
                    ? { ...img, budget: 0, manualBudget: false }
                    : img,
            );
            onChange(redistributeBudgets(reverted, totalBudget));
            return;
        }
        const updated = images.map((img) =>
            img.id === id ? { ...img, budget: val, manualBudget: true } : img,
        );
        onChange(redistributeBudgets(updated, totalBudget));
    };

    const handleTotalBudgetChange = (raw: string) => {
        const val = Number(raw);
        if (Number.isNaN(val)) return;
        onTotalBudgetChange(val);
        if (images.length > 0) {
            onChange(redistributeBudgets(images, val));
        }
    };

    const updateLabel = (id: string, label: string) => {
        onChange(
            images.map((img) => (img.id === id ? { ...img, label } : img)),
        );
    };

    const manualCount = images.filter((img) => img.manualBudget).length;
    const autoCount = images.length - manualCount;
    const autoPerImage =
        autoCount > 0
            ? Math.round(
                  Math.max(
                      0,
                      totalBudget -
                          images
                              .filter((img) => img.manualBudget)
                              .reduce((s, img) => s + img.budget, 0),
                  ) / autoCount,
              )
            : 0;

    return (
        <div className="space-y-6">
            <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">添加阶段图片</h2>
                <p className="text-muted-foreground text-sm">
                    一张图代表一个阶段。设定总预算后自动均分，也可单独调整。
                </p>
            </div>

            {/* 总预算 */}
            <div className="p-4 rounded-xl border-2 border-primary/30 bg-primary/5 space-y-2">
                <Label className="text-sm font-medium">目标总预算</Label>
                <Input
                    type="number"
                    placeholder="例如 300,000"
                    value={totalBudget || ""}
                    onChange={(e) => handleTotalBudgetChange(e.target.value)}
                    className="h-12 text-lg font-bold text-center"
                />
                {images.length > 0 && totalBudget > 0 && (
                    <p className="text-xs text-muted-foreground text-center">
                        {images.length} 张图片
                        {autoCount > 0 && (
                            <> · 每张自动均 ¥{autoPerImage.toLocaleString()}</>
                        )}
                        {manualCount > 0 && (
                            <span className="text-primary">
                                {" "}
                                · {manualCount} 张手动设定
                            </span>
                        )}
                    </p>
                )}
            </div>

            {/* 上传按钮 */}
            <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-8 flex flex-col items-center gap-3 text-muted-foreground hover:text-primary transition-colors"
            >
                <Upload className="size-8" />
                <span className="text-sm">点击或拖拽上传图片</span>
            </button>
            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleAddFiles}
            />

            {/* 图片列表 */}
            {images.length > 0 && (
                <div className="space-y-3">
                    {images.map((img, i) => (
                        <div
                            key={img.id}
                            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card"
                        >
                            <div className="size-14 rounded-lg overflow-hidden bg-muted shrink-0">
                                {img.preview ? (
                                    <img
                                        src={img.preview}
                                        alt=""
                                        className="size-full object-cover"
                                        style={{
                                            filter: "grayscale(1) brightness(0.4)",
                                        }}
                                    />
                                ) : (
                                    <div className="size-full flex items-center justify-center">
                                        <Image className="size-5 text-muted-foreground" />
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 space-y-1.5">
                                <Input
                                    value={img.label}
                                    onChange={(e) =>
                                        updateLabel(img.id, e.target.value)
                                    }
                                    placeholder={`阶段 ${i + 1} 名称，如"深圳"`}
                                    className="h-9 text-sm"
                                />
                                <div className="relative">
                                    <Input
                                        type="number"
                                        value={img.budget || ""}
                                        onChange={(e) =>
                                            handleBudgetChange(
                                                img.id,
                                                e.target.value,
                                            )
                                        }
                                        placeholder={`¥${autoPerImage.toLocaleString()}`}
                                        className={`h-9 text-sm pr-14 ${
                                            img.manualBudget
                                                ? "border-primary/40 bg-primary/5"
                                                : ""
                                        }`}
                                    />
                                    {img.manualBudget ? (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                handleBudgetChange(img.id, "")
                                            }
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                            title="恢复自动分配"
                                        >
                                            重置
                                        </button>
                                    ) : (
                                        totalBudget > 0 && (
                                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground pointer-events-none">
                                                自动
                                            </span>
                                        )
                                    )}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => removeImage(img.id)}
                                className="text-muted-foreground hover:text-destructive shrink-0 p-1"
                            >
                                <Trash2 className="size-4" />
                            </button>
                        </div>
                    ))}

                    <div className="text-right text-sm text-muted-foreground">
                        总预算：
                        <span className="font-semibold text-foreground">
                            ¥{totalBudget.toLocaleString()}
                        </span>
                        {totalBudget > 0 &&
                            images.reduce((s, img) => s + img.budget, 0) !==
                                totalBudget && (
                                <span className="text-amber-600 dark:text-amber-400 ml-1">
                                    （已分配 ¥
                                    {images
                                        .reduce((s, img) => s + img.budget, 0)
                                        .toLocaleString()}
                                    ）
                                </span>
                            )}
                    </div>
                </div>
            )}

            {images.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                    还没有添加图片。上传至少一张来开始。
                </div>
            )}
        </div>
    );
}

// ─── Step 3b: 单图模式 ───

function StepSingleImage({
    image,
    gridCols,
    gridRows,
    totalBudget,
    onChange,
}: {
    image: {
        preview: string | null;
        gridBudgets: number[];
        naturalWidth: number;
        naturalHeight: number;
    } | null;
    gridCols: number;
    gridRows: number;
    totalBudget: number;
    onChange: (data: {
        preview: string | null;
        gridCols: number;
        gridRows: number;
        totalBudget: number;
        gridBudgets: number[];
        naturalWidth: number;
        naturalHeight: number;
    }) => void;
}) {
    const fileRef = useRef<HTMLInputElement>(null);
    const totalCells = gridCols * gridRows;
    const perCellBudget =
        totalCells > 0 ? Math.round(totalBudget / totalCells) : 0;
    const gridBudgets =
        image?.gridBudgets ?? Array(totalCells).fill(perCellBudget);
    const naturalW = image?.naturalWidth ?? 1;
    const naturalH = image?.naturalHeight ?? 1;

    const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const dataUrl = await fileToDataUrl(file);
        // 读取原图尺寸
        const img = new window.Image();
        img.onload = () => {
            onChange({
                preview: dataUrl,
                gridCols,
                gridRows,
                totalBudget,
                gridBudgets,
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight,
            });
        };
        img.src = dataUrl;
        e.target.value = "";
    };

    const updateGrid = (cols: number, rows: number) => {
        const newTotal = cols * rows;
        const newBudgets = Array(newTotal)
            .fill(0)
            .map((_, i) => gridBudgets[i] ?? perCellBudget);
        onChange({
            preview: image?.preview ?? null,
            gridCols: cols,
            gridRows: rows,
            totalBudget,
            gridBudgets: newBudgets,
            naturalWidth: naturalW,
            naturalHeight: naturalH,
        });
    };

    const updateCellBudget = (index: number, value: number) => {
        const newBudgets = [...gridBudgets];
        newBudgets[index] = value;
        onChange({
            preview: image?.preview ?? null,
            gridCols,
            gridRows,
            totalBudget,
            gridBudgets: newBudgets,
            naturalWidth: naturalW,
            naturalHeight: naturalH,
        });
    };

    const sumBudgets = gridBudgets.reduce((s, b) => s + b, 0);

    return (
        <div className="space-y-6">
            <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">上传目标图片</h2>
                <p className="text-muted-foreground text-sm">
                    一张大图切成格子，逐格点亮。比如买房首付的户型图。
                </p>
            </div>

            {/* 上传 */}
            {!image?.preview ? (
                <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-full border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-12 flex flex-col items-center gap-3 text-muted-foreground hover:text-primary transition-colors"
                >
                    <Upload className="size-10" />
                    <span>点击上传图片</span>
                </button>
            ) : (
                <div className="relative rounded-xl overflow-hidden border border-border">
                    <img
                        src={image.preview}
                        alt="目标"
                        className="w-full aspect-video object-cover"
                    />
                    <button
                        type="button"
                        onClick={() =>
                            onChange({
                                preview: null,
                                gridCols,
                                gridRows,
                                totalBudget,
                                gridBudgets,
                                naturalWidth: naturalW,
                                naturalHeight: naturalH,
                            })
                        }
                        className="absolute top-2 right-2 bg-background/80 rounded-lg p-1.5 text-xs hover:bg-background"
                    >
                        更换图片
                    </button>
                </div>
            )}
            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFile}
            />

            {/* 格子设置 */}
            <div className="flex items-center gap-4 justify-center">
                <div className="flex items-center gap-2">
                    <Label className="text-sm">列</Label>
                    <Input
                        type="number"
                        min={2}
                        max={12}
                        value={gridCols}
                        onChange={(e) =>
                            updateGrid(Number(e.target.value) || 2, gridRows)
                        }
                        className="w-16 h-9 text-center"
                    />
                </div>
                <span className="text-muted-foreground">×</span>
                <div className="flex items-center gap-2">
                    <Label className="text-sm">行</Label>
                    <Input
                        type="number"
                        min={2}
                        max={12}
                        value={gridRows}
                        onChange={(e) =>
                            updateGrid(gridCols, Number(e.target.value) || 2)
                        }
                        className="w-16 h-9 text-center"
                    />
                </div>
            </div>

            {/* 网格预览 */}
            {image?.preview && (
                <div
                    className="grid gap-0.5 rounded-lg overflow-hidden border border-border w-full"
                    style={{
                        gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                        gridTemplateRows: `repeat(${gridRows}, 1fr)`,
                        aspectRatio: `${naturalW} / ${naturalH}`,
                    }}
                >
                    {gridBudgets.map((budget, i) => (
                        <div key={i} className="relative">
                            <div
                                className="size-full"
                                style={{
                                    backgroundImage: `url(${image.preview})`,
                                    backgroundSize: `${gridCols * 100}% ${gridRows * 100}%`,
                                    backgroundPosition: `${(i % gridCols) * (100 / (gridCols - 1 || 1))}% ${Math.floor(i / gridCols) * (100 / (gridRows - 1 || 1))}%`,
                                    filter: "grayscale(1) brightness(0.4)",
                                    aspectRatio: `${naturalW / gridCols} / ${naturalH / gridRows}`,
                                }}
                            />
                        </div>
                    ))}
                </div>
            )}

            {/* 总预算 */}
            <div>
                <Label className="text-sm">目标总金额</Label>
                <div className="flex items-center gap-2 mt-1">
                    <Input
                        type="number"
                        value={totalBudget || ""}
                        onChange={(e) => {
                            const nextTotal = Number(e.target.value) || 0;
                            const perCell =
                                totalCells > 0 ? nextTotal / totalCells : 0;
                            onChange({
                                preview: image?.preview ?? null,
                                gridCols,
                                gridRows,
                                totalBudget: nextTotal,
                                gridBudgets: Array(totalCells).fill(perCell),
                                naturalWidth: naturalW,
                                naturalHeight: naturalH,
                            });
                        }}
                        placeholder="400,000"
                        className="h-10"
                    />
                    <span className="text-sm text-muted-foreground shrink-0">
                        共 {totalCells} 格 · 每格均 ¥
                        {perCellBudget.toLocaleString()}
                    </span>
                </div>
            </div>

            <div className="text-right text-sm text-muted-foreground">
                格子预算合计：
                <span className="font-semibold text-foreground">
                    ¥{sumBudgets.toLocaleString()}
                </span>
            </div>
        </div>
    );
}

// ─── Step 3c: 文字模式 ───

function StepText({
    milestones,
    onChange,
}: {
    milestones: Omit<Milestone, "id" | "completed">[];
    onChange: (m: typeof milestones) => void;
}) {
    const addMilestone = () => {
        onChange([...milestones, { label: "", amount: 0 }]);
    };

    const updateMilestone = (
        index: number,
        patch: Partial<{ label: string; amount: number }>,
    ) => {
        onChange(
            milestones.map((m, i) => (i === index ? { ...m, ...patch } : m)),
        );
    };

    const removeMilestone = (index: number) => {
        onChange(milestones.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-6">
            <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">定义里程碑</h2>
                <p className="text-muted-foreground text-sm">
                    把目标拆成一步步小胜利。比如"财务自由 10 步"。
                </p>
            </div>

            {milestones.length > 0 && (
                <div className="space-y-2">
                    {milestones.map((m, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card"
                        >
                            <span className="text-muted-foreground text-sm w-6 shrink-0">
                                {i + 1}
                            </span>
                            <Input
                                value={m.label}
                                onChange={(e) =>
                                    updateMilestone(i, {
                                        label: e.target.value,
                                    })
                                }
                                placeholder={`步骤 ${i + 1} 描述`}
                                className="h-9 text-sm flex-1"
                            />
                            <Input
                                type="number"
                                value={m.amount || ""}
                                onChange={(e) =>
                                    updateMilestone(i, {
                                        amount: Number(e.target.value) || 0,
                                    })
                                }
                                placeholder="金额"
                                className="h-9 text-sm w-28"
                            />
                            <button
                                type="button"
                                onClick={() => removeMilestone(i)}
                                className="text-muted-foreground hover:text-destructive shrink-0 p-1"
                            >
                                <Trash2 className="size-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <button
                type="button"
                onClick={addMilestone}
                className="w-full border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-4 flex items-center justify-center gap-2 text-muted-foreground hover:text-primary transition-colors"
            >
                <Plus className="size-5" />
                添加步骤
            </button>

            {milestones.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                    还没有添加步骤。至少添加一个里程碑来开始。
                </div>
            )}
        </div>
    );
}

// ─── Step 4: 绑定资金池 ───

function StepBindPool({
    pools,
    selectedPoolId,
    monthlyMin,
    onSelectPool,
    onMonthlyMin,
}: {
    pools: FundPool[];
    selectedPoolId: string | null;
    monthlyMin: number;
    onSelectPool: (id: string) => void;
    onMonthlyMin: (v: number) => void;
}) {
    return (
        <div className="space-y-6">
            <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">绑定梦想基金</h2>
                <p className="text-muted-foreground text-sm">
                    选择一个资金池作为这个目标的"专属账户"，每个月的钱会自动存进来。
                </p>
            </div>

            <RadioGroup
                value={selectedPoolId ?? ""}
                onValueChange={onSelectPool}
            >
                <div className="space-y-2">
                    {pools.map((pool) => (
                        <Label
                            key={pool.id}
                            className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                                selectedPoolId === pool.id
                                    ? "border-primary bg-primary/5"
                                    : "border-border hover:border-primary/30"
                            }`}
                        >
                            <RadioGroupItem value={pool.id} />
                            <span className="text-xl">{pool.icon}</span>
                            <div className="flex-1">
                                <div className="font-medium">{pool.name}</div>
                                <div className="text-xs text-muted-foreground">
                                    当前余额 ¥{pool.balance.toLocaleString()}
                                </div>
                            </div>
                        </Label>
                    ))}
                </div>
            </RadioGroup>

            <div className="p-4 rounded-xl border border-border bg-muted/50">
                <Label className="text-sm font-medium">每月最少存入</Label>
                <div className="flex items-center gap-2 mt-2">
                    <span className="text-muted-foreground">¥</span>
                    <Input
                        type="number"
                        value={monthlyMin || ""}
                        onChange={(e) =>
                            onMonthlyMin(Number(e.target.value) || 0)
                        }
                        placeholder="2,000"
                        className="h-10 w-40"
                    />
                    <span className="text-sm text-muted-foreground">
                        / 月（雷打不动）
                    </span>
                </div>
            </div>
        </div>
    );
}

// ─── Wizard 主组件 ───

export default function WizardPage() {
    const navigate = useNavigate();
    const addGoal = useHorizonStore((s) => s.addGoal);
    const pools = useHorizonStore((s) => s.pools);

    const [step, setStep] = useState<Step>(1);

    // Step state
    const [name, setName] = useState("");
    const [mode, setMode] = useState<GoalMode | null>(null);
    // Multi-image
    const [multiImages, setMultiImages] = useState<WizardImage[]>([]);
    const [multiTotalBudget, setMultiTotalBudget] = useState(0);
    // Single-image
    const [singleData, setSingleData] = useState<{
        preview: string | null;
        gridCols: number;
        gridRows: number;
        totalBudget: number;
        gridBudgets: number[];
        naturalWidth: number;
        naturalHeight: number;
    }>({
        preview: null,
        gridCols: 4,
        gridRows: 4,
        totalBudget: 0,
        gridBudgets: Array(16).fill(0),
        naturalWidth: 1,
        naturalHeight: 1,
    });
    // Text
    const [textMilestones, setTextMilestones] = useState<
        Omit<Milestone, "id" | "completed">[]
    >([]);
    // Bind
    const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
    const [monthlyMin, setMonthlyMin] = useState(2000);

    const canNext = (): boolean => {
        switch (step) {
            case 1:
                return name.trim().length > 0;
            case 2:
                return mode !== null;
            case 3:
                if (mode === "multi-image")
                    return multiImages.length > 0 && multiTotalBudget > 0;
                if (mode === "single-image")
                    return (
                        singleData.preview !== null &&
                        singleData.totalBudget > 0
                    );
                if (mode === "text") return textMilestones.length > 0;
                return false;
            case 4:
                return selectedPoolId !== null && monthlyMin > 0;
        }
    };

    const handleNext = () => {
        if (!canNext()) return;
        if (step < 4) {
            setStep((step + 1) as Step);
        } else {
            // 创建目标
            const targetAmount =
                mode === "multi-image"
                    ? multiTotalBudget
                    : mode === "single-image"
                      ? singleData.totalBudget
                      : textMilestones.reduce((s, m) => s + m.amount, 0);

            addGoal({
                name,
                mode: mode!,
                targetAmount,
                boundPoolId: selectedPoolId!,
                images:
                    mode === "multi-image"
                        ? multiImages.map((img) => ({
                              src: img.preview ?? "",
                              label: img.label,
                              budget: img.budget,
                              manualBudget: img.manualBudget,
                          }))
                        : mode === "single-image"
                          ? (() => {
                                const cells =
                                    singleData.gridCols * singleData.gridRows;
                                const perCell =
                                    cells > 0
                                        ? singleData.totalBudget / cells
                                        : 0;
                                return Array.from(
                                    { length: cells },
                                    (_, i) => ({
                                        src: singleData.preview ?? "",
                                        label: `格子 ${i + 1}`,
                                        budget: perCell,
                                    }),
                                );
                            })()
                          : undefined,
                gridCols:
                    mode === "single-image" ? singleData.gridCols : undefined,
                gridRows:
                    mode === "single-image" ? singleData.gridRows : undefined,
                milestones:
                    mode === "text"
                        ? textMilestones.map((m) => ({
                              ...m,
                              id: "",
                              completed: false,
                          }))
                        : undefined,
            });

            // 更新池子月费子项预算
            const store = useHorizonStore.getState();
            const pool = store.pools.find((p) => p.id === selectedPoolId);
            if (pool?.subItems.length) {
                store.updateSubItem(pool.id, pool.subItems[0].id, {
                    budget: monthlyMin,
                });
            }

            navigate("/", { replace: true });
        }
    };

    const handleBack = () => {
        if (step > 1) setStep((step - 1) as Step);
        else navigate("/", { replace: true });
    };

    return (
        <div className="flex flex-col h-full">
            {/* 顶部 */}
            <header className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
                <Button variant="ghost" size="icon" onClick={handleBack}>
                    <ChevronLeft className="size-5" />
                </Button>
                <h1 className="text-lg font-bold">新建目标</h1>
                <div className="flex-1" />
                <span className="text-xs text-muted-foreground">{step}/4</span>
            </header>

            {/* 内容 */}
            <div className="flex-1 overflow-auto px-4 py-6">
                <div className="max-w-lg mx-auto">
                    <StepIndicator current={step} />

                    <AnimatePresence mode="wait">
                        <motion.div
                            key={step}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.2 }}
                        >
                            {step === 1 && (
                                <StepName value={name} onChange={setName} />
                            )}

                            {step === 2 && (
                                <StepMode value={mode} onChange={setMode} />
                            )}

                            {step === 3 && mode === "multi-image" && (
                                <StepMultiImage
                                    images={multiImages}
                                    totalBudget={multiTotalBudget}
                                    onChange={setMultiImages}
                                    onTotalBudgetChange={setMultiTotalBudget}
                                />
                            )}
                            {step === 3 && mode === "single-image" && (
                                <StepSingleImage
                                    image={singleData}
                                    onChange={setSingleData}
                                    gridCols={singleData.gridCols}
                                    gridRows={singleData.gridRows}
                                    totalBudget={singleData.totalBudget}
                                />
                            )}
                            {step === 3 && mode === "text" && (
                                <StepText
                                    milestones={textMilestones}
                                    onChange={setTextMilestones}
                                />
                            )}

                            {step === 4 && (
                                <StepBindPool
                                    pools={pools}
                                    selectedPoolId={selectedPoolId}
                                    monthlyMin={monthlyMin}
                                    onSelectPool={setSelectedPoolId}
                                    onMonthlyMin={setMonthlyMin}
                                />
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>

            {/* 底部导航 */}
            <footer className="px-4 py-3 border-t border-border shrink-0">
                <div className="max-w-lg mx-auto">
                    <Button
                        className="w-full"
                        size="lg"
                        onClick={handleNext}
                        disabled={!canNext()}
                    >
                        {step < 4 ? (
                            <>
                                下一步
                                <ChevronRight className="size-4 ml-1" />
                            </>
                        ) : (
                            "完成，开始追踪"
                        )}
                    </Button>
                </div>
            </footer>
        </div>
    );
}
