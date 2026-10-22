import type { AppsScriptBridge } from "./appsScriptBridge";
import { parseDate, today } from "../lib/dates";

/** Proposed Notes Bridge contract. Keep the capability off until deployed. */
export const NOTES_API_ENABLED =
  import.meta.env.VITE_NOTES_API_ENABLED === "true";
export interface CloudNote {
  note_id: string;
  item_id: string;
  note_date: string;
  text: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}
export interface NewCloudNote {
  note_id: string;
  item_id: string;
  note_date: string;
  text: string;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("備註識別碼錯誤");
  return value;
}
export function noteFields(value: { note_date: string; text: string }) {
  parseDate(value.note_date);
  if (value.note_date > today()) throw new Error("備註日期不得晚於今天");
  if (
    typeof value.text !== "string" ||
    !value.text.trim() ||
    value.text.length > 3000
  )
    throw new Error("備註須有內容且不得超過 3000 字");
  return { note_date: value.note_date, text: value.text.trim() };
}
export function parseCloudNote(value: unknown): CloudNote {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("備註格式錯誤");
  const row = value as Record<string, unknown>;
  const fields = noteFields(row as unknown as CloudNote);
  if (
    (row.status !== "active" && row.status !== "archived") ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  )
    throw new Error("備註狀態或時間格式錯誤");
  return {
    note_id: id(row.note_id),
    item_id: id(row.item_id),
    ...fields,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
function ack(value: unknown, noteId: string) {
  if (
    !value ||
    typeof value !== "object" ||
    (value as Record<string, unknown>).success !== true ||
    (value as Record<string, unknown>).note_id !== noteId
  )
    throw new Error("備註寫入結果未確認，請重新查詢");
}
export function createCloudNotesRepository(
  bridge: Pick<AppsScriptBridge, "request">,
  enabled = NOTES_API_ENABLED,
) {
  const available = () => {
    if (!enabled) throw new Error("備註雲端 API 尚未連接");
  };
  return {
    enabled,
    async list(itemId: string): Promise<CloudNote[]> {
      available();
      const result = await bridge.request("getNotes", { item_id: id(itemId) });
      if (!Array.isArray(result)) throw new Error("備註清單格式錯誤");
      const rows = result.map(parseCloudNote);
      if (
        rows.some((row) => row.item_id !== itemId) ||
        new Set(rows.map((row) => row.note_id)).size !== rows.length
      )
        throw new Error("備註清單包含其他事項或重複識別碼");
      return rows.sort(
        (a, b) =>
          b.note_date.localeCompare(a.note_date) ||
          b.created_at.localeCompare(a.created_at),
      );
    },
    async get(noteId: string): Promise<CloudNote | null> {
      available();
      const value = await bridge.request("getNote", { note_id: id(noteId) });
      if (value === null) return null;
      const note = parseCloudNote(value);
      if (note.note_id !== noteId) throw new Error("備註識別碼不符");
      return note;
    },
    async create(value: NewCloudNote) {
      available();
      const fields = noteFields(value);
      ack(
        await bridge.request("createNote", {
          note_id: id(value.note_id),
          item_id: id(value.item_id),
          ...fields,
        }),
        value.note_id,
      );
    },
    async update(itemId: string, noteId: string, text: string) {
      available();
      const existing = await this.get(noteId);
      if (
        !existing ||
        existing.item_id !== itemId ||
        existing.status !== "active"
      )
        throw new Error("備註不屬於目前事項或已封存");
      const next = noteFields({ note_date: existing.note_date, text }).text;
      if (existing.text === next) return;
      ack(
        await bridge.request("updateNote", {
          note_id: noteId,
          changes: { text: next },
        }),
        noteId,
      );
    },
    async archive(itemId: string, noteId: string) {
      available();
      const existing = await this.get(noteId);
      if (
        !existing ||
        existing.item_id !== itemId ||
        existing.status !== "active"
      )
        throw new Error("備註不屬於目前事項或已封存");
      ack(await bridge.request("archiveNote", { note_id: noteId }), noteId);
    },
  };
}
export type CloudNotesRepository = ReturnType<
  typeof createCloudNotesRepository
>;
