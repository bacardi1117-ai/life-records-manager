import type { CalendarSyncSnapshot } from "../api/itemsStore";
import type { MaintenancePlan } from "../api/maintenancePlans";
import { isConfirmedCalendarSync } from "../api/calendarSync";

export default function CalendarSyncStatus({
  plan,
  snapshot,
  planState,
}: {
  plan: MaintenancePlan;
  snapshot: CalendarSyncSnapshot;
  planState: "idle" | "loading" | "ready" | "error";
}) {
  const entry = snapshot.statuses[plan.plan_id];
  const data =
    planState === "ready" && entry?.state === "ready" ? entry.data : undefined;
  const label = !snapshot.enabled
    ? "同步狀態尚未連接"
    : planState === "error"
      ? "無法確認"
      : entry?.state === "loading" || !entry
        ? "正在讀取同步狀態…"
        : entry.state === "error"
          ? "無法確認"
          : data && isConfirmedCalendarSync(plan, data)
            ? "已同步"
            : data?.sync_status === "disabled"
              ? "已停用"
              : data?.sync_status === "error"
                ? "同步失敗"
                : "尚未同步 / 無法確認";
  return (
    <section
      className="calendar-sync-status"
      aria-label={`${plan.name} Google Calendar 提醒`}
    >
      <h4>Google Calendar 提醒</h4>
      <dl>
        <dt>下次保養日期</dt>
        <dd>{plan.next_due_date || "尚未設定"}</dd>
        <dt>提前提醒</dt>
        <dd>{plan.reminder_days} 天</dd>
        <dt>同步狀態</dt>
        <dd>{label}</dd>
        <dt>最近同步時間</dt>
        <dd>{data?.last_synced_at || "無法確認"}</dd>
      </dl>
      {(entry?.state === "error" ||
        !!data?.error_message ||
        data?.sync_status === "error") && (
        <p className="calendar-sync-error" role="alert">
          {entry?.state === "error"
            ? entry.error || "同步狀態讀取失敗"
            : data?.error_message || "同步失敗，尚無詳細錯誤訊息"}
        </p>
      )}
      <p className="muted small">
        私人 Apps Script 每 15
        分鐘定期檢查，並非即時同步；首次自動執行仍待驗證。
      </p>
    </section>
  );
}
