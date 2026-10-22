import { today } from "../lib/dates";
import type { NewCloudNote } from "./cloudNotes";

const KEY = "life-records-manager:pending-cloud-note:v1";
function readAll(): Record<string, NewCloudNote> {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("待送出的雲端備註草稿格式錯誤");
  return value as Record<string, NewCloudNote>;
}
export const noteDrafts = {
  open(itemId: string): NewCloudNote {
    const existing = readAll()[itemId];
    if (existing) {
      if (
        existing.item_id !== itemId ||
        typeof existing.note_id !== "string" ||
        !existing.note_id ||
        typeof existing.text !== "string" ||
        typeof existing.note_date !== "string"
      )
        throw new Error("雲端備註草稿識別碼不符");
      return existing;
    }
    const draft = {
      note_id: crypto.randomUUID(),
      item_id: itemId,
      note_date: today(),
      text: "",
    };
    this.save(draft);
    return draft;
  },
  save(draft: NewCloudNote) {
    const all = readAll();
    if (all[draft.item_id] && all[draft.item_id].note_id !== draft.note_id)
      throw new Error("雲端備註草稿識別碼已改變");
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...all, [draft.item_id]: draft }),
    );
  },
  clear(draft: NewCloudNote) {
    const all = readAll();
    if (all[draft.item_id]?.note_id !== draft.note_id) return;
    delete all[draft.item_id];
    sessionStorage.setItem(KEY, JSON.stringify(all));
  },
};
