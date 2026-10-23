import type { LifeItem } from "../models";
import type { OverviewRows } from "./dashboard";
import { taipeiToday } from "./dashboard";
import { daysUntil, nextDue, parseDate } from "./dates";

export interface CalendarEvent {
  key: string;
  kind: "scheduled" | "completed";
  itemId: string;
  itemName: string;
  planId: string;
  recordId?: string;
  name: string;
  date: string;
  overdue: boolean;
}
export function monthKey(date: string): string { parseDate(date); return date.slice(0, 7); }
export function shiftMonth(month: string, delta: number): string {
  if (!/^\d{4}-\d{2}$/.test(month) || !Number.isInteger(delta)) throw new Error("月份格式錯誤");
  const first = parseDate(`${month}-01`);
  first.setUTCMonth(first.getUTCMonth() + delta);
  return first.toISOString().slice(0, 7);
}
export function monthDays(month: string): { date: string; inMonth: boolean }[] {
  const first = parseDate(`${month}-01`);
  const year = first.getUTCFullYear(), index = first.getUTCMonth();
  const offset = first.getUTCDay();
  const days = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const count = Math.ceil((offset + days) / 7) * 7;
  return Array.from({ length: count }, (_, position) => {
    const day = new Date(Date.UTC(year, index, position - offset + 1));
    const date = day.toISOString().slice(0, 10);
    return { date, inMonth: date.startsWith(month) };
  });
}
/** Only one scheduled date per enabled plan; completed records remain separate by record_id. */
export function calendarEvents(items: LifeItem[], source: "cloud" | "mock", rows: OverviewRows, today = taipeiToday()): CalendarEvent[] {
  const events: CalendarEvent[] = [], seen = new Set<string>();
  for (const item of items) {
    const ownerRows = source === "cloud" ? rows[item.id] : undefined;
    if (source === "cloud" && !ownerRows) throw new Error(`缺少 ${item.name} 的保養資料`);
    if (source === "cloud") {
      for (const plan of ownerRows!.plans.filter(plan => plan.enabled)) events.push({
        key: `plan:${item.id}:${plan.plan_id}`, kind: "scheduled", itemId: item.id,
        itemName: item.name, planId: plan.plan_id, name: plan.name,
        date: plan.next_due_date, overdue: daysUntil(plan.next_due_date, today) < 0,
      });
      for (const record of ownerRows!.records) {
        if (seen.has(record.record_id)) continue;
        seen.add(record.record_id);
        events.push({ key: `record:${item.id}:${record.record_id}`, kind: "completed", itemId: item.id,
          itemName: item.name, planId: record.plan_id, recordId: record.record_id,
          name: ownerRows!.plans.find(plan => plan.plan_id === record.plan_id)?.name ?? record.title,
          date: record.completed_date, overdue: false });
      }
    } else {
      for (const plan of item.tasks) {
        const date = nextDue(item, plan);
        events.push({ key: `plan:${item.id}:${plan.id}`, kind: "scheduled", itemId: item.id,
          itemName: item.name, planId: plan.id, name: plan.name, date, overdue: daysUntil(date, today) < 0 });
      }
      for (const record of item.history) {
        if (seen.has(record.id)) continue;
        seen.add(record.id);
        events.push({ key: `record:${item.id}:${record.id}`, kind: "completed", itemId: item.id,
          itemName: item.name, planId: record.taskId, recordId: record.id,
          name: record.taskName, date: record.date, overdue: false });
      }
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}
export function calendarEventHref(event: CalendarEvent): string {
  const base = `#/items/${encodeURIComponent(event.itemId)}`;
  return event.kind === "scheduled"
    ? `${base}?tab=plans&plan=${encodeURIComponent(event.planId)}`
    : `${base}?tab=history&record=${encodeURIComponent(event.recordId ?? "")}`;
}
