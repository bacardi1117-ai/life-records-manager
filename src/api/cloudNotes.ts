import type { AppsScriptBridge } from "./appsScriptBridge";

/** Web App v3.2 Notes actions; explicit false permits local compatibility testing. */
export const NOTES_API_ENABLED = import.meta.env.VITE_NOTES_API_ENABLED !== "false";
export type NoteOwnerType = "item" | "plan";
export interface CloudNote {
  note_id: string;
  owner_type: NoteOwnerType;
  owner_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}
export type NewCloudNote = Pick<CloudNote, "note_id" | "owner_type" | "owner_id" | "title" | "content">;
const id = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error("備註識別碼錯誤");
  return value;
};
const owner = (value: unknown): NoteOwnerType => {
  if (value !== "item" && value !== "plan") throw new Error("備註所屬類型錯誤");
  return value;
};
export function noteFields(value: { title: string; content: string }) {
  if (typeof value.title !== "string" || !value.title.trim()) throw new Error("請輸入備註標題");
  if (typeof value.content !== "string" || !value.content.trim()) throw new Error("請輸入備註內容");
  return { title: value.title.trim(), content: value.content.trim() };
}
export function parseCloudNote(value: unknown): CloudNote {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("備註格式錯誤");
  const row = value as Record<string, unknown>;
  if (typeof row.title !== "string" || typeof row.content !== "string" ||
      typeof row.created_at !== "string" || typeof row.updated_at !== "string")
    throw new Error("備註欄位格式錯誤");
  return {
    note_id: id(row.note_id), owner_type: owner(row.owner_type), owner_id: id(row.owner_id),
    title: row.title, content: row.content, created_at: row.created_at, updated_at: row.updated_at,
  };
}
function confirmation(value: unknown, expected: CloudNote, operation: string): CloudNote {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${operation}結果未確認`);
  const response = value as Record<string, unknown>;
  if (response.success !== true || (operation === "新增備註" && typeof response.duplicate !== "boolean"))
    throw new Error(`${operation}結果未確認`);
  const note = parseCloudNote(response.note);
  if (note.note_id !== expected.note_id || note.owner_type !== expected.owner_type ||
      note.owner_id !== expected.owner_id || note.title !== expected.title || note.content !== expected.content)
    throw new Error("備註寫入結果與草稿不同，已停止重試");
  return note;
}
export function createCloudNotesRepository(bridge: Pick<AppsScriptBridge, "request">, enabled = NOTES_API_ENABLED) {
  const available = () => { if (!enabled) throw new Error("備註雲端 API 尚未連接"); };
  return {
    enabled,
    async list(ownerType: NoteOwnerType, ownerId: string): Promise<CloudNote[]> {
      available();
      const result = await bridge.request("getNotes", { owner_type: owner(ownerType), owner_id: id(ownerId) });
      if (!Array.isArray(result)) throw new Error("備註清單格式錯誤");
      const rows = result.map(parseCloudNote);
      if (rows.some(row => row.owner_type !== ownerType || row.owner_id !== ownerId) ||
          new Set(rows.map(row => row.note_id)).size !== rows.length)
        throw new Error("備註清單包含其他所屬資料或重複識別碼");
      return rows.sort((a,b) => b.created_at.localeCompare(a.created_at));
    },
    async get(noteId: string): Promise<CloudNote | null> {
      available();
      const result = await bridge.request("getNote", { note_id: id(noteId) });
      if (result === null) return null;
      const note = parseCloudNote(result);
      if (note.note_id !== noteId) throw new Error("備註識別碼不符");
      return note;
    },
    async create(value: NewCloudNote): Promise<CloudNote> {
      available();
      const expected = { ...value, owner_type: owner(value.owner_type), owner_id: id(value.owner_id),
        note_id: id(value.note_id), ...noteFields(value), created_at: "", updated_at: "" };
      return confirmation(await bridge.request("createNote", {
        note_id: expected.note_id, owner_type: expected.owner_type, owner_id: expected.owner_id,
        title: expected.title, content: expected.content,
      }), expected, "新增備註");
    },
    async update(original: CloudNote, changes: { title?: string; content?: string }): Promise<CloudNote> {
      available();
      const current = await this.get(original.note_id);
      if (!current || current.owner_type !== original.owner_type || current.owner_id !== original.owner_id)
        throw new Error("備註所屬資料不符");
      const fields = noteFields({ title: changes.title ?? current.title, content: changes.content ?? current.content });
      const actual: {title?: string; content?: string} = {};
      if (fields.title !== current.title) actual.title = fields.title;
      if (fields.content !== current.content) actual.content = fields.content;
      if (!Object.keys(actual).length) return current;
      return confirmation(await bridge.request("updateNote", { note_id: original.note_id, changes: actual }),
        { ...current, ...fields }, "編輯備註");
    },
  };
}
export type CloudNotesRepository = ReturnType<typeof createCloudNotesRepository>;
