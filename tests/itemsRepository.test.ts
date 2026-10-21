import { describe, expect, it, vi } from "vitest";
import {
  changedFields,
  cloudRepository,
  fromSheets,
} from "../src/api/itemsRepository";
import { createSheetsItemsApi, type SheetsItem } from "../src/api/sheetsItems";
const row: SheetsItem = {
  item_id: "one",
  name: "測試",
  category: "家電設備",
  item_date: "2026-10-21",
  amount: 12.5,
  brand: "品牌",
  model: "M",
  location: "測試位置",
  warranty_date: "",
  status: "active",
  created_at: "",
  updated_at: "",
};
describe("shared cloud repository", () => {
  it("maps all basic fields without local Mock children", () => {
    const item = fromSheets(row);
    expect(item).toMatchObject({
      id: "one",
      date: row.item_date,
      amount: 12.5,
      model: "M",
      warrantyDate: "",
      status: "active",
      tasks: [],
      notes: [],
      photos: [],
      history: [],
    });
  });
  it("diffs only changed fields including cleared optional fields", () => {
    const original = fromSheets(row);
    expect(
      changedFields(
        { ...original, amount: 100, model: "", date: "2026-10-20" },
        original,
      ),
    ).toEqual({ amount: 100, model: "", item_date: "2026-10-20" });
    expect(changedFields({ ...original, name: " 測試 " }, original)).toEqual(
      {},
    );
    expect(() => changedFields({ ...original, id: "two" }, original)).toThrow();
  });
  it("updates via delta then reads the requested authoritative item", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ ...row, amount: 100 });
    const repository = cloudRepository(createSheetsItemsApi({ request }));
    const original = fromSheets(row);
    const result = await repository.update(
      { ...original, amount: 100 },
      original,
    );
    expect(request.mock.calls).toEqual([
      ["updateItem", { item_id: "one", changes: { amount: 100 } }],
      ["getItem", { item_id: "one" }],
    ]);
    expect(result.item?.amount).toBe(100);
  });
  it("uses returned create ID and never generates a local substitute", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ item_id: "server-id" })
      .mockResolvedValueOnce({ ...row, item_id: "server-id" });
    const repository = cloudRepository(createSheetsItemsApi({ request }));
    const result = await repository.create({
      ...fromSheets(row),
      id: "must-not-send-this",
    });
    expect(result.id).toBe("server-id");
    expect(request.mock.calls[0][1]).not.toHaveProperty("id");
    expect(request.mock.calls[0][1]).not.toHaveProperty("history");
    expect(request).toHaveBeenLastCalledWith("getItem", {
      item_id: "server-id",
    });
  });
  it("does not call update for unchanged fields and rejects wrong item ID", async () => {
    const request = vi.fn().mockResolvedValue({ ...row, item_id: "wrong" });
    const repository = cloudRepository(createSheetsItemsApi({ request }));
    const item = fromSheets(row);
    await expect(repository.update(item, item)).rejects.toThrow("item_id 不符");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("getItem", { item_id: "one" });
  });
  it("distinguishes acknowledged write/read failure from rejected write", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("read failed"));
    const repository = cloudRepository(createSheetsItemsApi({ request }));
    const item = fromSheets(row);
    expect(
      await repository.update({ ...item, amount: 999 }, item),
    ).toMatchObject({
      id: "one",
      readError: expect.stringContaining("寫入已確認"),
    });
    request.mockRejectedValueOnce(new Error("write failed"));
    await expect(
      repository.update({ ...item, amount: 99 }, item),
    ).rejects.toThrow("write failed");
  });
  it("blocks unsupported local data writes in cloud repository", async () => {
    const request = vi.fn();
    const repository = cloudRepository(createSheetsItemsApi({ request }));
    await expect(repository.saveLocal(fromSheets(row))).rejects.toThrow(
      "尚未支援",
    );
    await expect(repository.complete("one", {} as never)).rejects.toThrow(
      "尚未支援",
    );
    expect(request).not.toHaveBeenCalled();
  });
  it("does not fabricate a created item when backend omits item_id", async () => {
    const request = vi.fn().mockResolvedValue({});
    const repository = cloudRepository(createSheetsItemsApi({ request }));
    await expect(repository.create(fromSheets(row))).rejects.toThrow(
      "缺少 item_id",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
