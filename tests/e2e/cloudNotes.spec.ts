import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mockGoogleBridge, sampleItem, samplePlan, TEST_WEB_APP } from "../fixtures/googleBridge";
async function open(page: Page) {
  await page.goto("./#/settings");
  await page.getByLabel("Web App /exec URL").fill(TEST_WEB_APP);
  await page.getByRole("button", { name: "連線並使用 Google Sheets" }).click();
  await page.getByRole("link", { name: "返回生活事項首頁" }).click();
  await page.locator(".item-card").filter({ hasText: sampleItem.name }).click();
}
test("item Notes create, edit and reload use v3.2; Mock stays untouched", async ({ page }) => {
  const backend = await mockGoogleBridge(page);
  await open(page);
  await page.getByRole("tab", { name: /備註/ }).click();
  await page.getByRole("textbox", { name: "新增備註標題" }).fill("雲端標題");
  await page.getByRole("textbox", { name: "新增備註內容" }).fill("雲端假備註");
  await page.getByRole("button", { name: "新增備註", exact: true }).click();
  await expect(page.getByRole("tabpanel").locator("article.note")).toContainText("雲端假備註");
  expect(backend.notes).toHaveLength(1);
  expect(backend.calls.find(call => call.action === "createNote")?.payload).toMatchObject({
    owner_type: "item", owner_id: sampleItem.item_id, title: "雲端標題", content: "雲端假備註",
  });
  expect(await page.evaluate(() => localStorage.getItem("life-records-manager:v1"))).toBeNull();
  await page.getByRole("button", { name: "編輯", exact: true }).click();
  await page.getByRole("textbox", { name: "編輯備註內容" }).fill("修改後備註");
  await page.getByRole("button", { name: "儲存備註" }).click();
  await expect(page.getByRole("tabpanel").locator("article.note")).toContainText("修改後備註");
  await page.reload();
  await page.getByRole("tab", { name: /備註/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText("修改後備註");
});
test("plan Notes are isolated from item and other plans", async ({ page }) => {
  const backend = await mockGoogleBridge(page);
  backend.plans.push({ ...samplePlan, plan_id: "plan-two", name: "另一保養計畫" });
  await open(page);
  await page.getByRole("button", { name: "查看備註" }).first().click();
  await page.getByRole("textbox", { name: "新增備註標題" }).fill("保養提醒");
  await page.getByRole("textbox", { name: "新增備註內容" }).fill("檢查濾網");
  await page.getByRole("button", { name: "新增備註", exact: true }).click();
  await expect(page.getByRole("tabpanel").locator("article.note")).toContainText("檢查濾網");
  expect(backend.notes[0]).toMatchObject({ owner_type: "plan", owner_id: "plan-one" });
  await page.getByRole("button", { name: "查看備註" }).click();
  await expect(page.getByRole("tabpanel").locator("article.note")).toHaveCount(0);
  await page.getByRole("tab", { name: /備註/ }).click();
  await expect(page.getByRole("tabpanel")).not.toContainText("檢查濾網");
});
test("failed write preserves draft and UUID; retry creates only one note", async ({ page }) => {
  const backend = await mockGoogleBridge(page);
  await open(page);
  await page.getByRole("tab", { name: /備註/ }).click();
  await page.getByRole("textbox", { name: "新增備註標題" }).fill("待重試標題");
  await page.getByRole("textbox", { name: "新增備註內容" }).fill("待重試內容");
  const originalId = await page.evaluate(() => JSON.parse(sessionStorage.getItem("life-records-manager:pending-cloud-note:v2")!)["item:test-cloud-item"].note_id);
  backend.failNoteWrites = true;
  await page.getByRole("button", { name: "新增備註", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("模擬備註寫入失敗");
  await expect(page.getByRole("textbox", { name: "新增備註內容" })).toHaveValue("待重試內容");
  backend.failNoteWrites = false;
  await page.getByRole("button", { name: "重新讀取備註" }).click();
  await page.getByRole("button", { name: "新增備註", exact: true }).click();
  await expect(page.getByRole("tabpanel").locator("article.note")).toContainText("待重試內容");
  expect(backend.notes).toHaveLength(1);
  expect(backend.notes[0].note_id).toBe(originalId);
});
test("failed Notes read shows error and never presents an empty list as success", async ({ page }) => {
  const backend = await mockGoogleBridge(page);
  await open(page);
  backend.failNoteReads = true;
  await page.getByRole("tab", { name: /備註/ }).click();
  await expect(page.getByRole("tabpanel").getByRole("alert")).toContainText("模擬備註讀取失敗");
  await expect(page.getByRole("button", { name: "新增備註", exact: true })).toBeDisabled();
  backend.failNoteReads = false;
  await page.getByRole("button", { name: "重新讀取備註" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("尚無雲端備註");
});
