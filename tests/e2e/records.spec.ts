import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  mockGoogleBridge,
  sampleItem,
  samplePlan,
  sampleRecord,
  TEST_WEB_APP,
} from "../fixtures/googleBridge";
const LOCAL_KEY = "life-records-manager:v1";
const DRAFT_KEY = "life-records-manager:pending-cloud-records:v1";
async function open(page: Page, requireEnabled = true) {
  await page.goto("./#/settings");
  await page.getByLabel("Web App /exec URL").fill(TEST_WEB_APP);
  await page.getByRole("button", { name: "連線並使用 Google Sheets" }).click();
  await expect(
    page.getByText("Google Sheets 雲端模式 · 已連線", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "返回生活事項首頁" }).click();
  await page.locator(".item-card").filter({ hasText: sampleItem.name }).click();
  if (requireEnabled)
    await expect(
      page.getByRole("button", { name: "完成保養", exact: true }),
    ).toBeEnabled();
}
const complete = (page: Page) =>
  page.getByRole("button", { name: "完成保養", exact: true });
const save = (page: Page) =>
  page.getByRole("button", { name: "儲存完成紀錄", exact: true });
async function draftId(page: Page): Promise<string> {
  return page.evaluate(
    (key) =>
      Object.values(JSON.parse(sessionStorage.getItem(key)!))[0]!.record_id,
    DRAFT_KEY,
  );
}
test("complete rereads backend due date and records, updates cost and both histories", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await open(page);
  await complete(page).click();
  await expect(page.getByRole("dialog")).toContainText(samplePlan.name);
  await page.getByLabel("完成日期", { exact: true }).fill("2026-10-22");
  await page.getByLabel("保養標題", { exact: true }).fill("完成冷氣清潔");
  await page.getByLabel("保養費用（NT$）").fill("1350.5");
  await page.getByLabel("施作廠商").fill("師傅甲");
  await page.getByLabel("備註", { exact: true }).fill("清潔濾網");
  const id = await draftId(page);
  state.recordWriteDelay = 300;
  await save(page).click();
  await expect(page.getByRole("button", { name: "儲存中…" })).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".cloud-plan")).toContainText(
    "下次保養 2028-03-15",
  );
  await expect(page.locator(".basic-info")).toContainText("$1,350.5");
  await expect(
    page.getByText("已儲存完成紀錄，並重新讀取保養計畫與歷史。"),
  ).toBeVisible();
  expect(state.plans[0].last_completed_date).toBe("2026-10-22");
  expect(
    state.calls.find((call) => call.action === "createMaintenanceRecord")
      ?.payload,
  ).toEqual({
    record_id: id,
    plan_id: samplePlan.plan_id,
    completed_date: "2026-10-22",
    title: "完成冷氣清潔",
    amount: 1350.5,
    vendor: "師傅甲",
    description: "清潔濾網",
  });
  expect(
    state.calls.filter((call) => call.action === "createMaintenanceRecord"),
  ).toHaveLength(1);
  expect(
    state.calls.filter((call) => call.action === "getMaintenanceRecordsByItem")
      .length,
  ).toBeGreaterThan(1);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), LOCAL_KEY),
  ).toBeNull();
  await page.getByRole("button", { name: "查看紀錄", exact: true }).click();
  await expect(page.locator(".plan-history")).toContainText("完成冷氣清潔");
  expect(
    state.calls.some(
      (call) =>
        call.action === "getMaintenanceRecords" &&
        call.payload.plan_id === samplePlan.plan_id,
    ),
  ).toBe(true);
  await page.getByRole("tab", { name: /歷史紀錄/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText("師傅甲");
  await expect(page.getByRole("tabpanel")).toContainText(
    `保養項目：${samplePlan.name}`,
  );
  await expect(page.getByRole("tabpanel")).toContainText("備註：清潔濾網");
  await page.getByText("查看完整內容").click();
  await expect(page.getByRole("tabpanel")).toContainText("清潔濾網");
  await page.reload();
  await expect(page.locator(".basic-info")).toContainText("$1,350.5");
  await expect(page.locator(".cloud-plan")).toContainText("2028-03-15");
});
test("failed write retains draft and reuses its record ID on manual retry", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await open(page);
  await complete(page).click();
  await page.getByLabel("保養標題", { exact: true }).fill("可重試草稿");
  const id = await draftId(page);
  state.failRecordWrites = true;
  await save(page).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "模擬完成紀錄寫入失敗",
  );
  await expect(page.getByLabel("保養標題", { exact: true })).toHaveValue(
    "可重試草稿",
  );
  expect(await draftId(page)).toBe(id);
  expect(state.records).toHaveLength(0);
  state.failRecordWrites = false;
  await save(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    state.calls
      .filter((call) => call.action === "createMaintenanceRecord")
      .map((call) => call.payload.record_id),
  ).toEqual([id, id]);
  expect(state.records).toHaveLength(1);
});
test("a lost response queries the same ID and never issues a second create", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await page.clock.install();
  await open(page);
  await complete(page).click();
  const id = await draftId(page);
  state.loseRecordResponse = true;
  await save(page).click();
  await expect
    .poll(
      () =>
        state.calls.filter((call) => call.action === "createMaintenanceRecord")
          .length,
    )
    .toBe(1);
  await page.clock.fastForward(21000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    state.calls.some(
      (call) =>
        call.action === "getMaintenanceRecord" && call.payload.record_id === id,
    ),
  ).toBe(true);
  expect(
    state.calls.filter((call) => call.action === "createMaintenanceRecord"),
  ).toHaveLength(1);
  expect(state.records).toHaveLength(1);
});
test("unconfirmed write remains locked across reload until querying original ID", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await page.clock.install();
  await open(page);
  await complete(page).click();
  const id = await draftId(page);
  state.loseRecordResponse = true;
  state.failRecordGet = true;
  await save(page).click();
  await expect
    .poll(
      () =>
        state.calls.filter((call) => call.action === "createMaintenanceRecord")
          .length,
    )
    .toBe(1);
  await page.clock.fastForward(21000);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "寫入結果未確認",
  );
  await expect(save(page)).toBeDisabled();
  await page.reload();
  await complete(page).click();
  expect(await draftId(page)).toBe(id);
  await expect(save(page)).toBeDisabled();
  state.failRecordGet = false;
  await page.getByRole("button", { name: "查詢原紀錄並核對" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.records).toHaveLength(1);
  expect(
    state.calls.filter((call) => call.action === "createMaintenanceRecord"),
  ).toHaveLength(1);
});
test("duplicate response is success, while conflicting content stops retry", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await open(page);
  await complete(page).click();
  const id = await draftId(page);
  const raw = await page.evaluate(
    (key) => Object.values(JSON.parse(sessionStorage.getItem(key)!))[0],
    DRAFT_KEY,
  );
  state.records.push({ ...sampleRecord, ...raw, record_id: id });
  await save(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("此完成紀錄已存在，已重新讀取，沒有重複新增。"),
  ).toBeVisible();
  expect(state.records).toHaveLength(1);
  await complete(page).click();
  const nextId = await draftId(page);
  const nextRaw = await page.evaluate(
    (key) => Object.values(JSON.parse(sessionStorage.getItem(key)!))[0],
    DRAFT_KEY,
  );
  expect(nextId).not.toBe(id);
  state.records.push({
    ...sampleRecord,
    ...nextRaw,
    record_id: nextId,
    amount: 99,
  });
  await save(page).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "衝突",
  );
  await expect(save(page)).toBeDisabled();
  expect(state.records).toHaveLength(2);
});
test("item history is isolated, sorted, and cost never uses Mock records", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  state.rows.push({ ...sampleItem, item_id: "other", name: "另一件設備" });
  state.plans.push({
    ...samplePlan,
    item_id: "other",
    plan_id: "other-plan",
    name: "另一計畫",
  });
  state.records.push({
    ...sampleRecord,
    record_id: "old",
    amount: 50,
    completed_date: "2026-10-20",
  });
  state.records.push({
    ...sampleRecord,
    record_id: "new",
    amount: 200,
    completed_date: "2026-10-22",
  });
  state.records.push({
    ...sampleRecord,
    record_id: "foreign",
    item_id: "other",
    plan_id: "other-plan",
    amount: 999,
  });
  await open(page);
  await expect(page.locator(".basic-info")).toContainText("$250");
  await page.getByRole("tab", { name: /歷史紀錄/ }).click();
  const dates = await page.locator(".cloud-history time").allTextContents();
  expect(dates).toEqual(["2026-10-22", "2026-10-20"]);
  await expect(page.getByRole("tabpanel")).not.toContainText("$999");
  await page.evaluate(() => {
    location.hash = "/items/other";
  });
  await expect(page.locator(".basic-info")).toContainText("$999");
  await expect(page.locator(".basic-info")).not.toContainText("$250");
});
test("disabled plan cannot submit a completion", async ({ page }) => {
  const state = await mockGoogleBridge(page);
  state.plans[0].enabled = false;
  await open(page, false);
  await expect(complete(page)).toBeDisabled();
  expect(
    state.calls.filter((call) => call.action === "createMaintenanceRecord"),
  ).toHaveLength(0);
});
test("a failed history read never displays a fake zero cost", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  state.failRecordReads = true;
  await open(page, false);
  await expect(page.locator(".basic-info")).toContainText("累計保養支出");
  await expect(page.locator(".basic-info")).toContainText(
    "無法確認，請重新讀取",
  );
  await expect(complete(page)).toBeDisabled();
  state.failRecordReads = false;
  await page
    .getByRole("button", { name: "重新讀取完成紀錄", exact: true })
    .click();
  await expect(page.locator(".basic-info")).toContainText("$0");
});
test("a late prior item history cannot replace the current item's cost", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  state.rows.push({ ...sampleItem, item_id: "other", name: "另一件設備" });
  state.plans.push({ ...samplePlan, plan_id: "other-plan", item_id: "other" });
  state.records.push({
    ...sampleRecord,
    item_id: "other",
    plan_id: "other-plan",
    amount: 900,
  });
  state.recordDelayByItem[sampleItem.item_id] = 500;
  await open(page, false);
  await expect
    .poll(() =>
      state.calls.some(
        (call) =>
          call.action === "getMaintenanceRecordsByItem" &&
          call.payload.item_id === sampleItem.item_id,
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    location.hash = "/items/other";
  });
  await expect(page.locator(".basic-info")).toContainText("$900");
  await page.waitForTimeout(600);
  await expect(page.locator(".basic-info")).toContainText("$900");
});
