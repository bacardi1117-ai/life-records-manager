// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { createCloudNotesRepository } from "../src/api/cloudNotes";
import { noteDrafts } from "../src/api/noteDrafts";
const row = {
  note_id: "test-note",
  item_id: "test-item",
  note_date: "2026-10-21",
  text: "假資料",
  status: "active" as const,
  created_at: "2026-10-21 10:00:00",
  updated_at: "2026-10-21 10:00:00",
};
beforeEach(() => sessionStorage.clear());
it("blocks every proposed Bridge action while backend capability is off", async () => {
  const request = vi.fn();
  const repo = createCloudNotesRepository({ request }, false);
  await expect(repo.list("test-item")).rejects.toThrow("尚未連接");
  await expect(repo.create({ ...row })).rejects.toThrow("尚未連接");
  expect(request).not.toHaveBeenCalled();
});
it("validates item ownership and sends only allowed fields when enabled", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce({ success: true, note_id: row.note_id });
  const repo = createCloudNotesRepository({ request }, true);
  expect(await repo.list("test-item")).toEqual([row]);
  await repo.create(row);
  expect(request).toHaveBeenLastCalledWith("createNote", {
    note_id: row.note_id,
    item_id: row.item_id,
    note_date: row.note_date,
    text: row.text,
  });
  request.mockResolvedValue([{ ...row, item_id: "other" }]);
  await expect(repo.list("test-item")).rejects.toThrow("其他事項");
});
it("keeps one pending note ID across reload and clears only the matching draft", () => {
  const draft = noteDrafts.open("test-item");
  noteDrafts.save({ ...draft, text: "未完成備註" });
  expect(noteDrafts.open("test-item")).toMatchObject({
    note_id: draft.note_id,
    text: "未完成備註",
  });
  expect(noteDrafts.open("other").note_id).not.toBe(draft.note_id);
  noteDrafts.clear(draft);
  expect(noteDrafts.open("test-item").note_id).not.toBe(draft.note_id);
});
