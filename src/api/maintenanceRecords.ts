import type { AppsScriptBridge } from "./appsScriptBridge";
import { parseDate, today } from "../lib/dates";

export interface MaintenanceRecordFields {
  completed_date: string;
  title: string;
  amount: number;
  vendor: string;
  description: string;
}
export interface CloudMaintenanceRecord extends MaintenanceRecordFields {
  record_id: string;
  plan_id: string;
  item_id: string;
  created_at: string;
  updated_at: string;
}
export interface RecordSubmission extends MaintenanceRecordFields {
  record_id: string;
  plan_id: string;
  item_id: string;
}
export interface RecordAck {
  duplicate: boolean;
  record_id: string;
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("完成紀錄格式錯誤");
  return value as Record<string, unknown>;
}
export function recordId(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("完成紀錄識別碼錯誤");
  return value;
}
export function recordFields(
  value: MaintenanceRecordFields,
): MaintenanceRecordFields {
  if (typeof value.completed_date !== "string")
    throw new Error("完成日期格式錯誤");
  parseDate(value.completed_date);
  if (value.completed_date > today()) throw new Error("完成日期不得晚於今天");
  if (typeof value.title !== "string" || !value.title.trim())
    throw new Error("請填寫保養標題");
  if (
    typeof value.amount !== "number" ||
    !Number.isFinite(value.amount) ||
    value.amount < 0
  )
    throw new Error("保養費用須為非負數");
  if (
    typeof value.vendor !== "string" ||
    typeof value.description !== "string" ||
    value.description.length > 5000
  )
    throw new Error("廠商或備註格式錯誤；備註最多 5000 字");
  return {
    completed_date: value.completed_date,
    title: value.title.trim(),
    amount: value.amount,
    vendor: value.vendor.trim(),
    description: value.description.trim(),
  };
}
export function parseMaintenanceRecord(value: unknown): CloudMaintenanceRecord {
  const data = row(value);
  const fields = recordFields(data as unknown as MaintenanceRecordFields);
  if (
    typeof data.created_at !== "string" ||
    typeof data.updated_at !== "string"
  )
    throw new Error("完成紀錄時間戳記格式錯誤");
  return {
    ...fields,
    record_id: recordId(data.record_id),
    plan_id: recordId(data.plan_id),
    item_id: recordId(data.item_id),
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}
export function matchesSubmission(
  record: CloudMaintenanceRecord,
  submission: RecordSubmission,
): boolean {
  const fields = recordFields(submission);
  return (
    record.record_id === submission.record_id &&
    record.plan_id === submission.plan_id &&
    record.item_id === submission.item_id &&
    (Object.keys(fields) as (keyof MaintenanceRecordFields)[]).every(
      (key) => record[key] === fields[key],
    )
  );
}
export function totalMaintenanceAmount(
  records: CloudMaintenanceRecord[],
): number {
  const seen = new Set<string>();
  return records.reduce((sum, record) => {
    if (seen.has(record.record_id)) return sum;
    seen.add(record.record_id);
    return sum + record.amount;
  }, 0);
}
function parseList(
  value: unknown,
  field: "item_id" | "plan_id",
  id: string,
): CloudMaintenanceRecord[] {
  if (!Array.isArray(value)) throw new Error("完成紀錄清單必須是陣列");
  const records = value.map(parseMaintenanceRecord);
  if (
    records.some((record) => record[field] !== id) ||
    new Set(records.map((record) => record.record_id)).size !== records.length
  )
    throw new Error("完成紀錄清單含其他事項或重複識別碼");
  return records.sort(
    (a, b) =>
      b.completed_date.localeCompare(a.completed_date) ||
      b.created_at.localeCompare(a.created_at),
  );
}
export function createMaintenanceRecordsRepository(
  bridge: Pick<AppsScriptBridge, "request">,
) {
  return {
    async byItem(itemId: string) {
      return parseList(
        await bridge.request("getMaintenanceRecordsByItem", {
          item_id: recordId(itemId),
        }),
        "item_id",
        itemId,
      );
    },
    async byPlan(planId: string) {
      return parseList(
        await bridge.request("getMaintenanceRecords", {
          plan_id: recordId(planId),
        }),
        "plan_id",
        planId,
      );
    },
    async get(id: string): Promise<CloudMaintenanceRecord | null> {
      const value = await bridge.request("getMaintenanceRecord", {
        record_id: recordId(id),
      });
      if (value === null) return null;
      const record = parseMaintenanceRecord(value);
      if (record.record_id !== id) throw new Error("後端回傳不同完成紀錄");
      return record;
    },
    async create(submission: RecordSubmission): Promise<RecordAck> {
      recordId(submission.record_id);
      recordId(submission.plan_id);
      recordId(submission.item_id);
      const fields = recordFields(submission);
      const value = row(
        await bridge.request("createMaintenanceRecord", {
          record_id: submission.record_id,
          plan_id: submission.plan_id,
          ...fields,
        }),
      );
      if (
        value.success !== true ||
        typeof value.duplicate !== "boolean" ||
        value.record_id !== submission.record_id ||
        (value.plan_id !== undefined && value.plan_id !== submission.plan_id) ||
        (value.item_id !== undefined && value.item_id !== submission.item_id) ||
        (value.completed_date !== undefined &&
          value.completed_date !== fields.completed_date)
      )
        throw new Error("完成紀錄寫入結果不符，請以原識別碼查詢核對");
      if (
        value.record !== undefined &&
        !matchesSubmission(parseMaintenanceRecord(value.record), submission)
      )
        throw new Error("完成紀錄內容衝突，已停止重試");
      return { duplicate: value.duplicate, record_id: submission.record_id };
    },
  };
}
export type MaintenanceRecordsRepository = ReturnType<
  typeof createMaintenanceRecordsRepository
>;
