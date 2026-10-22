// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ItemsStore } from "../src/api/itemsStore";
import { AppsScriptBridge } from "../src/api/appsScriptBridge";
import { connectionSettings } from "../src/api/connectionSettings";
import { STORAGE_KEY } from "../src/api/mockApi";
import { sampleItem, samplePlan, TEST_WEB_APP } from "./fixtures/googleBridge";
let store: ItemsStore;
let rows = [structuredClone(samplePlan)];
let failRead = false,
  failWrite = false;
beforeEach(async () => {
  rows = [structuredClone(samplePlan)];
  failRead = false;
  failWrite = false;
  localStorage.clear();
  connectionSettings.save(TEST_WEB_APP);
  vi.spyOn(AppsScriptBridge.prototype, "connect").mockResolvedValue();
  vi.spyOn(AppsScriptBridge.prototype, "request").mockImplementation(
    async (action, raw) => {
      const payload = raw as Record<string, unknown>;
      if (action === "getItems") return [sampleItem];
      if (action === "getItem")
        return { ...sampleItem, item_id: payload.item_id };
      if (action === "getMaintenancePlans") {
        if (failRead) throw new Error("read failed");
        return rows.filter((row) => row.item_id === payload.item_id);
      }
      if (action === "getMaintenancePlan")
        return rows.find((row) => row.plan_id === payload.plan_id) ?? null;
      if (failWrite) throw new Error("write failed");
      if (action === "createMaintenancePlan") {
        rows.push({
          ...samplePlan,
          ...payload,
          plan_id: "new-plan",
          next_due_date: "2029-12-31",
        });
        return { success: true, plan_id: "new-plan", item_id: payload.item_id };
      }
      const plan = rows.find((row) => row.plan_id === payload.plan_id)!;
      if (action === "updateMaintenancePlan")
        Object.assign(plan, payload.changes, { next_due_date: "2028-02-29" });
      if (action === "disableMaintenancePlan") plan.enabled = false;
      if (action === "enableMaintenancePlan") plan.enabled = true;
      return {
        success: true,
        plan_id: plan.plan_id,
        enabled: plan.enabled,
        plan,
      };
    },
  );
  store = new ItemsStore(() => document.createElement("div"));
  await store.start();
  await store.openItem(sampleItem.item_id);
  await store.loadPlans(sampleItem.item_id);
});
afterEach(() => {
  store.dispose();
  vi.restoreAllMocks();
});
it("loads and creates plans through cloud readback without Mock copies", async () => {
  expect(store.getSnapshot().plans.rows).toEqual([samplePlan]);
  await store.savePlan(sampleItem.item_id, { ...samplePlan, name: "new" });
  expect(store.getSnapshot().plans.rows[1]).toMatchObject({
    plan_id: "new-plan",
    next_due_date: "2029-12-31",
  });
  expect(AppsScriptBridge.prototype.request).toHaveBeenLastCalledWith(
    "getMaintenancePlans",
    { item_id: sampleItem.item_id },
  );
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});
it("updates interval, disables and enables using reread backend values", async () => {
  await store.savePlan(
    sampleItem.item_id,
    { ...samplePlan, interval_value: 10 },
    samplePlan,
  );
  expect(store.getSnapshot().plans.rows[0]).toMatchObject({
    interval_value: 10,
    next_due_date: "2028-02-29",
  });
  for (const enabled of [false, true]) {
    await store.setPlanEnabled(sampleItem.item_id, samplePlan.plan_id, enabled);
    expect(store.getSnapshot().plans.rows[0].enabled).toBe(enabled);
    expect(AppsScriptBridge.prototype.request).toHaveBeenLastCalledWith(
      "getMaintenancePlans",
      { item_id: sampleItem.item_id },
    );
  }
});
it("failed reads preserve rows, block writes and recover explicitly", async () => {
  failRead = true;
  await store.loadPlans(sampleItem.item_id);
  expect(store.getSnapshot().plans).toMatchObject({
    status: "error",
    error: "read failed",
    rows: [samplePlan],
    notice: "",
  });
  await expect(store.savePlan(sampleItem.item_id, samplePlan)).rejects.toThrow(
    "尚未就緒",
  );
  failRead = false;
  await store.loadPlans(sampleItem.item_id);
  expect(store.getSnapshot().plans.status).toBe("ready");
});
it("failed writes do not announce success or overwrite existing plans", async () => {
  failWrite = true;
  await expect(store.savePlan(sampleItem.item_id, samplePlan)).rejects.toThrow(
    "write failed",
  );
  expect(store.getSnapshot().plans).toMatchObject({
    status: "error",
    error: "write failed",
    notice: "",
    rows: [samplePlan],
  });
  expect(store.getSnapshot().busy).toBe(false);
});
it("acknowledged writes with failed readback resolve without enabling duplicate submission", async () => {
  failRead = true;
  await expect(
    store.savePlan(sampleItem.item_id, samplePlan),
  ).resolves.toBeUndefined();
  expect(store.getSnapshot().plans.error).toContain("寫入已確認");
  expect(store.getSnapshot().plans.notice).toBe("");
  await expect(store.savePlan(sampleItem.item_id, samplePlan)).rejects.toThrow(
    "尚未就緒",
  );
  expect(rows).toHaveLength(2);
});
it("late responses cannot overwrite another item", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(AppsScriptBridge.prototype.request).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = store.loadPlans(sampleItem.item_id);
  await store.openItem("other");
  await store.loadPlans("other");
  finish([samplePlan]);
  await pending;
  expect(store.getSnapshot().plans).toMatchObject({
    itemId: "other",
    rows: [],
    status: "ready",
  });
});
it("source switch ignores pending cloud plans and preserves local records", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(AppsScriptBridge.prototype.request).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = store.loadPlans(sampleItem.item_id);
  await store.useMock();
  finish([samplePlan]);
  await pending;
  expect(store.getSnapshot().plans.rows).toEqual([]);
  expect(store.getSnapshot().items[0].tasks.length).toBeGreaterThan(0);
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  await expect(store.savePlan(sampleItem.item_id, samplePlan)).rejects.toThrow(
    "尚未就緒",
  );
});
it("blocks duplicate submissions while a cloud mutation is pending", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(AppsScriptBridge.prototype.request).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = store.savePlan(sampleItem.item_id, samplePlan);
  await expect(store.savePlan(sampleItem.item_id, samplePlan)).rejects.toThrow(
    "尚未就緒",
  );
  finish({ success: true, plan_id: "new", item_id: sampleItem.item_id });
  await pending;
  expect(store.getSnapshot().busy).toBe(false);
});
