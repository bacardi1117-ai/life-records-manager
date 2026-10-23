import { expect, test } from "@playwright/test";
import { mockGoogleBridge, sampleItem, samplePlan, sampleRecord, TEST_WEB_APP } from "../fixtures/googleBridge";
import type { Page } from "@playwright/test";
async function setToday(page: Page) { await page.clock.setFixedTime(new Date("2026-10-24T01:00:00Z")); }
async function connect(page: Page) {
  await page.goto("./#/settings");
  await page.getByLabel("Web App /exec URL").fill(TEST_WEB_APP);
  await page.getByRole("button", {name:"連線並使用 Google Sheets"}).click();
  await page.getByRole("link", {name:"返回生活事項首頁"}).click();
  await page.getByRole("link", {name:"保養月曆"}).click();
  await expect(page.getByRole("heading", {name:"保養月曆", exact:true})).toBeVisible();
}
test("calendar shows independent same-day plans and records, filters owners and deep-links correctly", async ({page}, testInfo) => {
  await setToday(page);
  const state=await mockGoogleBridge(page);
  state.rows.push({...sampleItem,item_id:"second-item",name:"另一台設備"});
  state.plans[0]={...samplePlan,next_due_date:"2026-10-24"};
  state.plans.push({...samplePlan,plan_id:"second-plan",name:"清理濾網",next_due_date:"2026-10-24"},
    {...samplePlan,plan_id:"disabled-plan",name:"已停用項目",enabled:false,next_due_date:"2026-10-24"},
    {...samplePlan,plan_id:"other-plan",item_id:"second-item",name:"另一項保養",next_due_date:"2026-10-25"});
  state.records.push({...sampleRecord,record_id:"record-one",completed_date:"2026-10-24"},
    {...sampleRecord,record_id:"record-two",completed_date:"2026-10-24",title:"再次檢查"});
  await connect(page);
  await expect(page.getByRole("heading", {name:"2026 年 10 月"})).toBeVisible();
  await page.getByRole("button", {name:/查看 2026-10-24 的事項/}).click();
  await expect(page.locator(".calendar-day-list .calendar-event")).toHaveCount(4);
  await expect(page.locator(".calendar-day-list")).not.toContainText("已停用項目");
  await page.getByLabel("月曆事項篩選").selectOption("second-item");
  await expect(page.locator(".calendar-day-list .calendar-event")).toHaveCount(0);
  await page.getByLabel("月曆事項篩選").selectOption("");
  await page.locator(".calendar-day-list .calendar-event.scheduled").first().click();
  await expect(page).toHaveURL(/tab=plans&plan=plan-one/);
  await expect(page.locator("#maintenance-plan-plan-one")).toBeFocused();
  await page.getByRole("link", {name:"保養月曆"}).click();
  await page.getByRole("button", {name:/查看 2026-10-24 的事項/}).click();
  await page.locator(".calendar-day-list .calendar-event.completed").first().click();
  await expect(page).toHaveURL(/tab=history&record=record-one/);
  await expect(page.getByRole("tabpanel", {name:"歷史紀錄"})).toBeVisible();
  await expect(page.locator("#maintenance-record-record-one")).toBeFocused();
  if (testInfo.project.name === "mobile") expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("month navigation crosses years and empty months do not invent future schedule", async ({page}) => {
  await setToday(page);
  await mockGoogleBridge(page);
  await connect(page);
  await page.getByRole("button", {name:"下一個月"}).click();
  await expect(page.getByRole("heading", {name:"2026 年 11 月"})).toBeVisible();
  await expect(page.getByText(/這個月沒有保養計畫或完成紀錄/)).toBeVisible();
  await page.getByRole("button", {name:"下一個月"}).click();
  await page.getByRole("button", {name:"下一個月"}).click();
  await expect(page.getByRole("heading", {name:"2027 年 1 月"})).toBeVisible();
  await page.getByRole("button", {name:"上一個月"}).click();
  await expect(page.getByRole("heading", {name:"2026 年 12 月"})).toBeVisible();
  await page.getByRole("button", {name:"回到本月"}).click();
  await expect(page.getByRole("heading", {name:"2026 年 10 月"})).toBeVisible();
});
test("cloud read failure blocks calendar data and refresh recovers without switching Mock", async ({page}) => {
  await setToday(page);
  const state=await mockGoogleBridge(page);
  state.failRecordReads=true;
  await connect(page);
  await expect(page.getByRole("alert")).toContainText("保養月曆讀取失敗");
  await expect(page.locator(".calendar-grid")).toHaveCount(0);
  await expect(page.getByTestId("source-label")).toHaveText("Google Sheets 雲端模式");
  state.failRecordReads=false;
  await page.getByRole("button", {name:"重新讀取月曆"}).click();
  await expect(page.locator(".calendar-grid")).toBeVisible();
});
test("Mock calendar uses local data and sends no Google request", async ({page}) => {
  await setToday(page);
  const state=await mockGoogleBridge(page);
  await page.goto("./#/calendar");
  await expect(page.getByTestId("source-label")).toHaveText("本機 Mock 模式");
  await expect(page.locator(".calendar-grid")).toBeVisible();
  expect(state.calls).toHaveLength(0);
});
test("calendar rereads the backend-computed date after editing a plan", async ({page}) => {
  await page.clock.setFixedTime(new Date("2028-02-01T01:00:00Z"));
  const state=await mockGoogleBridge(page);
  await connect(page);
  await expect(page.getByText(/這個月沒有保養計畫或完成紀錄/)).toBeVisible();
  await page.getByRole("link", {name:"生活事項", exact:true}).click();
  await page.locator(".item-card").first().click();
  await page.getByRole("button", {name:`編輯${samplePlan.name}`}).click();
  await page.getByLabel("週期數值", {exact:true}).fill("12");
  await page.getByRole("button", {name:"儲存保養計畫"}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", {name:"保養月曆"}).click();
  await expect(page.getByRole("gridcell", {name:"2028-02-29"}).locator(".calendar-event.scheduled")).toContainText(samplePlan.name);
  expect(state.calls.filter(call=>call.action==="getMaintenancePlans").length).toBeGreaterThan(1);
});
test("completion refreshes calendar with the backend due date and a separate record event", async ({page}) => {
  await page.clock.setFixedTime(new Date("2028-03-01T01:00:00Z"));
  const state=await mockGoogleBridge(page);
  await connect(page);
  await expect(page.getByText(/這個月沒有保養計畫或完成紀錄/)).toBeVisible();
  await page.getByRole("link", {name:"生活事項", exact:true}).click();
  await page.locator(".item-card").first().click();
  await page.locator(".cloud-plan").first().getByRole("button", {name:"完成保養"}).click();
  await page.getByLabel("完成日期").fill("2028-03-01");
  await page.getByRole("button", {name:"儲存完成紀錄"}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", {name:"保養月曆"}).click();
  await expect(page.getByRole("gridcell", {name:"2028-03-15"}).locator(".calendar-event.scheduled")).toHaveCount(1);
  await expect(page.getByRole("gridcell", {name:"2028-03-01"}).locator(".calendar-event.completed")).toHaveCount(1);
  expect(state.calls.filter(call=>call.action==="getMaintenanceRecordsByItem").length).toBeGreaterThan(1);
});
