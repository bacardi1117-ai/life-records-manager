import { useState } from "react";
import type { ItemsStore, RecordsSnapshot } from "../api/itemsStore";
import type { MaintenancePlan } from "../api/maintenancePlans";
import type { CloudMaintenanceRecord } from "../api/maintenanceRecords";
import type { RecordDraft } from "../api/recordDrafts";
import { money } from "../lib/dates";

export function CloudHistoryList({
  rows,
  status,
  error,
  emptyText,
  planNames,
}: {
  rows: CloudMaintenanceRecord[];
  status: "idle" | "loading" | "ready" | "error";
  error: string;
  emptyText: string;
  planNames?: Record<string, string>;
}) {
  return (
    <>
      {status === "loading" || status === "idle" ? (
        <p role="status">正在讀取完成紀錄…</p>
      ) : null}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {status === "ready" && !rows.length && (
        <p className="empty">{emptyText}</p>
      )}
      {status === "ready" && (
        <div className="timeline cloud-history">
          {rows.map((record) => (
            <article key={record.record_id}>
              <div className="record-top">
                <time>{record.completed_date}</time>
                <strong>{money(record.amount)}</strong>
              </div>
              <p>保養項目：{planNames?.[record.plan_id] ?? record.title}</p>
              <h3>{record.title}</h3>
              <p>施作廠商：{record.vendor || "未填寫"}</p>
              <p>備註：{record.description || "無備註"}</p>
              <details>
                <summary>查看完整內容</summary>
                <p>保養標題：{record.title}</p>
                <p>完整備註：{record.description || "無備註"}</p>
                <p>完成日期：{record.completed_date}</p>
              </details>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export function CompletionForm({
  itemId,
  plan,
  store,
  records,
  busy,
  readOnly,
  close,
}: {
  itemId: string;
  plan: MaintenancePlan;
  store: ItemsStore;
  records: RecordsSnapshot;
  busy: boolean;
  readOnly: boolean;
  close: () => void;
}) {
  const [draft, setDraft] = useState<RecordDraft>(() =>
    store.openCompletionDraft(itemId, plan),
  );
  const [localError, setLocalError] = useState("");
  function change<K extends keyof RecordDraft>(key: K, value: RecordDraft[K]) {
    const next = { ...draft, [key]: value };
    try {
      store.saveCompletionDraft(next);
      setDraft(next);
      setLocalError("");
    } catch (error) {
      setLocalError((error as Error).message);
    }
  }
  const canSubmit =
    !busy &&
    !readOnly &&
    plan.enabled &&
    draft.phase === "editing" &&
    records.status === "ready";
  async function submit() {
    try {
      setLocalError("");
      await store.submitCompletion(draft);
      close();
    } catch (error) {
      setLocalError((error as Error).message);
      setDraft(store.getCompletionDraft(itemId, plan.plan_id) ?? draft);
    }
  }
  async function check() {
    try {
      setLocalError("");
      if (await store.checkCompletion(draft)) close();
      else setDraft(store.getCompletionDraft(itemId, plan.plan_id) ?? draft);
    } catch (error) {
      setLocalError((error as Error).message);
      setDraft(store.getCompletionDraft(itemId, plan.plan_id) ?? draft);
    }
  }
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) void submit();
      }}
    >
      <p>
        保養項目：<strong>{plan.name}</strong>
      </p>
      {(localError || records.error) && (
        <p className="error-banner" role="alert">
          {localError || records.error}
        </p>
      )}
      <label>
        完成日期
        <input
          type="date"
          required
          value={draft.completed_date}
          disabled={draft.phase !== "editing" || busy}
          onChange={(event) => change("completed_date", event.target.value)}
        />
      </label>
      <label>
        保養標題
        <input
          required
          value={draft.title}
          disabled={draft.phase !== "editing" || busy}
          onChange={(event) => change("title", event.target.value)}
        />
      </label>
      <label>
        保養費用（NT$）
        <input
          type="number"
          min="0"
          step="0.01"
          required
          value={draft.amount}
          disabled={draft.phase !== "editing" || busy}
          onChange={(event) => change("amount", Number(event.target.value))}
        />
      </label>
      <label>
        施作廠商
        <input
          value={draft.vendor}
          disabled={draft.phase !== "editing" || busy}
          onChange={(event) => change("vendor", event.target.value)}
        />
      </label>
      <label>
        備註
        <textarea
          rows={4}
          maxLength={5000}
          value={draft.description}
          disabled={draft.phase !== "editing" || busy}
          onChange={(event) => change("description", event.target.value)}
        />
      </label>
      <p className="muted small">
        草稿使用固定的紀錄識別碼。結果不確定時，請先查詢原紀錄；不會自動換新識別碼。
      </p>
      {(draft.phase === "uncertain" ||
        draft.phase === "acknowledged" ||
        draft.phase === "conflict") && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void check()}
        >
          查詢原紀錄並核對
        </button>
      )}
      {draft.phase === "conflict" && !localError && !records.error && (
        <p className="error-banner" role="alert">
          相同識別碼已有不同內容，已停止重試。
        </p>
      )}
      <button className="primary" disabled={!canSubmit}>
        {busy ? "儲存中…" : "儲存完成紀錄"}
      </button>
    </form>
  );
}
