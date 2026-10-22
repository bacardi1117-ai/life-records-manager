// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ItemsStore } from "../src/api/itemsStore";
import { AppsScriptBridge } from "../src/api/appsScriptBridge";
import { connectionSettings } from "../src/api/connectionSettings";
import {
  sampleItem,
  samplePlan,
  sampleRecord,
  TEST_WEB_APP,
} from "./fixtures/googleBridge";
import type { CloudMaintenanceRecord } from "../src/api/maintenanceRecords";
let store: ItemsStore;
let plans = [structuredClone(samplePlan)];
let records: CloudMaintenanceRecord[] = [];
let failWrite = false,
  failGet = false,
  writeAfterCommitError = false;
let creations: string[] = [];
beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  connectionSettings.save(TEST_WEB_APP);
  plans = [structuredClone(samplePlan)];
  records = [];
  creations = [];
  failWrite = false;
  failGet = false;
  writeAfterCommitError = false;
  vi.spyOn(AppsScriptBridge.prototype, "connect").mockResolvedValue();
  vi.spyOn(AppsScriptBridge.prototype, "request").mockImplementation(
    async (action, raw) => {
      const payload = raw as Record<string, any>;
      if (action === "getItems") return [sampleItem];
      if (action === "getItem") return sampleItem;
      if (action === "getMaintenancePlans")
        return plans.filter((p) => p.item_id === payload.item_id);
      if (action === "getMaintenancePlan")
        return plans.find((p) => p.plan_id === payload.plan_id) ?? null;
      if (action === "getMaintenanceRecordsByItem")
        return records.filter((r) => r.item_id === payload.item_id);
      if (action === "getMaintenanceRecords")
        return records.filter((r) => r.plan_id === payload.plan_id);
      if (action === "getMaintenanceRecord") {
        if (failGet) throw new Error("query failed");
        return records.find((r) => r.record_id === payload.record_id) ?? null;
      }
      if (action === "createMaintenanceRecord") {
        creations.push(payload.record_id);
        if (failWrite) throw new Error("write failed");
        let record = records.find((r) => r.record_id === payload.record_id);
        const duplicate = Boolean(record);
        if (!record) {
          record = { ...sampleRecord, ...payload, item_id: samplePlan.item_id };
          records.push(record);
          plans[0] = {
            ...plans[0],
            last_completed_date: record.completed_date,
            next_due_date: "2030-01-31",
          };
        }
        if (writeAfterCommitError) throw new Error("請求逾時");
        return {
          success: true,
          duplicate,
          record_id: record.record_id,
          record,
        };
      }
      throw new Error(`unexpected ${action}`);
    },
  );
  store = new ItemsStore(() => document.createElement("div"), {
    calendarSyncStatusApiEnabled: false,
  });
  await store.start();
  await store.openItem(sampleItem.item_id);
  await store.loadPlans(sampleItem.item_id);
  await store.loadRecords(sampleItem.item_id);
});
afterEach(() => {
  store.dispose();
  vi.restoreAllMocks();
});
it("creates once and rereads backend plan dates, records and costs", async () => {
  const draft = {
    ...store.openCompletionDraft(sampleItem.item_id, samplePlan),
    amount: 235,
    title: "已檢查",
  };
  store.saveCompletionDraft(draft);
  await store.submitCompletion(draft);
  expect(creations).toEqual([draft.record_id]);
  expect(store.getSnapshot().plans.rows[0]).toMatchObject({
    last_completed_date: draft.completed_date,
    next_due_date: "2030-01-31",
  });
  expect(store.getSnapshot().records).toMatchObject({
    status: "ready",
    rows: [{ amount: 235 }],
    notice: expect.stringContaining("已儲存"),
  });
  expect(
    store.getCompletionDraft(sampleItem.item_id, samplePlan.plan_id),
  ).toBeNull();
  expect(localStorage.getItem("life-records-manager:v1")).toBeNull();
});
it("a duplicate acknowledgement is success with no second row", async () => {
  const draft = store.openCompletionDraft(sampleItem.item_id, samplePlan);
  records.push({ ...sampleRecord, ...draft });
  await store.submitCompletion(draft);
  expect(records).toHaveLength(1);
  expect(store.getSnapshot().records.notice).toContain("已存在");
});
it("lost response checks original ID and succeeds without another create", async () => {
  const draft = store.openCompletionDraft(sampleItem.item_id, samplePlan);
  writeAfterCommitError = true;
  await store.submitCompletion(draft);
  expect(creations).toEqual([draft.record_id]);
  expect(store.getSnapshot().records.rows).toHaveLength(1);
});
it("failed write keeps its draft and reuses the same ID on an explicit retry", async () => {
  const draft = store.openCompletionDraft(sampleItem.item_id, samplePlan);
  failWrite = true;
  await expect(store.submitCompletion(draft)).rejects.toThrow("同一草稿重試");
  expect(
    store.getCompletionDraft(sampleItem.item_id, samplePlan.plan_id),
  ).toMatchObject({ record_id: draft.record_id, phase: "editing" });
  failWrite = false;
  await store.submitCompletion(draft);
  expect(creations).toEqual([draft.record_id, draft.record_id]);
  expect(records).toHaveLength(1);
});
it("uncertain lookup blocks resubmission until the original ID is checked", async () => {
  const draft = store.openCompletionDraft(sampleItem.item_id, samplePlan);
  failWrite = true;
  failGet = true;
  await expect(store.submitCompletion(draft)).rejects.toThrow("未確認");
  expect(
    store.getCompletionDraft(sampleItem.item_id, samplePlan.plan_id)?.phase,
  ).toBe("uncertain");
  await expect(store.submitCompletion(draft)).rejects.toThrow("識別碼不符");
  failGet = false;
  expect(await store.checkCompletion(draft)).toBe(false);
  expect(
    store.getCompletionDraft(sampleItem.item_id, samplePlan.plan_id)?.phase,
  ).toBe("editing");
  expect(creations).toHaveLength(1);
});
it("content conflict stops retry, and disabled plans never create a record", async () => {
  const draft = store.openCompletionDraft(sampleItem.item_id, samplePlan);
  records.push({ ...sampleRecord, ...draft, amount: draft.amount + 1 });
  await expect(store.submitCompletion(draft)).rejects.toThrow("衝突");
  expect(
    store.getCompletionDraft(sampleItem.item_id, samplePlan.plan_id)?.phase,
  ).toBe("conflict");
  expect(creations).toHaveLength(1);
  records = [];
  const second = store.openCompletionDraft(sampleItem.item_id, {
    ...samplePlan,
    plan_id: "other",
    enabled: false,
  });
  plans.push({ ...samplePlan, plan_id: "other", enabled: false });
  await expect(store.submitCompletion(second)).rejects.toThrow("已停用");
  expect(creations).toHaveLength(1);
});
