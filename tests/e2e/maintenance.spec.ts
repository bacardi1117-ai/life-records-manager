import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  mockGoogleBridge,
  sampleItem,
  samplePlan,
  TEST_WEB_APP,
} from "../fixtures/googleBridge";
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
const row = (page: Page, name = samplePlan.name) =>
  page.locator(".cloud-plan").filter({ hasText: name });
const save = (page: Page) =>
  page.getByRole("button", { name: "儲存保養計畫", exact: true });
test("existing tab loads parent plans, creates, edits, disables, enables and survives reload", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await open(page);
  await expect(row(page)).toContainText("每 6 月 · 固定週期");
  await expect(row(page)).toContainText("2027-04-21");
  await expect(
    row(page).getByRole("button", { name: "完成保養", exact: true }),
  ).toBeEnabled();
  expect(
    state.calls.find((call) => call.action === "getMaintenancePlans")?.payload,
  ).toEqual({ item_id: sampleItem.item_id });
  await page.getByRole("button", { name: "新增子項目", exact: true }).click();
  await page.getByLabel("保養名稱", { exact: true }).fill("雲端更換濾芯");
  await page.getByLabel("週期數值", { exact: true }).fill("2");
  await page.getByLabel("週期單位", { exact: true }).selectOption("year");
  await page.getByLabel("計算模式", { exact: true }).selectOption("fixed");
  await page.getByLabel("基準日期", { exact: true }).fill("2026-12-31");
  await page.getByLabel("提前提醒天數", { exact: true }).fill("14");
  state.planWriteDelay = 300;
  await save(page).click();
  await expect(page.getByRole("button", { name: "儲存中…" })).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "雲端更換濾芯")).toContainText("2027-12-31");
  const creation = state.calls.findIndex(
    (call) => call.action === "createMaintenancePlan",
  );
  expect(state.calls[creation].payload).toEqual({
    item_id: sampleItem.item_id,
    name: "雲端更換濾芯",
    interval_value: 2,
    interval_unit: "year",
    calculation_mode: "fixed",
    base_date: "2026-12-31",
    reminder_days: 14,
  });
  expect(state.calls[creation + 1].action).toBe("getMaintenancePlans");
  expect(
    await page.evaluate(() => localStorage.getItem("life-records-manager:v1")),
  ).toBeNull();
  await row(page)
    .getByRole("button", { name: `編輯${samplePlan.name}` })
    .click();
  await page.getByLabel("週期數值", { exact: true }).fill("12");
  await save(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page)).toContainText("每 12 月");
  await expect(row(page)).toContainText("2028-02-29");
  expect(
    state.calls.find((call) => call.action === "updateMaintenancePlan")
      ?.payload,
  ).toEqual({ plan_id: samplePlan.plan_id, changes: { interval_value: 12 } });
  for (const [action, text] of [
    ["停用", "已停用"],
    ["重新啟用", "已啟用"],
  ]) {
    await row(page).getByRole("button", { name: action, exact: true }).click();
    await expect(row(page)).toContainText(text);
    expect(
      state.calls
        .filter((call) => call.action !== "getCalendarSyncStatus")
        .at(-1)?.action,
    ).toBe("getMaintenancePlans");
  }
  const calendarReads = state.calls.filter(
    (call) => call.action === "getCalendarSyncStatus",
  ).length;
  expect(calendarReads).toBeGreaterThanOrEqual(5);
  await page.reload();
  await expect
    .poll(
      () =>
        state.calls.filter((call) => call.action === "getCalendarSyncStatus")
          .length,
    )
    .toBeGreaterThan(calendarReads);
  await expect(row(page)).toContainText("每 12 月");
  await expect(row(page, "雲端更換濾芯")).toContainText("提前 14 天提醒");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("different parents and late plan responses remain isolated", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  state.rows.push({ ...sampleItem, item_id: "other", name: "另一件設備" });
  state.plans.push({
    ...samplePlan,
    item_id: "other",
    plan_id: "other-plan",
    name: "另一件的保養",
  });
  state.planDelay[sampleItem.item_id] = 500;
  await open(page);
  await expect
    .poll(() =>
      state.calls.some((call) => call.action === "getMaintenancePlans"),
    )
    .toBe(true);
  await page.evaluate(() => {
    location.hash = "/items/other";
  });
  await expect(row(page, "另一件的保養")).toBeVisible();
  await page.waitForTimeout(600);
  await expect(row(page)).toHaveCount(0);
  await row(page, "另一件的保養")
    .getByRole("button", { name: "停用", exact: true })
    .click();
  await expect(row(page, "另一件的保養")).toContainText("已停用");
  expect(state.plans[0].enabled).toBe(true);
});
test("failed writes retain draft, block resubmission until read recovery and emit no success", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await open(page);
  await page.getByRole("button", { name: "新增子項目", exact: true }).click();
  await page.getByLabel("保養名稱", { exact: true }).fill("保留的草稿");
  state.failPlanWrites = true;
  await save(page).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "模擬保養寫入失敗",
  );
  await expect(page.getByLabel("保養名稱", { exact: true })).toHaveValue(
    "保留的草稿",
  );
  await expect(save(page)).toBeDisabled();
  await expect(
    page.getByText("保養計畫已儲存至 Google Sheets，並重新讀取。", {
      exact: true,
    }),
  ).toHaveCount(0);
  state.failPlanWrites = false;
  await page.getByRole("button", { name: "重新讀取計畫並保留草稿" }).click();
  await expect(save(page)).toBeEnabled();
  await save(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "保留的草稿")).toBeVisible();
});
test("read failure does not silently show an empty list or switch to Mock", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  state.failPlanReads = true;
  await open(page);
  await expect(page.getByRole("alert")).toContainText("模擬保養讀取失敗");
  await expect(
    page.getByRole("button", { name: "新增子項目", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("還沒有定期子項目，新增一個保養計畫吧。", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("source-label")).toHaveText(
    "Google Sheets 雲端模式",
  );
  state.failPlanReads = false;
  await page
    .getByRole("button", { name: "重新讀取保養計畫", exact: true })
    .click();
  await expect(row(page)).toBeVisible();
});
test("acknowledged creation with failed readback closes form and requires reread", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await open(page);
  await page.getByRole("button", { name: "新增子項目", exact: true }).click();
  await page.getByLabel("保養名稱", { exact: true }).fill("已寫入待確認");
  state.failPlanReadback = true;
  await save(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("寫入已確認");
  await expect(
    page.getByRole("button", { name: "新增子項目", exact: true }),
  ).toBeDisabled();
  state.failPlanReads = false;
  await page
    .getByRole("button", { name: "重新讀取保養計畫", exact: true })
    .click();
  await expect(row(page, "已寫入待確認")).toBeVisible();
  expect(
    state.calls.filter((call) => call.action === "createMaintenancePlan"),
  ).toHaveLength(1);
});
test("lost plan response retains draft without retrying or writing local records", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await page.clock.install();
  await open(page);
  await page.getByRole("button", { name: "新增子項目", exact: true }).click();
  await page.getByLabel("保養名稱", { exact: true }).fill("結果待確認");
  state.losePlanResponse = true;
  await save(page).click();
  await expect
    .poll(
      () =>
        state.calls.filter((call) => call.action === "createMaintenancePlan")
          .length,
    )
    .toBe(1);
  await page.clock.fastForward(21000);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "寫入可能已完成",
  );
  await expect(save(page)).toBeDisabled();
  await expect(page.getByLabel("保養名稱", { exact: true })).toHaveValue(
    "結果待確認",
  );
  expect(
    state.calls.filter((call) => call.action === "createMaintenancePlan"),
  ).toHaveLength(1);
  expect(
    await page.evaluate(() => localStorage.getItem("life-records-manager:v1")),
  ).toBeNull();
});
