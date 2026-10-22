import type { AppsScriptBridge } from "./appsScriptBridge";
import { parseDate } from "../lib/dates";

export interface MaintenancePlanFields {
  name: string;
  interval_value: number;
  interval_unit: "day" | "month" | "year";
  calculation_mode: "completion" | "fixed";
  base_date: string;
  reminder_days: number;
}
export interface MaintenancePlan extends MaintenancePlanFields {
  plan_id: string;
  item_id: string;
  last_completed_date: string;
  next_due_date: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
const keys = [
  "name",
  "interval_value",
  "interval_unit",
  "calculation_mode",
  "base_date",
  "reminder_days",
] as const;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("保養計畫回傳格式錯誤");
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("保養計畫識別碼錯誤");
  return value;
}
/** Whitelist editable fields. IDs, enabled, calculated dates and timestamps never enter changes. */
export function planFields(
  value: MaintenancePlanFields,
): MaintenancePlanFields {
  if (typeof value.name !== "string" || !value.name.trim())
    throw new Error("請填寫保養名稱");
  if (!Number.isSafeInteger(value.interval_value) || value.interval_value < 1)
    throw new Error("週期須為正整數");
  if (!["day", "month", "year"].includes(value.interval_unit))
    throw new Error("週期單位錯誤");
  if (!["completion", "fixed"].includes(value.calculation_mode))
    throw new Error("計算模式錯誤");
  if (!Number.isSafeInteger(value.reminder_days) || value.reminder_days < 0)
    throw new Error("提前提醒天數須為非負整數");
  parseDate(value.base_date); // Validate only; send the original calendar date without conversion.
  return {
    name: value.name.trim(),
    interval_value: value.interval_value,
    interval_unit: value.interval_unit,
    calculation_mode: value.calculation_mode,
    base_date: value.base_date,
    reminder_days: value.reminder_days,
  };
}
export function parseMaintenancePlan(value: unknown): MaintenancePlan {
  const row = object(value);
  const fields = planFields(row as unknown as MaintenancePlanFields);
  for (const key of [
    "last_completed_date",
    "next_due_date",
    "created_at",
    "updated_at",
  ])
    if (typeof row[key] !== "string")
      throw new Error(`保養計畫 ${key} 格式錯誤`);
  if (row.last_completed_date) parseDate(row.last_completed_date as string);
  parseDate(row.next_due_date as string);
  if (typeof row.enabled !== "boolean") throw new Error("保養計畫啟用狀態錯誤");
  return {
    ...fields,
    plan_id: id(row.plan_id),
    item_id: id(row.item_id),
    last_completed_date: row.last_completed_date as string,
    next_due_date: row.next_due_date as string,
    enabled: row.enabled,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
export function createMaintenancePlansRepository(
  bridge: Pick<AppsScriptBridge, "request">,
) {
  const get = async (planId: string): Promise<MaintenancePlan | null> => {
    const result = await bridge.request("getMaintenancePlan", {
      plan_id: id(planId),
    });
    if (result === null) return null;
    const plan = parseMaintenancePlan(result);
    if (plan.plan_id !== planId) throw new Error("後端回傳不同保養計畫");
    return plan;
  };
  const owned = async (itemId: string, planId: string) => {
    id(itemId);
    const plan = await get(planId);
    if (!plan || plan.item_id !== itemId)
      throw new Error("保養計畫不屬於目前事項或已不存在");
  };
  const acknowledged = (value: unknown) => {
    const result = object(value);
    if (result.success !== true)
      throw new Error("保養計畫寫入未確認，請重新讀取核對");
    return result;
  };
  return {
    get,
    async list(itemId: string): Promise<MaintenancePlan[]> {
      const result = await bridge.request("getMaintenancePlans", {
        item_id: id(itemId),
      });
      if (!Array.isArray(result)) throw new Error("保養計畫清單必須是陣列");
      const plans = result.map(parseMaintenancePlan);
      if (
        plans.some((plan) => plan.item_id !== itemId) ||
        new Set(plans.map((plan) => plan.plan_id)).size !== plans.length
      )
        throw new Error("保養計畫清單包含其他事項或重複識別碼");
      return plans;
    },
    async create(itemId: string, fields: MaintenancePlanFields) {
      const result = acknowledged(
        await bridge.request("createMaintenancePlan", {
          item_id: id(itemId),
          ...planFields(fields),
        }),
      );
      id(result.plan_id);
      if (result.item_id !== itemId)
        throw new Error("新增結果事項不符，請重新讀取核對");
    },
    async update(
      itemId: string,
      original: MaintenancePlan,
      fields: MaintenancePlanFields,
    ) {
      if (original.item_id !== itemId)
        throw new Error("不可更換保養計畫所屬事項");
      const next = planFields(fields),
        before = planFields(original);
      const changes = Object.fromEntries(
        keys
          .filter((key) => next[key] !== before[key])
          .map((key) => [key, next[key]]),
      );
      await owned(itemId, original.plan_id);
      if (!Object.keys(changes).length) return;
      const result = acknowledged(
        await bridge.request("updateMaintenancePlan", {
          plan_id: original.plan_id,
          changes,
        }),
      );
      const plan = parseMaintenancePlan(result.plan);
      if (plan.plan_id !== original.plan_id || plan.item_id !== itemId)
        throw new Error("更新結果識別碼不符，請重新讀取核對");
    },
    async setEnabled(itemId: string, planId: string, enabled: boolean) {
      await owned(itemId, planId);
      const result = acknowledged(
        await bridge.request(
          enabled ? "enableMaintenancePlan" : "disableMaintenancePlan",
          { plan_id: planId },
        ),
      );
      if (result.plan_id !== planId || result.enabled !== enabled)
        throw new Error("啟用狀態未確認，請重新讀取核對");
    },
  };
}
export type MaintenancePlansRepository = ReturnType<
  typeof createMaintenancePlansRepository
>;
