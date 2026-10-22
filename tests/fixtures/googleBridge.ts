import type { MaintenancePlan } from "../../src/api/maintenancePlans";
import type { CloudMaintenanceRecord } from "../../src/api/maintenanceRecords";
import type { Page } from "@playwright/test";
// Synthetic deployment; every request is fulfilled by Playwright, never Google.
export const TEST_WEB_APP = new URL(
  "/macros/s/TEST_ONLY_NOT_DEPLOYED/exec",
  "https://script.google.com",
).href;
const FRAME_ORIGIN = "https://test-script.googleusercontent.com";
export const sampleItem = {
  item_id: "test-cloud-item",
  name: "雲端測試設備",
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
export const samplePlan: MaintenancePlan = {
  plan_id: "plan-one",
  item_id: "test-cloud-item",
  name: "雲端安全檢查",
  interval_value: 6,
  interval_unit: "month",
  calculation_mode: "fixed",
  base_date: "2026-10-21",
  last_completed_date: "",
  next_due_date: "2027-04-21",
  reminder_days: 7,
  enabled: true,
  created_at: "2026-10-21 21:55:53",
  updated_at: "2026-10-21 21:55:53",
};
export const sampleRecord: CloudMaintenanceRecord = {
  record_id: "existing-record",
  plan_id: "plan-one",
  item_id: "test-cloud-item",
  title: "既有安全檢查",
  completed_date: "2026-10-21",
  amount: 350,
  vendor: "測試廠商",
  description: "既有紀錄",
  created_at: "2026-10-21 21:55:53",
  updated_at: "2026-10-21 21:55:53",
};
export async function mockGoogleBridge(page: Page) {
  const state = {
    rows: [structuredClone(sampleItem)],
    plans: [structuredClone(samplePlan)],
    records: [] as CloudMaintenanceRecord[],
    failRecordWrites: false,
    failRecordReads: false,
    failRecordGet: false,
    loseRecordResponse: false,
    recordWriteDelay: 0,
    recordDelayByItem: {} as Record<string, number>,
    failPlanReads: false,
    failPlanWrites: false,
    failPlanReadback: false,
    losePlanResponse: false,
    planDelay: {} as Record<string, number>,
    planWriteDelay: 0,
    calls: [] as { action: string; payload: Record<string, unknown> }[],
    failReads: false,
    malformed: false,
    ready: true,
    loseWriteResponse: false,
    failWrites: false,
    failGet: false,
    omitCreateId: false,
    getDelay: {} as Record<string, number>,
  };
  await page.route("https://script.google.com/**", async (route) => {
    const token = new URL(route.request().url()).searchParams.get("token");
    await route.fulfill({
      contentType: "text/html",
      body: state.ready
        ? `<iframe src="${FRAME_ORIGIN}/bridge?token=${token}"></iframe>`
        : "<p>Simulated login restriction</p>",
    });
  });
  await page.route(`${FRAME_ORIGIN}/bridge?*`, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><script>
    const token = new URL(location.href).searchParams.get('token');
    const channel = 'life-records-v1';
    const parentOrigin = 'http://127.0.0.1:4173';
    window.addEventListener('message', async event => {
      const data = event.data;
      if (event.source !== window.top || event.origin !== parentOrigin || data.channel !== channel || data.token !== token || data.type !== 'request') return;
      const response = await fetch('/rpc', { method: 'POST', body: JSON.stringify(data) }).then(r => r.json());
      if (response.ignore) return;
      window.top.postMessage({ channel, token, type: 'response', id: data.id, ...response }, parentOrigin);
    });
    window.top.postMessage({ channel, token, type: 'ready' }, parentOrigin);
    </script>`,
    });
  });
  await page.route(`${FRAME_ORIGIN}/rpc`, async (route) => {
    const data = route.request().postDataJSON();
    state.calls.push(data);
    let result: unknown;
    let error = "";
    const index = state.rows.findIndex(
      (row) => row.item_id === data.payload.item_id,
    );
    if (
      state.failWrites &&
      ["createItem", "updateItem", "archiveItem", "restoreItem"].includes(
        data.action,
      )
    ) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "模擬雲端寫入失敗" }),
      });
      return;
    }
    if (data.action === "getItem" && state.getDelay[data.payload.item_id])
      await new Promise((resolve) =>
        setTimeout(resolve, state.getDelay[data.payload.item_id]),
      );
    const planIndex = state.plans.findIndex(
      (plan) => plan.plan_id === data.payload.plan_id,
    );
    const recordIndex = state.records.findIndex(
      (record) => record.record_id === data.payload.record_id,
    );
    if (data.action === "createMaintenanceRecord" && state.recordWriteDelay)
      await new Promise((resolve) =>
        setTimeout(resolve, state.recordWriteDelay),
      );
    if (data.action === "createMaintenanceRecord" && state.failRecordWrites) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "模擬完成紀錄寫入失敗" }),
      });
      return;
    }
    if (
      data.action === "getMaintenanceRecordsByItem" &&
      state.recordDelayByItem[data.payload.item_id]
    )
      await new Promise((resolve) =>
        setTimeout(resolve, state.recordDelayByItem[data.payload.item_id]),
      );
    const planWrite = [
      "createMaintenancePlan",
      "updateMaintenancePlan",
      "disableMaintenancePlan",
      "enableMaintenancePlan",
    ].includes(data.action);
    if (planWrite && state.planWriteDelay)
      await new Promise((resolve) => setTimeout(resolve, state.planWriteDelay));
    if (planWrite && state.failPlanWrites) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "模擬保養寫入失敗" }),
      });
      return;
    }
    if (
      data.action === "getMaintenancePlans" &&
      state.planDelay[data.payload.item_id]
    )
      await new Promise((resolve) =>
        setTimeout(resolve, state.planDelay[data.payload.item_id]),
      );
    switch (data.action) {
      case "getMaintenanceRecordsByItem":
        if (state.failRecordReads) error = "模擬完成紀錄讀取失敗";
        else
          result = state.records.filter(
            (record) => record.item_id === data.payload.item_id,
          );
        break;
      case "getMaintenanceRecords":
        if (state.failRecordReads) error = "模擬完成紀錄讀取失敗";
        else
          result = state.records.filter(
            (record) => record.plan_id === data.payload.plan_id,
          );
        break;
      case "getMaintenanceRecord":
        if (state.failRecordGet) error = "模擬單筆完成紀錄讀取失敗";
        else result = state.records[recordIndex] ?? null;
        break;
      case "createMaintenanceRecord": {
        const existing = state.records[recordIndex];
        if (existing) {
          if (
            existing.plan_id !== data.payload.plan_id ||
            existing.completed_date !== data.payload.completed_date ||
            existing.title !== data.payload.title ||
            existing.amount !== data.payload.amount ||
            existing.vendor !== data.payload.vendor ||
            existing.description !== data.payload.description
          )
            error = "完成紀錄內容衝突";
          else
            result = {
              success: true,
              duplicate: true,
              record_id: existing.record_id,
              plan_id: existing.plan_id,
              item_id: existing.item_id,
              completed_date: existing.completed_date,
              record: existing,
            };
        } else if (planIndex < 0 || !state.plans[planIndex].enabled)
          error = "保養計畫已停用";
        else {
          const record: CloudMaintenanceRecord = {
            ...sampleRecord,
            ...data.payload,
            item_id: state.plans[planIndex].item_id,
          };
          state.records.push(record);
          state.plans[planIndex] = {
            ...state.plans[planIndex],
            last_completed_date: record.completed_date,
            next_due_date: "2028-03-15",
          };
          result = {
            success: true,
            duplicate: false,
            record_id: record.record_id,
            plan_id: record.plan_id,
            item_id: record.item_id,
            completed_date: record.completed_date,
            next_due_date: state.plans[planIndex].next_due_date,
            record,
          };
        }
        break;
      }
      case "getMaintenancePlans":
        if (state.failPlanReads) error = "模擬保養讀取失敗";
        else
          result = state.plans.filter(
            (plan) => plan.item_id === data.payload.item_id,
          );
        break;
      case "getMaintenancePlan":
        result = state.plans[planIndex] ?? null;
        break;
      case "createMaintenancePlan": {
        const plan = {
          ...samplePlan,
          ...data.payload,
          plan_id: `created-plan-${state.plans.length}`,
          next_due_date: "2027-12-31",
        };
        state.plans.push(plan);
        result = {
          success: true,
          plan_id: plan.plan_id,
          item_id: plan.item_id,
          name: plan.name,
          next_due_date: plan.next_due_date,
        };
        break;
      }
      case "updateMaintenancePlan":
        if (planIndex < 0) error = "找不到計畫";
        else {
          state.plans[planIndex] = {
            ...state.plans[planIndex],
            ...data.payload.changes,
            next_due_date: "2028-02-29",
          };
          result = {
            success: true,
            message: "updated",
            plan: state.plans[planIndex],
          };
        }
        break;
      case "disableMaintenancePlan":
      case "enableMaintenancePlan":
        if (planIndex < 0) error = "找不到計畫";
        else {
          const plan = state.plans[planIndex];
          plan.enabled = data.action === "enableMaintenancePlan";
          result = {
            success: true,
            plan_id: plan.plan_id,
            enabled: plan.enabled,
            message: "updated",
          };
        }
        break;
      case "getItems":
        if (state.failReads) error = "模擬後端讀取失敗";
        else result = state.malformed ? { items: state.rows } : state.rows;
        break;
      case "getItem":
        if (state.failGet) error = "模擬單筆讀取失敗";
        else if (index < 0) error = "找不到事項";
        else result = state.rows[index];
        break;
      case "createItem":
        state.rows.push({
          ...sampleItem,
          ...data.payload,
          item_id: "new-cloud-item",
        });
        result = state.omitCreateId
          ? {}
          : { item_id: state.rows.at(-1)!.item_id };
        break;
      case "updateItem":
        if (index < 0) error = "找不到事項";
        else {
          state.rows[index] = { ...state.rows[index], ...data.payload.changes };
          result = state.rows[index];
        }
        break;
      case "archiveItem":
        if (index < 0) error = "找不到事項";
        else {
          state.rows[index].status = "archived";
          result = state.rows[index];
        }
        break;
      case "restoreItem":
        if (index < 0) error = "找不到事項";
        else {
          state.rows[index].status = "active";
          result = state.rows[index];
        }
        break;
      default:
        error = "Unknown test action";
    }
    if (planWrite && state.failPlanReadback) state.failPlanReads = true;
    const ignore =
      (state.loseWriteResponse && data.action === "createItem") ||
      (planWrite && state.losePlanResponse) ||
      (data.action === "createMaintenanceRecord" && state.loseRecordResponse);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        ignore
          ? { ignore: true }
          : error
            ? { ok: false, error }
            : { ok: true, result },
      ),
    });
  });
  return state;
}
