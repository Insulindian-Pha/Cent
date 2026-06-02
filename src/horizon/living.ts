// 生活费：每日预算 + 月度统计计算

import type { DailyExpense, LivingConfig } from "./types";

/** 当月天数 */
export function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

/** 月度总预算 = 日预算 × 天数 + 房租 */
export function getMonthBudget(
    config: LivingConfig,
    year: number,
    month: number,
): number {
    return config.dailyBudget * daysInMonth(year, month) + config.monthlyRent;
}

/** 月度实际总花费 */
export function getMonthSpent(
    entries: DailyExpense[],
    year: number,
    month: number,
): number {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    return entries
        .filter((e) => e.date.startsWith(prefix))
        .reduce((sum, e) => {
            const actual = e.isManual ? e.actual : e.budget;
            return sum + actual;
        }, 0);
}

/** 本月到今天为止已过的天数 */
export function elapsedDays(year: number, month: number): number {
    const now = new Date();
    if (now.getFullYear() > year) return daysInMonth(year, month);
    if (now.getFullYear() === year && now.getMonth() + 1 > month)
        return daysInMonth(year, month);
    if (now.getFullYear() === year && now.getMonth() + 1 === month)
        return now.getDate();
    return 0; // 未来月份
}

/** 剩余每日可用额度 */
export function getDailyRemaining(
    config: LivingConfig,
    entries: DailyExpense[],
    year: number,
    month: number,
): number {
    const totalBudget = getMonthBudget(config, year, month);
    const spent = getMonthSpent(entries, year, month);
    const elapsed = elapsedDays(year, month);
    const remainingDays = daysInMonth(year, month) - elapsed;
    if (remainingDays <= 0) return 0;
    return Math.max(0, Math.round((totalBudget - spent) / remainingDays));
}

/** 月度统计 */
export interface MonthStats {
    monthBudget: number;
    monthSpent: number;
    dailyAvg: number;
    overDays: number; // 超预算天数
    underDays: number; // 低于预算天数
    manualDays: number; // 手动校准天数
    balance: number; // 结余（正）或超支（负）
    executionRate: number; // 预算执行率 0-1
}

export function getMonthStats(
    config: LivingConfig,
    entries: DailyExpense[],
    year: number,
    month: number,
): MonthStats {
    const monthBudget = getMonthBudget(config, year, month);
    const monthSpent = getMonthSpent(entries, year, month);
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const monthEntries = entries.filter((e) => e.date.startsWith(prefix));
    const elapsed = elapsedDays(year, month);

    let overDays = 0;
    let underDays = 0;
    let manualDays = 0;

    for (const e of monthEntries) {
        const actual = e.isManual ? e.actual : e.budget;
        if (e.isManual) manualDays++;
        if (actual > e.budget) overDays++;
        else if (actual < e.budget) underDays++;
    }

    return {
        monthBudget,
        monthSpent,
        dailyAvg: elapsed > 0 ? Math.round(monthSpent / elapsed) : 0,
        overDays,
        underDays,
        manualDays,
        balance: monthBudget - monthSpent,
        executionRate: monthBudget > 0 ? monthSpent / monthBudget : 0,
    };
}

/** 为当月生成默认 entries（补全未手动填写的天） */
export function generateMonthEntries(
    config: LivingConfig,
    year: number,
    month: number,
    existing: DailyExpense[],
): DailyExpense[] {
    const days = daysInMonth(year, month);
    const result: DailyExpense[] = [];
    const existingMap = new Map(existing.map((e) => [e.date, e]));

    for (let d = 1; d <= days; d++) {
        const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const found = existingMap.get(date);
        if (found) {
            result.push({
                ...found,
                budget: config.dailyBudget, // 始终使用最新配置的预算
            });
        } else {
            const isRentDay = d === config.rentDayOfMonth;
            result.push({
                id: `auto-${date}`,
                date,
                budget: isRentDay
                    ? config.monthlyRent + config.dailyBudget
                    : config.dailyBudget,
                actual: 0,
                isManual: false,
            });
        }
    }

    return result;
}

/** 获取今天日期字符串 */
export function todayStr(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
