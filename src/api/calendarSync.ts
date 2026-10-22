import type { AppsScriptBridge } from "./appsScriptBridge";
import type { MaintenancePlan } from "./maintenancePlans";
import { calendarTimestamp } from "../lib/calendarTimestamps";

/** CalendarSync worksheet shape. IDs and authorization details stay in the backend. */
export interface CalendarSyncRow {
  sync_id: string;
  plan_id: string;
  calendar_id: string;
  event_id: string;
  sync_status: string;
  last_synced_at: string;
  error_message: string;
  updated_at: string;
}

/** The only fields exposed by the Web App v3.1 read-only Bridge action. */
export interface CalendarSyncStatus {
  plan_id: string;
  sync_status: string;
  last_synced_at: string;
  error_message: string;
  has_event: boolean;
}

// Web App v3.1 supports this action. Keep an explicit opt-out for older deployments.
export const CALENDAR_SYNC_STATUS_API_ENABLED =
  import.meta.env.VITE_CALENDAR_SYNC_STATUS_API_ENABLED !== "false";

export function parseCalendarSyncStatus(
  value: unknown,
  planId: string,
): CalendarSyncStatus {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("日曆同步狀態格式錯誤");
  const row = value as Record<string, unknown>;
  if (
    row.plan_id !== planId ||
    typeof row.sync_status !== "string" ||
    typeof row.last_synced_at !== "string" ||
    typeof row.error_message !== "string" ||
    typeof row.has_event !== "boolean"
  )
    throw new Error("日曆同步狀態格式或計畫識別碼錯誤");
  return {
    plan_id: planId,
    sync_status: row.sync_status,
    last_synced_at: row.last_synced_at,
    error_message: row.error_message,
    has_event: row.has_event,
  };
}

/** A previous sync row must not certify a plan edited after that sync. */
export function isConfirmedCalendarSync(
  plan: MaintenancePlan,
  status: CalendarSyncStatus,
): boolean {
  return calendarSyncLabel(plan, status) === "Google Calendar 已同步紀錄";
}

export function calendarSyncLabel(
  plan: MaintenancePlan,
  status: CalendarSyncStatus,
): string {
  if (status.sync_status === "error") return "同步失敗";
  if (status.sync_status === "disabled") return "提醒已停用";
  if (status.sync_status === "not_synced") return "尚未同步";
  if (status.sync_status !== "synced") return "無法確認";
  const updated = calendarTimestamp(plan.updated_at);
  const synced = calendarTimestamp(status.last_synced_at);
  if (updated === null || synced === null) return "無法確認";
  if (synced < updated) return "等待下次同步";
  return plan.enabled &&
    status.sync_status === "synced" &&
    status.has_event &&
    !status.error_message
    ? "Google Calendar 已同步紀錄"
    : "無法確認";
}

export function createCalendarSyncRepository(
  bridge: Pick<AppsScriptBridge, "request">,
  enabled = CALENDAR_SYNC_STATUS_API_ENABLED,
) {
  return {
    enabled,
    async get(planId: string): Promise<CalendarSyncStatus> {
      if (!enabled) throw new Error("同步狀態尚未連接");
      if (!planId) throw new Error("缺少保養計畫識別碼");
      return parseCalendarSyncStatus(
        await bridge.request("getCalendarSyncStatus", { plan_id: planId }),
        planId,
      );
    },
  };
}
export type CalendarSyncRepository = ReturnType<
  typeof createCalendarSyncRepository
>;
