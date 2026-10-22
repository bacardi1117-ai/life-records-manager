import type { NewCloudNote, NoteOwnerType } from "./cloudNotes";
const KEY = "life-records-manager:pending-cloud-note:v2";
const key = (ownerType: NoteOwnerType, ownerId: string) => `${ownerType}:${ownerId}`;
function readAll(): Record<string, NewCloudNote> {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("待送出的雲端備註草稿格式錯誤");
  return value as Record<string, NewCloudNote>;
}
export const noteDrafts = {
  open(ownerType: NoteOwnerType, ownerId: string): NewCloudNote {
    const existing = readAll()[key(ownerType, ownerId)];
    if (existing) {
      if (existing.owner_type !== ownerType || existing.owner_id !== ownerId ||
          typeof existing.note_id !== "string" || !existing.note_id ||
          typeof existing.title !== "string" || typeof existing.content !== "string")
        throw new Error("雲端備註草稿識別碼不符");
      return existing;
    }
    const draft = { note_id: crypto.randomUUID(), owner_type: ownerType, owner_id: ownerId, title: "", content: "" };
    this.save(draft);
    return draft;
  },
  save(draft: NewCloudNote) {
    const all = readAll(), k = key(draft.owner_type, draft.owner_id);
    if (all[k] && all[k].note_id !== draft.note_id) throw new Error("雲端備註草稿識別碼已改變");
    sessionStorage.setItem(KEY, JSON.stringify({ ...all, [k]: draft }));
  },
  clear(draft: NewCloudNote) {
    const all = readAll(), k = key(draft.owner_type, draft.owner_id);
    if (all[k]?.note_id !== draft.note_id) return;
    delete all[k];
    sessionStorage.setItem(KEY, JSON.stringify(all));
  },
};
