import { today } from "../lib/dates";
import type { MaintenancePlan } from "./maintenancePlans";
import { recordId } from "./maintenanceRecords";
import type { RecordSubmission } from "./maintenanceRecords";

/** A pending cloud submission, separate from the Mock data key. */
export const RECORD_DRAFTS_KEY =
  "life-records-manager:pending-cloud-records:v1";
export type DraftPhase = "editing" | "uncertain" | "acknowledged" | "conflict";
export interface RecordDraft extends RecordSubmission {
  phase: DraftPhase;
}
function draftKey(itemId: string, planId: string) {
  return `${itemId}\u0000${planId}`;
}
function readAll(): Record<string, RecordDraft> {
  const raw = sessionStorage.getItem(RECORD_DRAFTS_KEY);
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("待確認的保養草稿資料損壞，未建立新識別碼");
  return value as Record<string, RecordDraft>;
}
function valid(
  value: RecordDraft,
  itemId: string,
  planId: string,
): RecordDraft {
  if (
    !value ||
    value.item_id !== itemId ||
    value.plan_id !== planId ||
    !["editing", "uncertain", "acknowledged", "conflict"].includes(value.phase)
  )
    throw new Error("待確認的保養草稿資料不符，未建立新識別碼");
  recordId(value.record_id);
  if (
    typeof value.completed_date !== "string" ||
    typeof value.title !== "string" ||
    typeof value.amount !== "number" ||
    typeof value.vendor !== "string" ||
    typeof value.description !== "string"
  )
    throw new Error("待確認的保養草稿欄位格式錯誤");
  return value;
}
export const recordDrafts = {
  read(itemId: string, planId: string): RecordDraft | null {
    const value = readAll()[draftKey(itemId, planId)];
    return value ? valid(value, itemId, planId) : null;
  },
  open(itemId: string, plan: MaintenancePlan): RecordDraft {
    if (plan.item_id !== itemId) throw new Error("保養計畫所屬事項不符");
    const prior = this.read(itemId, plan.plan_id);
    if (prior) return prior;
    const draft: RecordDraft = {
      record_id: crypto.randomUUID(),
      item_id: itemId,
      plan_id: plan.plan_id,
      completed_date: today(),
      title: plan.name,
      amount: 0,
      vendor: "",
      description: "",
      phase: "editing",
    };
    this.save(draft);
    return draft;
  },
  save(draft: RecordDraft) {
    valid(draft, draft.item_id, draft.plan_id);
    const all = readAll();
    const key = draftKey(draft.item_id, draft.plan_id);
    if (all[key] && all[key].record_id !== draft.record_id)
      throw new Error("草稿識別碼已改變，請先核對原完成紀錄");
    sessionStorage.setItem(
      RECORD_DRAFTS_KEY,
      JSON.stringify({ ...all, [key]: draft }),
    );
  },
  clear(draft: RecordDraft) {
    const all = readAll(),
      key = draftKey(draft.item_id, draft.plan_id);
    if (all[key]?.record_id !== draft.record_id) return;
    delete all[key];
    sessionStorage.setItem(RECORD_DRAFTS_KEY, JSON.stringify(all));
  },
};
