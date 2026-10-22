import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  mockGoogleBridge,
  sampleItem,
  samplePlan,
  TEST_WEB_APP,
} from "../fixtures/googleBridge";

const enabled = process.env.CALENDAR_SYNC_E2E_ENABLED !== "false";
async function open(page: Page) {
  await page.goto("./#/settings");
  await page.getByLabel("Web App /exec URL").fill(TEST_WEB_APP);
  await page.getByRole("button", { name: "連線並使用 Google Sheets" }).click();
  await expect(
    page.getByText("Google Sheets 雲端模式 · 已連線", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "返回生活事項首頁" }).click();
  await page.locator(".item-card").filter({ hasText: sampleItem.name }).click();
}
const card = (page: Page, name = samplePlan.name) =>
  page.getByRole("region", { name: `${name} Google Calendar 提醒` });
const status = (page: Page, name = samplePlan.name) =>
  card(page, name).locator("dd").nth(2);
const synced = (planId = samplePlan.plan_id) => ({
  plan_id: planId,
  sync_status: "synced",
  last_synced_at: "2026-10-22T04:00:00Z",
  error_message: "",
  has_event: true,
});

test.describe("CalendarSync opt-out", () => {
  test.skip(enabled, "opt-out build only");
  test("shows not connected and never sends the unknown action", async ({
    page,
  }) => {
    const backend = await mockGoogleBridge(page);
    await open(page);
    await expect(status(page)).toHaveText("同步狀態尚未連接");
    await expect(card(page)).toContainText("每 15 分鐘定期檢查");
    expect(
      backend.calls.filter((call) => call.action === "getCalendarSyncStatus"),
    ).toHaveLength(0);
  });
});

test.describe("CalendarSync read-only API simulation", () => {
  test.skip(!enabled, "requires the enabled build");

  test("maps synced, unsynced, disabled and error states without exposing IDs", async ({
    page,
  }) => {
    const backend = await mockGoogleBridge(page);
    backend.calendarStatuses[samplePlan.plan_id] = synced();
    await open(page);
    await expect(status(page)).toHaveText("Google Calendar 已同步紀錄");
    await expect(card(page)).toContainText("2026-10-22T04:00:00Z");
    await expect(card(page)).not.toContainText("TEST_ONLY_NOT_REAL");
    backend.calendarStatuses[samplePlan.plan_id] = {
      ...synced(),
      error_message: "尚有同步錯誤",
    };
    await page.getByRole("button", { name: "重新讀取保養計畫" }).click();
    await expect(status(page)).toHaveText("無法確認");
    await expect(card(page)).toContainText("尚有同步錯誤");
    for (const [syncStatus, expected, errorMessage] of [
      ["not_synced", "尚未同步", ""],
      ["disabled", "提醒已停用", ""],
      ["error", "同步失敗", "模擬同步錯誤"],
    ]) {
      backend.calendarStatuses[samplePlan.plan_id] = {
        ...synced(),
        sync_status: syncStatus,
        error_message: errorMessage,
      };
      await page.getByRole("button", { name: "重新讀取保養計畫" }).click();
      await expect(status(page)).toHaveText(expected);
      if (errorMessage) await expect(card(page)).toContainText(errorMessage);
    }
  });

  test("failed status read never preserves a prior success", async ({
    page,
  }) => {
    const backend = await mockGoogleBridge(page);
    backend.calendarStatuses[samplePlan.plan_id] = synced();
    await open(page);
    await expect(status(page)).toHaveText("Google Calendar 已同步紀錄");
    backend.failCalendarRead = true;
    await page.getByRole("button", { name: "重新讀取保養計畫" }).click();
    await expect(status(page)).toHaveText("同步狀態讀取失敗");
    await expect(card(page)).toContainText("模擬日曆狀態讀取失敗");
    backend.failCalendarRead = false;
    backend.failPlanReads = true;
    await page.getByRole("button", { name: "重新讀取保養計畫" }).click();
    await expect(status(page)).toHaveText("同步狀態讀取失敗");
  });

  test("isolates item and plan IDs, including a late response", async ({
    page,
  }) => {
    const backend = await mockGoogleBridge(page);
    backend.rows.push({
      ...sampleItem,
      item_id: "other-item",
      name: "另一件設備",
    });
    backend.plans.push({
      ...samplePlan,
      item_id: "other-item",
      plan_id: "other-plan",
      name: "另一保養",
    });
    backend.plans.push({
      ...samplePlan,
      plan_id: "second-plan",
      name: "第二保養",
    });
    backend.calendarStatuses[samplePlan.plan_id] = synced();
    backend.calendarStatuses["second-plan"] = {
      ...synced("second-plan"),
      sync_status: "disabled",
    };
    backend.calendarStatuses["other-plan"] = {
      ...synced("other-plan"),
      sync_status: "error",
      error_message: "另一件錯誤",
    };
    backend.calendarDelay[samplePlan.plan_id] = 300;
    await open(page);
    await expect(status(page, "第二保養")).toHaveText("提醒已停用");
    await page.locator(".back-link").click();
    await page.locator(".item-card").filter({ hasText: "另一件設備" }).click();
    await expect(status(page, "另一保養")).toHaveText("同步失敗");
    await page.waitForTimeout(350);
    await expect(card(page, "另一保養")).toContainText("另一件錯誤");
    await expect(card(page, samplePlan.name)).toHaveCount(0);
    expect(
      backend.calls
        .filter((call) => call.action === "getCalendarSyncStatus")
        .map((call) => call.payload.plan_id),
    ).toEqual(
      expect.arrayContaining([samplePlan.plan_id, "second-plan", "other-plan"]),
    );
  });

  test("plan date changes trigger reread and stale event cannot claim success", async ({
    page,
  }) => {
    const backend = await mockGoogleBridge(page);
    backend.calendarStatuses[samplePlan.plan_id] = synced();
    await open(page);
    await expect(status(page)).toHaveText("Google Calendar 已同步紀錄");
    const before = backend.calls.filter(
      (call) => call.action === "getCalendarSyncStatus",
    ).length;
    await page.getByRole("button", { name: `編輯${samplePlan.name}` }).click();
    await page.getByLabel("週期數值", { exact: true }).fill("12");
    await page
      .getByRole("button", { name: "儲存保養計畫", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(status(page)).toHaveText("等待下次同步");
    expect(
      backend.calls.filter((call) => call.action === "getCalendarSyncStatus")
        .length,
    ).toBeGreaterThan(before);
    backend.calendarStatuses[samplePlan.plan_id] = {
      ...synced(),
      last_synced_at: "2026-10-23 12:00:00",
    };
    await page.getByRole("button", { name: "重新讀取保養計畫" }).click();
    await expect(status(page)).toHaveText("Google Calendar 已同步紀錄");
  });

  test("switching to Mock clears calendar status without cloud writes", async ({
    page,
  }) => {
    const backend = await mockGoogleBridge(page);
    backend.calendarStatuses[samplePlan.plan_id] = synced();
    await open(page);
    await expect(status(page)).toHaveText("Google Calendar 已同步紀錄");
    const count = backend.calls.length;
    await page
      .getByRole("link", { name: "連線設定", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "切換為本機 Mock" }).click();
    await page.getByRole("button", { name: "確認切換至 Mock" }).click();
    await expect(page.getByTestId("source-label")).toHaveText("本機 Mock 模式");
    expect(backend.calls.length).toBe(count);
    await page.reload();
    await expect(page.getByTestId("source-label")).toHaveText("本機 Mock 模式");
    await expect(
      page.getByText("Google Calendar 提醒", { exact: true }),
    ).toHaveCount(0);
  });
});
