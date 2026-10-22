// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { createCloudNotesRepository } from "../src/api/cloudNotes";
import { noteDrafts } from "../src/api/noteDrafts";
const row = {
  note_id: "test-note", owner_type: "item" as const, owner_id: "test-item",
  title: "標題", content: "假資料", created_at: "2026-10-21 10:00:00", updated_at: "2026-10-21 10:00:00",
};
beforeEach(() => sessionStorage.clear());
it("blocks Notes actions when capability is explicitly disabled", async () => {
  const request = vi.fn();
  const repo = createCloudNotesRepository({ request }, false);
  await expect(repo.list("item", "test-item")).rejects.toThrow("尚未連接");
  await expect(repo.create(row)).rejects.toThrow("尚未連接");
  expect(request).not.toHaveBeenCalled();
});
it("sends v3.2 owner fields, parses note array and isolates owners", async () => {
  const request = vi.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce({ success: true, duplicate: false, note: row });
  const repo = createCloudNotesRepository({ request }, true);
  expect(await repo.list("item", "test-item")).toEqual([row]);
  expect(request).toHaveBeenCalledWith("getNotes", { owner_type: "item", owner_id: "test-item" });
  await repo.create(row);
  expect(request).toHaveBeenLastCalledWith("createNote", {
    note_id: row.note_id, owner_type: "item", owner_id: "test-item", title: "標題", content: "假資料",
  });
  request.mockResolvedValue([{ ...row, owner_id: "other" }]);
  await expect(repo.list("item", "test-item")).rejects.toThrow("其他所屬");
  await expect(repo.list("plan", "test-item")).rejects.toThrow("其他所屬");
});
it("accepts matching duplicate, rejects conflict and sends only editable fields", async () => {
  const request = vi.fn().mockResolvedValueOnce({ success: true, duplicate: true, note: row })
    .mockResolvedValueOnce({ success: true, duplicate: true, note: { ...row, content: "其他" } })
    .mockResolvedValueOnce(row)
    .mockResolvedValueOnce({ success: true, note: { ...row, content: "新內容" } });
  const repo = createCloudNotesRepository({ request }, true);
  await expect(repo.create(row)).resolves.toEqual(row);
  await expect(repo.create(row)).rejects.toThrow("不同");
  await repo.update(row, { content: "新內容" });
  expect(request).toHaveBeenLastCalledWith("updateNote", { note_id: row.note_id, changes: { content: "新內容" } });
});
it("keeps one UUID per owner through retry and isolates item and plan drafts", () => {
  const draft = noteDrafts.open("item", "test-item");
  noteDrafts.save({ ...draft, title: "待送標題", content: "待送內容" });
  expect(noteDrafts.open("item", "test-item").note_id).toBe(draft.note_id);
  expect(noteDrafts.open("plan", "test-item").note_id).not.toBe(draft.note_id);
  noteDrafts.clear(draft);
  expect(noteDrafts.open("item", "test-item").note_id).not.toBe(draft.note_id);
});
