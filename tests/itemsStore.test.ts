// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppsScriptBridge } from "../src/api/appsScriptBridge";
import { ItemsStore } from "../src/api/itemsStore";
import { connectionSettings, MODE_KEY } from "../src/api/connectionSettings";
import { mockApi, STORAGE_KEY } from "../src/api/mockApi";
import { fromSheets } from "../src/api/itemsRepository";
import type { SheetsItem } from "../src/api/sheetsItems";
const url = new URL(
  "/macros/s/TEST_ONLY_NOT_DEPLOYED/exec",
  "https://script.google.com",
).href;
const row: SheetsItem = {
  item_id: "one",
  name: "測試事項",
  category: "家電設備",
  item_date: "2026-10-21",
  amount: 100,
  brand: "",
  model: "",
  location: "",
  warranty_date: "",
  status: "active",
  created_at: "",
  updated_at: "",
};
let store: ItemsStore;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(AppsScriptBridge.prototype, "connect").mockResolvedValue();
  store = new ItemsStore(() => document.createElement("div"));
});
afterEach(() => {
  store.dispose();
  vi.restoreAllMocks();
});
it("prefers legacy saved cloud URL, never touches Mock, and persists mode", async () => {
  connectionSettings.save(url);
  localStorage.setItem(STORAGE_KEY, "preserve");
  const local = vi.spyOn(mockApi, "list");
  vi.spyOn(AppsScriptBridge.prototype, "request").mockResolvedValue([row]);
  await store.start();
  expect(store.getSnapshot()).toMatchObject({
    mode: "cloud",
    status: "ready",
    items: [fromSheets(row)],
  });
  expect(localStorage.getItem(MODE_KEY)).toBe("cloud");
  expect(local).not.toHaveBeenCalled();
  expect(localStorage.getItem(STORAGE_KEY)).toBe("preserve");
});
it("respects explicit Mock selection even with valid saved cloud URL", async () => {
  connectionSettings.save(url);
  connectionSettings.saveMode("mock");
  const request = vi.spyOn(AppsScriptBridge.prototype, "request");
  await store.start();
  expect(store.getSnapshot().mode).toBe("mock");
  expect(store.getSnapshot().items[0].name).toBe("電熱水器");
  expect(request).not.toHaveBeenCalled();
});
it("does not fall back to Mock or allow writes after cloud connection failure", async () => {
  connectionSettings.save(url);
  const local = vi.spyOn(mockApi, "list");
  vi.spyOn(AppsScriptBridge.prototype, "connect").mockRejectedValue(
    new Error("login blocked"),
  );
  await store.start();
  expect(store.getSnapshot()).toMatchObject({
    mode: "cloud",
    status: "error",
    notice: "",
    items: [],
  });
  expect(local).not.toHaveBeenCalled();
  await expect(store.create(fromSheets(row))).rejects.toThrow("尚未就緒");
});
it("late detail responses cannot replace the currently selected item", async () => {
  connectionSettings.save(url);
  const other = { ...row, item_id: "two" };
  let finish!: (result: unknown) => void;
  vi.spyOn(AppsScriptBridge.prototype, "request").mockImplementation(
    async (action, payload) => {
      if (action === "getItems") return [row, other];
      if ((payload as { item_id: string }).item_id === "one")
        return new Promise((resolve) => {
          finish = resolve;
        });
      return other;
    },
  );
  await store.start();
  const first = store.openItem("one");
  await store.openItem("two");
  finish(row);
  await first;
  expect(store.getSnapshot().selected?.id).toBe("two");
});
it("a failed write preserves state and has no success notice", async () => {
  connectionSettings.save(url);
  vi.spyOn(AppsScriptBridge.prototype, "request").mockImplementation(
    async (action) => {
      if (action === "getItems") return [row];
      if (action === "getItem") return row;
      throw new Error("denied");
    },
  );
  await store.start();
  await store.openItem("one");
  await expect(
    store.update({ ...fromSheets(row), amount: 500 }, fromSheets(row)),
  ).rejects.toThrow("denied");
  expect(store.getSnapshot()).toMatchObject({
    selected: { amount: 100 },
    items: [{ amount: 100 }],
    notice: "",
    error: "denied",
    stale: true,
  });
});
it("mode changes invalidate an in-flight cloud read without overwriting local records", async () => {
  let finish!: (result: unknown) => void;
  vi.spyOn(AppsScriptBridge.prototype, "request").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = store.connect(url);
  await Promise.resolve();
  await store.useMock();
  finish([row]);
  await pending;
  expect(store.getSnapshot().mode).toBe("mock");
  expect(store.getSnapshot().items[0].id).toBe("water-heater");
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});

it("removing a cloud URL while using Mock leaves Mock writable and its data intact", async () => {
  connectionSettings.save(url);
  connectionSettings.saveMode("mock");
  await store.start();
  const before = store.getSnapshot().items;
  store.disconnect(true);
  expect(store.getSnapshot()).toMatchObject({
    mode: "mock",
    status: "ready",
    items: before,
    url: "",
  });
  const item = before[0];
  await store.update({ ...item, amount: 99 }, item);
  expect(store.getSnapshot().items[0].amount).toBe(99);
});

it("a failed detail read also blocks cloud writes until a successful refresh", async () => {
  connectionSettings.save(url);
  vi.spyOn(AppsScriptBridge.prototype, "request").mockImplementation(
    async (action) => {
      if (action === "getItems") return [row];
      throw new Error("connection lost");
    },
  );
  await store.start();
  await store.openItem("one");
  expect(store.getSnapshot()).toMatchObject({
    mode: "cloud",
    stale: true,
    detailState: "error",
  });
  await expect(store.create(fromSheets(row))).rejects.toThrow("尚未就緒");
  store.closeItem();
  await store.refresh();
  expect(store.getSnapshot().stale).toBe(false);
});
