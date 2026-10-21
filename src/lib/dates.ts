import type { LifeItem, RecurringTask } from "../models";
const DAY = 86400000;
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("請輸入有效日期");
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error("請輸入有效日期");
  return date;
}
export function addDays(value: string, days: number): string {
  if (!Number.isInteger(days) || days < 1 || days > 36500)
    throw new Error("週期須為 1 至 36500 天的整數");
  const d = parseDate(value);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function nextDue(item: LifeItem, task: RecurringTask): string {
  const latest = item.history
    .filter((r) => r.taskId === task.id)
    .map((r) => r.date)
    .sort()
    .at(-1);
  return addDays(latest ?? task.anchorDate, task.intervalDays);
}
export function daysUntil(date: string, from = today()): number {
  return Math.round(
    (parseDate(date).getTime() - parseDate(from).getTime()) / DAY,
  );
}
export function dueLabel(date: string): string {
  const days = daysUntil(date);
  return days < 0
    ? `已逾期 ${-days} 天`
    : days === 0
      ? "今天到期"
      : `${days} 天後`;
}
export const money = (value: number) =>
  new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value);
