import { describe, expect, it, vi } from "vitest";
import {
  createSheetsItemsApi,
  parseItem,
  parseItems,
} from "../src/api/sheetsItems";
const item = {
  item_id: "test-id",
  name: "測試設備",
  category: "家電設備",
  item_date: "2026-10-21",
  amount: 12800,
  brand: "測試品牌",
  model: "TEST-30",
  location: "測試地點",
  warranty_date: "2029-10-21",
  status: "active",
  created_at: "2026-10-21 21:55:53",
  updated_at: "2026-10-21 21:55:53",
};
const fields = {
  name: item.name,
  category: item.category,
  item_date: item.item_date,
  amount: item.amount,
  brand: item.brand,
  model: item.model,
  location: item.location,
  warranty_date: item.warranty_date,
};
describe("deployed Items contract", () => {
  it("parses arrays, archive state, optional empty warranty, numeric amount", () => {
    expect(parseItems([item])).toEqual([item]);
    expect(
      parseItem({ ...item, warranty_date: "", status: "archived" }).status,
    ).toBe("archived");
    expect(parseItems([])).toEqual([]);
  });
  it("rejects wrappers, malformed rows and duplicate IDs rather than returning empty data", () => {
    for (const rows of [
      { items: [item] },
      null,
      [{ ...item, item_date: "invalid" }],
      [{ ...item, amount: "12800" }],
      [{ ...item, status: "unknown" }],
      [item, item],
    ])
      expect(() => parseItems(rows)).toThrow();
  });
  it("sends action aliases, exact payloads, and excludes local Mock fields", async () => {
    const request = vi.fn().mockResolvedValue(item);
    const api = createSheetsItemsApi({ request });
    request.mockResolvedValueOnce([item]);
    expect(await api.list()).toEqual([item]);
    expect(request).toHaveBeenLastCalledWith("getItems");
    expect(await api.get("test-id")).toEqual(item);
    expect(request).toHaveBeenLastCalledWith("getItem", { item_id: "test-id" });
    await api.create({
      ...fields,
      history: ["private local data"],
    } as typeof fields);
    expect(request).toHaveBeenLastCalledWith("createItem", fields);
    await api.update("test-id", fields);
    expect(request).toHaveBeenLastCalledWith("updateItem", {
      item_id: "test-id",
      changes: fields,
    });
    await api.archive("test-id");
    expect(request).toHaveBeenLastCalledWith("archiveItem", {
      item_id: "test-id",
    });
    await api.restore("test-id");
    expect(request).toHaveBeenLastCalledWith("restoreItem", {
      item_id: "test-id",
    });
  });
  it("validates write fields before RPC and preserves backend rejection", async () => {
    const request = vi.fn().mockRejectedValue(new Error("後端拒絕"));
    const api = createSheetsItemsApi({ request });
    expect(() => api.create({ ...fields, amount: -1 })).toThrow();
    expect(request).not.toHaveBeenCalled();
    await expect(api.archive("test-id")).rejects.toThrow("後端拒絕");
  });
});
