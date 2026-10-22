// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ItemsStore } from "../src/api/itemsStore";
import { AppsScriptBridge } from "../src/api/appsScriptBridge";
import { connectionSettings } from "../src/api/connectionSettings";
import { sampleItem, samplePlan, TEST_WEB_APP } from "./fixtures/googleBridge";

const otherItem = { ...sampleItem, item_id: "other-item", name: "另一件" };
const otherPlan = {
  ...samplePlan,
  item_id: "other-item",
  plan_id: "other-plan",
};
let store: ItemsStore;
let plans = [structuredClone(samplePlan), structuredClone(otherPlan)];
let failStatus = false;
let oldStatusResolve: ((value: unknown) => void) | null = null;
const synced = (planId: string) => ({
  plan_id: planId,
  sync_status: "synced",
  last_synced_at: "2026-10-22 12:00:00",
  error_message: "",
  has_event: true,
});

beforeEach(async () => {
  localStorage.clear();
  plans = [structuredClone(samplePlan), structuredClone(otherPlan)];
  failStatus = false;
  oldStatusResolve = null;
  connectionSettings.save(TEST_WEB_APP);
  vi.spyOn(AppsScriptBridge.prototype, "connect").mockResolvedValue();
  vi.spyOn(AppsScriptBridge.prototype, "request").mockImplementation(
    async (action, raw) => {
      const payload = raw as Record<string, unknown>;
      if (action === "getItems") return [sampleItem, otherItem];
      if (action === "getItem")
        return [sampleItem, otherItem].find(
          (item) => item.item_id === payload.item_id,
        );
      if (action === "getMaintenancePlans")
        return plans.filter((plan) => plan.item_id === payload.item_id);
      if (action === "getMaintenancePlan")
        return plans.find((plan) => plan.plan_id === payload.plan_id);
      if (action === "getCalendarSyncStatus") {
        if (failStatus) throw new Error("status unavailable");
        if (payload.plan_id === samplePlan.plan_id && oldStatusResolve)
          return new Promise((resolve) => (oldStatusResolve = resolve));
        return synced(payload.plan_id as string);
      }
      if (action === "updateMaintenancePlan") {
        const plan = plans.find((row) => row.plan_id === payload.plan_id)!;
        Object.assign(plan, payload.changes, {
          next_due_date: "2028-02-29",
          updated_at: "2026-10-23 00:00:00",
        });
        return { success: true, plan };
      }
      return null;
    },
  );
  store = new ItemsStore(() => document.createElement("div"), {
    calendarSyncStatusApiEnabled: true,
  });
  await store.start();
});
afterEach(() => {
  store.dispose();
  vi.restoreAllMocks();
});

it("loads each plan status through the shared bridge", async () => {
  await store.openItem(sampleItem.item_id);
  await store.loadPlans(sampleItem.item_id);
  await vi.waitFor(() =>
    expect(
      store.getSnapshot().calendarSync.statuses[samplePlan.plan_id],
    ).toMatchObject({ state: "ready", data: synced(samplePlan.plan_id) }),
  );
  expect(AppsScriptBridge.prototype.request).toHaveBeenCalledWith(
    "getCalendarSyncStatus",
    { plan_id: samplePlan.plan_id },
  );
});

it("read failure shows error without a stale successful status", async () => {
  await store.openItem(sampleItem.item_id);
  failStatus = true;
  await store.loadPlans(sampleItem.item_id);
  await vi.waitFor(() =>
    expect(
      store.getSnapshot().calendarSync.statuses[samplePlan.plan_id],
    ).toMatchObject({ state: "error", error: "status unavailable" }),
  );
  expect(
    store.getSnapshot().calendarSync.statuses[samplePlan.plan_id].data,
  ).toBeUndefined();
});

it("rereads status after changing a plan date and discards the old status", async () => {
  await store.openItem(sampleItem.item_id);
  await store.loadPlans(sampleItem.item_id);
  await vi.waitFor(() =>
    expect(
      store.getSnapshot().calendarSync.statuses[samplePlan.plan_id]?.state,
    ).toBe("ready"),
  );
  await store.savePlan(
    sampleItem.item_id,
    { ...samplePlan, interval_value: 10 },
    samplePlan,
  );
  await vi.waitFor(() =>
    expect(
      store.getSnapshot().calendarSync.statuses[samplePlan.plan_id]?.state,
    ).toBe("ready"),
  );
  const calls = vi
    .mocked(AppsScriptBridge.prototype.request)
    .mock.calls.filter(([action]) => action === "getCalendarSyncStatus");
  expect(calls).toHaveLength(2);
  expect(store.getSnapshot().plans.rows[0].next_due_date).toBe("2028-02-29");
});

it("cannot retain a previous item's delayed calendar status", async () => {
  await store.openItem(sampleItem.item_id);
  oldStatusResolve = () => {};
  await store.loadPlans(sampleItem.item_id);
  const finishOld = oldStatusResolve;
  await store.openItem(otherItem.item_id);
  await store.loadPlans(otherItem.item_id);
  await vi.waitFor(() =>
    expect(
      store.getSnapshot().calendarSync.statuses[otherPlan.plan_id]?.state,
    ).toBe("ready"),
  );
  finishOld?.(synced(samplePlan.plan_id));
  await Promise.resolve();
  expect(store.getSnapshot().calendarSync.itemId).toBe(otherItem.item_id);
  expect(
    store.getSnapshot().calendarSync.statuses[samplePlan.plan_id],
  ).toBeUndefined();
});
