import { expect, test } from "@playwright/test";
import { mockGoogleBridge, TEST_WEB_APP } from "../fixtures/googleBridge";
const LOCAL_KEY = "life-records-manager:v1";
const URL_KEY = "life-records-manager:apps-script-url:v1";
async function connect(page: import("@playwright/test").Page) {
  await page.goto("./#/settings");
  await page.getByLabel("Web App /exec URL").fill(TEST_WEB_APP);
  await page.getByRole("button", { name: "連線並儲存網址" }).click();
}
test("nested iframe Items CRUD/archive/restore uses exact protocol and leaves Mock intact", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await page.goto("./");
  // An existing user value must never be replaced, even if it cannot be decoded by Mock.
  await page.evaluate(
    (key) => localStorage.setItem(key, "existing-local-records-do-not-touch"),
    LOCAL_KEY,
  );
  await connect(page);
  await expect(
    page.getByText("已連線 · Google Sheets Items", { exact: true }),
  ).toBeVisible();
  expect(state.calls.map((c) => c.action)).toEqual(["getItems"]);
  expect(await page.evaluate((key) => localStorage.getItem(key), URL_KEY)).toBe(
    TEST_WEB_APP,
  );
  await page.getByRole("link", { name: "前往 Google Sheets Items" }).click();
  await page.getByRole("button", { name: "雲端測試設備", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("TEST-30");
  await page.getByRole("button", { name: "修改基本資料" }).click();
  await page.getByLabel("雲端事項名稱").fill("已更新雲端設備");
  await page.getByLabel("型號", { exact: true }).fill("TEST-40");
  await page.getByRole("button", { name: "儲存雲端事項" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "已更新雲端設備" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新增雲端事項", exact: true }).click();
  await page.getByLabel("雲端事項名稱").fill("新增測試設備");
  await page.getByLabel("金額（NT$）").fill("999");
  await page.getByRole("button", { name: "儲存雲端事項" }).click();
  await expect(
    page.getByRole("button", { name: "新增測試設備", exact: true }),
  ).toBeVisible();
  const row = page.locator("article").filter({ hasText: "新增測試設備" });
  await row.getByRole("button", { name: "封存", exact: true }).click();
  await page.getByRole("button", { name: "確認封存" }).click();
  await expect(row).toContainText("已封存");
  await row.getByRole("button", { name: "還原", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "封存", exact: true }),
  ).toBeVisible();
  expect(state.calls.some((c) => c.action.startsWith("bridge"))).toBe(false);
  const payload = state.calls.find((c) => c.action === "createItem")!.payload;
  expect(Object.keys(payload).sort()).toEqual([
    "amount",
    "brand",
    "category",
    "item_date",
    "location",
    "model",
    "name",
    "warranty_date",
  ]);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), LOCAL_KEY),
  ).toBe("existing-local-records-do-not-touch");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "連線設定", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "移除已儲存網址" }).click();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), URL_KEY),
  ).toBeNull();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), LOCAL_KEY),
  ).toBe("existing-local-records-do-not-touch");
  await expect(page.locator(".bridge-host iframe")).toHaveCount(0);
});
test("ready without successful Items read does not persist URL or overwrite local records", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  state.failReads = true;
  await page.goto("./");
  await page.evaluate(
    (key) => localStorage.setItem(key, "preserve-me"),
    LOCAL_KEY,
  );
  await connect(page);
  await expect(page.getByRole("alert")).toContainText("模擬後端讀取失敗");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), URL_KEY),
  ).toBeNull();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), LOCAL_KEY),
  ).toBe("preserve-me");
  await expect(page.locator(".bridge-host iframe")).toHaveCount(0);
});
test("read failure preserves last successful cloud snapshot and blocks writes until refreshed", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await connect(page);
  await expect(
    page.getByText("已連線 · Google Sheets Items", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "前往 Google Sheets Items" }).click();
  state.malformed = true;
  await page.getByRole("button", { name: "重新讀取" }).click();
  await expect(page.getByRole("alert")).toContainText("必須回傳 Items 陣列");
  await expect(
    page.getByRole("button", { name: "雲端測試設備" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "新增雲端事項" }),
  ).toBeDisabled();
  state.malformed = false;
  await page.getByRole("button", { name: "重新讀取" }).click();
  await expect(
    page.getByRole("button", { name: "新增雲端事項" }),
  ).toBeEnabled();
});
test("write success plus refresh failure closes form and prevents duplicate write", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await connect(page);
  await expect(
    page.getByText("已連線 · Google Sheets Items", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "前往 Google Sheets Items" }).click();
  await page.getByRole("button", { name: "新增雲端事項", exact: true }).click();
  await page.getByLabel("雲端事項名稱").fill("只新增一次");
  state.failReads = true;
  await page.getByRole("button", { name: "儲存雲端事項" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "已寫入成功，但重新讀取失敗",
  );
  expect(state.calls.filter((c) => c.action === "createItem")).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "新增雲端事項" }),
  ).toBeDisabled();
  state.failReads = false;
  await page.getByRole("button", { name: "重新讀取" }).click();
  await expect(
    page.getByRole("button", { name: "只新增一次", exact: true }),
  ).toBeVisible();
});
test("login/frame restriction times out, supports cancel, and keeps Mock available", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  state.ready = false;
  await page.clock.install();
  await connect(page);
  await expect(page.locator(".bridge-host iframe")).toHaveCount(1);
  await page.clock.fastForward(16000);
  await expect(page.getByRole("alert")).toContainText("未收到 Bridge ready");
  await expect(page.locator(".bridge-host iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "連線並儲存網址" }).click();
  await page.getByRole("button", { name: "中斷連線", exact: true }).click();
  await expect(page.locator(".bridge-host iframe")).toHaveCount(0);
  await page.getByRole("link", { name: "使用本機 Mock" }).click();
  await expect(page.getByRole("heading", { name: "電熱水器" })).toBeVisible();
  expect(state.calls).toHaveLength(0);
});
test("lost write response is not automatically retried and can be reconciled by read", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await page.clock.install();
  await connect(page);
  await expect(
    page.getByText("已連線 · Google Sheets Items", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "前往 Google Sheets Items" }).click();
  await page.getByRole("button", { name: "新增雲端事項", exact: true }).click();
  await page.getByLabel("雲端事項名稱").fill("等待確認的寫入");
  state.loseWriteResponse = true;
  await page.getByRole("button", { name: "儲存雲端事項" }).click();
  await expect
    .poll(() => state.calls.filter((c) => c.action === "createItem").length)
    .toBe(1);
  await page.clock.fastForward(21000);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "寫入可能已完成",
  );
  await expect(
    page.getByRole("button", { name: "儲存雲端事項" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "關閉", exact: true }).click();
  await page.getByRole("button", { name: "重新讀取" }).click();
  await expect(
    page.getByRole("button", { name: "等待確認的寫入", exact: true }),
  ).toBeVisible();
  expect(state.calls.filter((c) => c.action === "createItem")).toHaveLength(1);
});
