import { useEffect, useRef, useState } from "react";
import { Edit3, Plus, Repeat2 } from "lucide-react";
import type { LifeItem } from "../models";
import type { ItemsStore, PlansSnapshot } from "../api/itemsStore";
import type {
  MaintenancePlan,
  MaintenancePlanFields,
} from "../api/maintenancePlans";
import { Modal } from "./Forms";
import { CloudHistoryList, CompletionForm } from "./CloudMaintenanceRecords";
import type { RecordsSnapshot } from "../api/itemsStore";

const units = { day: "天", month: "月", year: "年" };
export default function CloudMaintenancePlans({
  item,
  store,
  state,
  records,
  busy,
  readOnly,
}: {
  item: LifeItem;
  store: ItemsStore;
  state: PlansSnapshot;
  records: RecordsSnapshot;
  busy: boolean;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState<MaintenancePlan | "new" | null>(null);
  const [completing, setCompleting] = useState<MaintenancePlan | null>(null);
  const [viewingPlan, setViewingPlan] = useState<string | null>(null);
  useEffect(() => {
    if (!busy && state.status === "idle") void store.loadPlans(item.id);
  }, [store, item.id, busy, state.status]);
  const ready = state.itemId === item.id && state.status === "ready";
  const disabled = readOnly || !ready;
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>定期照顧，安心生活</h2>
          <p className="muted small">
            Google Sheets 保養計畫 · 下次保養日由後端計算。
          </p>
        </div>
        <button
          className="text-button"
          disabled={disabled}
          onClick={() => setEditing("new")}
        >
          <Plus size={16} />
          新增子項目
        </button>
      </div>
      {state.error && (
        <p className="error-banner" role="alert">
          {state.error}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      <button
        className="text-button"
        disabled={busy || state.status === "loading"}
        onClick={() => void store.loadPlans(item.id)}
      >
        重新讀取保養計畫
      </button>
      {state.status === "loading" && <p role="status">正在讀取保養計畫…</p>}
      {state.itemId === item.id &&
        state.rows.map((plan) => (
          <div className="task-row cloud-plan" key={plan.plan_id}>
            <span className="task-icon">
              <Repeat2 size={20} />
            </span>
            <div className="task-info">
              <h3>{plan.name}</h3>
              <p>
                每 {plan.interval_value} {units[plan.interval_unit]} ·{" "}
                {plan.calculation_mode === "completion"
                  ? "完成日起算"
                  : "固定週期"}
              </p>
              <p>
                下次保養 {plan.next_due_date} · 提前 {plan.reminder_days} 天提醒
              </p>
              <p>最近完成 {plan.last_completed_date || "尚無紀錄"}</p>
              <span className="status">
                {plan.enabled ? "已啟用" : "已停用"}
              </span>
            </div>
            <div className="task-actions">
              <button
                className="icon-button"
                aria-label={`編輯${plan.name}`}
                disabled={disabled}
                onClick={() => setEditing(plan)}
              >
                <Edit3 size={16} />
              </button>
              <button
                className="secondary"
                disabled={disabled}
                onClick={() =>
                  void store
                    .setPlanEnabled(item.id, plan.plan_id, !plan.enabled)
                    .catch(() => {})
                }
              >
                {plan.enabled ? "停用" : "重新啟用"}
              </button>
              <button
                className="secondary"
                disabled={
                  disabled || !plan.enabled || records.status !== "ready"
                }
                onClick={() => setCompleting(plan)}
              >
                完成保養
              </button>
              <button
                className="text-button"
                onClick={() => {
                  if (viewingPlan === plan.plan_id) setViewingPlan(null);
                  else {
                    setViewingPlan(plan.plan_id);
                    void store.loadPlanRecords(item.id, plan.plan_id);
                  }
                }}
              >
                {viewingPlan === plan.plan_id ? "收合紀錄" : "查看紀錄"}
              </button>
            </div>
            {viewingPlan === plan.plan_id && (
              <div className="plan-history">
                <CloudHistoryList
                  rows={
                    records.byPlan.planId === plan.plan_id
                      ? records.byPlan.rows
                      : []
                  }
                  status={
                    records.byPlan.planId === plan.plan_id
                      ? records.byPlan.status
                      : "loading"
                  }
                  error={
                    records.byPlan.planId === plan.plan_id
                      ? records.byPlan.error
                      : ""
                  }
                  emptyText="這個子項目還沒有完成紀錄。"
                  planNames={{ [plan.plan_id]: plan.name }}
                />
              </div>
            )}
          </div>
        ))}
      {ready && !state.rows.length && (
        <p className="empty">還沒有定期子項目，新增一個保養計畫吧。</p>
      )}
      {records.error && (
        <p className="error-banner" role="alert">
          {records.error}
        </p>
      )}
      {records.notice && <p role="status">{records.notice}</p>}
      <button
        className="text-button"
        disabled={busy || records.status === "loading"}
        onClick={() => void store.loadRecords(item.id)}
      >
        重新讀取完成紀錄
      </button>
      <p className="cloud-notice">
        Google Calendar 自動提醒、Google Drive
        照片及獨立備註尚未支援雲端同步。提前提醒天數目前只保存設定，不會發送通知。
      </p>
      {completing && (
        <Modal title="完成保養" close={() => !busy && setCompleting(null)}>
          <CompletionForm
            key={completing.plan_id}
            itemId={item.id}
            plan={completing}
            store={store}
            records={records}
            busy={busy}
            readOnly={readOnly}
            close={() => setCompleting(null)}
          />
        </Modal>
      )}
      {editing && (
        <Modal
          title={editing === "new" ? "新增定期子項目" : "編輯定期子項目"}
          error={state.error}
          close={() => !busy && setEditing(null)}
        >
          <MaintenancePlanForm
            plan={editing === "new" ? undefined : editing}
            baseDate={item.date}
            busy={busy}
            disabled={disabled}
            recover={
              state.status === "error"
                ? () => store.loadPlans(item.id)
                : undefined
            }
            submit={async (fields, original) => {
              await store.savePlan(item.id, fields, original);
              setEditing(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}
function MaintenancePlanForm({
  plan,
  baseDate,
  busy,
  disabled,
  recover,
  submit,
}: {
  plan?: MaintenancePlan;
  baseDate: string;
  busy: boolean;
  disabled: boolean;
  recover?: () => Promise<void>;
  submit: (
    fields: MaintenancePlanFields,
    original?: MaintenancePlan,
  ) => Promise<void>;
}) {
  // Preserve the edit baseline and uncontrolled inputs when a failed request is recovered.
  const initial = useRef(plan).current;
  return (
    <form
      className="form-grid cloud-plan-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled || busy) return;
        const data = new FormData(e.currentTarget);
        void submit(
          {
            name: String(data.get("name")),
            interval_value: Number(data.get("interval_value")),
            interval_unit: data.get(
              "interval_unit",
            ) as MaintenancePlanFields["interval_unit"],
            calculation_mode: data.get(
              "calculation_mode",
            ) as MaintenancePlanFields["calculation_mode"],
            base_date: String(data.get("base_date")),
            reminder_days: Number(data.get("reminder_days")),
          },
          initial,
        ).catch(() => {});
      }}
    >
      <label>
        保養名稱
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={initial?.name ?? ""}
        />
      </label>
      <div className="field-row">
        <label>
          週期數值
          <input
            name="interval_value"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={initial?.interval_value ?? 30}
          />
        </label>
        <label>
          週期單位
          <select
            aria-label="週期單位"
            name="interval_unit"
            defaultValue={initial?.interval_unit ?? "day"}
          >
            <option value="day">天</option>
            <option value="month">月</option>
            <option value="year">年</option>
          </select>
        </label>
      </div>
      <label>
        計算模式
        <select
          aria-label="計算模式"
          name="calculation_mode"
          defaultValue={initial?.calculation_mode ?? "completion"}
        >
          <option value="completion">完成日起算</option>
          <option value="fixed">固定週期</option>
        </select>
      </label>
      <label>
        基準日期
        <input
          name="base_date"
          type="date"
          required
          defaultValue={initial?.base_date ?? baseDate}
        />
      </label>
      <label>
        提前提醒天數
        <input
          name="reminder_days"
          type="number"
          min={0}
          step={1}
          required
          defaultValue={initial?.reminder_days ?? 7}
        />
      </label>
      <p className="muted small">下次保養日由後端計算；提醒通知尚未串接。</p>
      {recover && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void recover()}
        >
          重新讀取計畫並保留草稿
        </button>
      )}
      <button className="primary" disabled={disabled || busy}>
        {busy ? "儲存中…" : "儲存保養計畫"}
      </button>
    </form>
  );
}
