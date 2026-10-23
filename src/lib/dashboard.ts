import type { LifeItem } from "../models";
import type { MaintenancePlan } from "../api/maintenancePlans";
import type { CloudMaintenanceRecord } from "../api/maintenanceRecords";
import { daysUntil, nextDue } from "./dates";

export interface OverviewRow { plans: MaintenancePlan[]; records: CloudMaintenanceRecord[] }
export type OverviewRows = Record<string, OverviewRow>;
export interface DueEntry { item: LifeItem; name: string; date: string; days: number; id: string }
export interface CompletedEntry { item: LifeItem; name: string; date: string; amount: number; id: string }
export interface WarrantyEntry { item: LifeItem; date: string; days: number; state: "expired" | "soon" | "future" | "missing" }

/** Use Taipei's civil date, then compare YYYY-MM-DD dates as calendar days. */
export function taipeiToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function warrantyState(date: string | undefined, today: string): WarrantyEntry["state"] {
  if (!date) return "missing";
  const days = daysUntil(date, today);
  return days < 0 ? "expired" : days <= 30 ? "soon" : "future";
}
export function buildDashboard(items: LifeItem[], source: "cloud" | "mock", cloudRows: OverviewRows, today = taipeiToday()) {
  const due: DueEntry[] = [], completed: CompletedEntry[] = [], warranties: WarrantyEntry[] = [];
  const unique = new Set<string>();
  for (const item of items) {
    const rows = source === "cloud" ? cloudRows[item.id] : undefined;
    if (source === "cloud" && !rows) throw new Error(`缺少 ${item.name} 的保養資料`);
    if (item.status !== "archived") {
      for (const plan of source === "cloud" ? rows!.plans : item.tasks) {
        if (source === "cloud" && !(plan as MaintenancePlan).enabled) continue;
        const date = source === "cloud" ? (plan as MaintenancePlan).next_due_date : nextDue(item, plan as LifeItem["tasks"][number]);
        due.push({ item, name: plan.name, date, days: daysUntil(date, today), id: source === "cloud" ? (plan as MaintenancePlan).plan_id : (plan as LifeItem["tasks"][number]).id });
      }
      const date = item.warrantyDate ?? "";
      warranties.push({ item, date, days: date ? daysUntil(date, today) : 0, state: warrantyState(date, today) });
    }
    for (const row of source === "cloud" ? rows!.records : item.history) {
      const id = source === "cloud" ? (row as CloudMaintenanceRecord).record_id : (row as LifeItem["history"][number]).id;
      if (unique.has(id)) continue;
      unique.add(id);
      completed.push({ item, id, name: source === "cloud" ? (row as CloudMaintenanceRecord).title : (row as LifeItem["history"][number]).taskName,
        date: source === "cloud" ? (row as CloudMaintenanceRecord).completed_date : (row as LifeItem["history"][number]).date,
        amount: row.amount });
    }
  }
  due.sort((a,b) => a.date.localeCompare(b.date) || a.item.name.localeCompare(b.item.name));
  completed.sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  warranties.sort((a,b) => a.state === "missing" ? 1 : b.state === "missing" ? -1 : a.days - b.days);
  return { due, overdue: due.filter(x => x.days < 0), next7: due.filter(x => x.days >= 0 && x.days <= 7), next30: due.filter(x => x.days >= 0 && x.days <= 30), completed, warranties };
}
export function maintenanceCosts(completed: CompletedEntry[], today = taipeiToday(), year = Number(today.slice(0,4))) {
  const unique = [...new Map(completed.map(row => [row.id, row])).values()];
  const total = unique.reduce((sum, row) => sum + row.amount, 0);
  const annual = unique.filter(row => row.date.startsWith(`${year}-`)).reduce((sum,row) => sum + row.amount, 0);
  const nowMonth = Number(today.slice(0,4)) * 12 + Number(today.slice(5,7)) - 1;
  const trend = Array.from({length: 12}, (_,index) => {
    const monthIndex = nowMonth - 11 + index;
    const month = `${Math.floor(monthIndex / 12)}-${String(monthIndex % 12 + 1).padStart(2,"0")}`;
    return {month, amount: unique.filter(row => row.date.startsWith(`${month}-`) && row.date <= today).reduce((sum,row) => sum + row.amount, 0)};
  });
  const last12 = trend.reduce((sum,row) => sum + row.amount, 0);
  const ranking = [...unique.reduce((map,row) => map.set(row.item.id, { item: row.item, amount: (map.get(row.item.id)?.amount ?? 0) + row.amount }), new Map<string,{item: LifeItem; amount: number}>()).values()].sort((a,b) => b.amount - a.amount);
  return { total, annual, last12, trend, ranking };
}
export interface DashboardFilters { query: string; category: string; status: string; plan: string; due: string }
export function filterItems(items: LifeItem[], filters: DashboardFilters, source: "cloud" | "mock", rows: OverviewRows, today = taipeiToday()) {
  const query = filters.query.trim().toLocaleLowerCase();
  return items.filter(item => {
    const plans = source === "cloud" ? rows[item.id]?.plans ?? [] : item.tasks;
    const dates = source === "cloud" ? (plans as MaintenancePlan[]).filter(plan => plan.enabled).map(plan => plan.next_due_date) : item.tasks.map(task => nextDue(item,task));
    return (!query || [item.name,item.brand,item.model,item.location].some(value => value?.toLocaleLowerCase().includes(query))) &&
      (!filters.category || item.category === filters.category) &&
      (!filters.status || (item.status ?? "active") === filters.status) &&
      (!filters.plan || (plans.length > 0) === (filters.plan === "yes")) &&
      (!filters.due || (item.status !== "archived" && dates.some(date => {
        const days = daysUntil(date,today);
        return filters.due === "overdue" ? days < 0 : filters.due === "7" ? days >= 0 && days <= 7 : days >= 0 && days <= 30;
      })));
  });
}
