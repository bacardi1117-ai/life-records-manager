import { expect, test } from "@playwright/test";
import {
  mockGoogleBridge,
  sampleItem,
  TEST_WEB_APP,
} from "../fixtures/googleBridge";
const LOCAL_KEY = "life-records-manager:v1";
const URL_KEY = "life-records-manager:apps-script-url:v1";
const MODE_KEY = "life-records-manager:data-source:v1";
const localData = JSON.stringify({
  version: 1,
  items: [
    {
      id: "test-cloud-item",
      name: "本機獨立事項",
      date: "2026-01-01",
      category: "其他事項",
      amount: 10,
      brand: "",
      location: "",
      description: "",
      notes: [{ id: "local-note", date: "2026-01-01", text: "本機測試備註" }],
      photos: [],
      tasks: [],
      history: [],
    },
  ],
});
async function connect(page: import("@playwright/test").Page) {
  await page.goto("./#/settings");
  await page.getByLabel("Web App /exec URL").fill(TEST_WEB_APP);
  await page.getByRole("button", { name: "連線並使用 Google Sheets" }).click();
  await expect(
    page.getByText("Google Sheets 雲端模式 · 已連線", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "返回生活事項首頁" }).click();
}
async function openCloud(
  page: import("@playwright/test").Page,
  name = "雲端測試設備",
) {
  await page
    .locator(".item-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
test("one cloud source drives home, original detail, partial edits, totals and reload", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await connect(page);
  await expect(
    page.getByRole("heading", { name: "把生活，照顧得更好。" }),
  ).toBeVisible();
  await expect(page.getByTestId("source-label")).toHaveText(
    "Google Sheets 雲端模式",
  );
  await expect(page.locator(".item-card")).toContainText("12,800");
  await openCloud(page);
  await expect(page.locator(".basic-info")).toContainText("TEST-30");
  await expect(page.locator(".basic-info")).toContainText("2029-10-21");
  await page.getByRole("button", { name: "編輯資料" }).click();
  await page.getByLabel("購入金額").fill("20000.5");
  state.rows[0].brand = "後端同期變更";
  await page.getByRole("button", { name: "儲存事項", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".large-money")).toContainText("20,000.5");
  await expect(page.locator(".basic-info")).toContainText("後端同期變更");
  const update = state.calls.find((c) => c.action === "updateItem");
  expect(update?.payload).toEqual({
    item_id: "test-cloud-item",
    changes: { amount: 20000.5 },
  });
  expect(state.calls.at(-1)?.action).toBe("getItem");
  await page.getByRole("link", { name: "所有生活事項" }).click();
  await expect(page.locator(".stats")).toContainText("20,000.5");
  await expect(page.locator(".item-card")).toContainText("20,000.5");
  await openCloud(page);
  await page.getByRole("button", { name: "編輯資料" }).click();
  await page.getByLabel("日期", { exact: true }).fill("2026-09-10");
  await page.getByLabel("品牌", { exact: true }).fill("更新品牌");
  await page.getByLabel("型號", { exact: true }).fill("NEW-MODEL");
  await page.getByLabel("地點", { exact: true }).fill("更新位置");
  await page.getByLabel("保固日期").fill("2028-09-10");
  await page.getByRole("button", { name: "儲存事項", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    state.calls.filter((c) => c.action === "updateItem").at(-1)?.payload,
  ).toEqual({
    item_id: "test-cloud-item",
    changes: {
      item_date: "2026-09-10",
      brand: "更新品牌",
      model: "NEW-MODEL",
      location: "更新位置",
      warranty_date: "2028-09-10",
    },
  });
  await page.reload();
  await expect(page.locator(".basic-info")).toContainText("2026-09-10");
  await expect(page.locator(".basic-info")).toContainText("NEW-MODEL");
  await expect(page.locator(".basic-info")).toContainText("20,000.5");
  await expect(page.getByTestId("source-label")).toHaveText(
    "Google Sheets 雲端模式",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("cloud creation opens server ID in original detail and never creates Mock copies", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await page.goto("./");
  await page.evaluate(
    ([key, data]) => localStorage.setItem(key, data),
    [LOCAL_KEY, localData],
  );
  await connect(page);
  await expect(page.getByRole("heading", { name: "本機獨立事項" })).toHaveCount(
    0,
  );
  expect(state.calls.map((c) => c.action)).toEqual(["getItems"]);
  await page.getByRole("button", { name: "新增生活事項", exact: true }).click();
  await page.getByLabel("事項名稱").fill("新增雲端設備");
  await page.getByLabel("購入金額").fill("999");
  await page.getByRole("button", { name: "儲存事項", exact: true }).click();
  await expect(page).toHaveURL(/#\/items\/new-cloud-item$/);
  await expect(
    page.getByRole("heading", { name: "新增雲端設備" }),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), LOCAL_KEY),
  ).toBe(localData);
  expect(state.calls.filter((c) => c.action === "createItem")).toHaveLength(1);
  expect(
    Object.keys(
      state.calls.find((c) => c.action === "createItem")!.payload,
    ).sort(),
  ).toEqual([
    "amount",
    "brand",
    "category",
    "item_date",
    "location",
    "model",
    "name",
    "warranty_date",
  ]);
  for (const tab of ["備註", "照片"]) {
    await page.getByRole("tab", { name: new RegExp(tab) }).click();
    await expect(page.getByRole("tabpanel")).toContainText(
      tab === "備註" ? "生活筆記" : "尚未支援雲端同步",
    );
    if (tab === "照片") await expect(page.getByRole("tabpanel").getByRole("button")).toHaveCount(0);
  }
  await expect(page.getByText("本機測試備註")).toHaveCount(0);
});
test("failed cloud update retains the draft, emits no success and allows read recovery", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await connect(page);
  await openCloud(page);
  await page.getByRole("button", { name: "編輯資料" }).click();
  await page.getByLabel("購入金額").fill("555");
  state.failWrites = true;
  await page.getByRole("button", { name: "儲存事項", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "模擬雲端寫入失敗",
  );
  await expect(page.getByLabel("購入金額")).toHaveValue("555");
  await expect(
    page.getByText("已儲存至 Google Sheets。", { exact: true }),
  ).toHaveCount(0);
  expect(state.rows[0].amount).toBe(12800);
  state.failWrites = false;
  await page.getByRole("button", { name: "重新讀取資料並保留草稿" }).click();
  await expect(
    page.getByRole("button", { name: "儲存事項", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("購入金額")).toHaveValue("555");
  await page.getByRole("button", { name: "儲存事項", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".large-money")).toContainText("555");
});
test("different item IDs remain isolated including detail navigation and archive state", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  state.rows.push({
    ...sampleItem,
    item_id: "other-id",
    name: "第二件設備",
    amount: 777,
  });
  await connect(page);
  await openCloud(page);
  await page.getByRole("button", { name: "編輯資料" }).click();
  await page.getByLabel("購入金額").fill("20000");
  await page.getByRole("button", { name: "儲存事項", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "所有生活事項" }).click();
  await openCloud(page, "第二件設備");
  await expect(page.locator(".large-money")).toContainText("777");
  expect(state.rows.find((i) => i.item_id === "other-id")?.amount).toBe(777);
  await page.getByRole("button", { name: "封存事項", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "還原事項", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "所有生活事項" }).click();
  await expect(
    page.locator(".item-card").filter({ hasText: "第二件設備" }),
  ).toContainText("已封存");
  expect(state.rows[0].status).toBe("active");
});
test("cloud refresh failure stops writes without switching source or clearing local records", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await page.goto("./");
  await page.evaluate(
    ([key, data]) => localStorage.setItem(key, data),
    [LOCAL_KEY, localData],
  );
  await connect(page);
  state.failReads = true;
  await page.getByRole("button", { name: "重新讀取", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("模擬後端讀取失敗");
  await expect(
    page.getByRole("button", { name: "新增生活事項", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "雲端測試設備" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("模擬後端讀取失敗");
  await expect(page.getByTestId("source-label")).toHaveText(
    "Google Sheets 雲端模式",
  );
  await expect(page.getByRole("heading", { name: "本機獨立事項" })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), LOCAL_KEY),
  ).toBe(localData);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), MODE_KEY),
  ).toBe("cloud");
});
test("explicit Mock switch requires confirmation and persists without uploading or deleting data", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await page.goto("./");
  await page.evaluate(
    ([key, data]) => localStorage.setItem(key, data),
    [LOCAL_KEY, localData],
  );
  await connect(page);
  const calls = state.calls.length;
  await page
    .getByRole("link", { name: "連線設定", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "切換為本機 Mock", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("不同資料來源");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByTestId("source-label")).toHaveText(
    "Google Sheets 雲端模式",
  );
  await page
    .getByRole("button", { name: "切換為本機 Mock", exact: true })
    .click();
  await page
    .getByRole("button", { name: "確認切換至 Mock", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "本機獨立事項" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("source-label")).toHaveText("本機 Mock 模式");
  await expect(
    page.getByRole("heading", { name: "本機獨立事項" }),
  ).toBeVisible();
  expect(state.calls.length).toBe(calls);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), LOCAL_KEY),
  ).toBe(localData);
  expect(await page.evaluate((key) => localStorage.getItem(key), URL_KEY)).toBe(
    TEST_WEB_APP,
  );
});
test("acknowledged update with failed read closes form without pretending to show latest data", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await connect(page);
  await openCloud(page);
  await page.getByRole("button", { name: "編輯資料" }).click();
  await page.getByLabel("購入金額").fill("543");
  state.failGet = true;
  await page.getByRole("button", { name: "儲存事項", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("寫入已確認");
  expect(state.calls.filter((c) => c.action === "updateItem")).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "編輯資料", exact: true }),
  ).toBeDisabled();
  state.failGet = false;
  await page.getByRole("button", { name: "重新讀取", exact: true }).click();
  await expect(page.locator(".large-money")).toContainText("543");
});
test("lost create response is never automatically retried or given a local ID", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  await page.clock.install();
  await connect(page);
  await page.getByRole("button", { name: "新增生活事項", exact: true }).click();
  await page.getByLabel("事項名稱").fill("等待核對的設備");
  state.loseWriteResponse = true;
  await page.getByRole("button", { name: "儲存事項", exact: true }).click();
  await expect
    .poll(() => state.calls.filter((c) => c.action === "createItem").length)
    .toBe(1);
  await page.clock.fastForward(21000);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "寫入可能已完成",
  );
  await expect(page.getByLabel("事項名稱")).toHaveValue("等待核對的設備");
  await expect(
    page.getByRole("button", { name: "儲存事項", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), LOCAL_KEY),
  ).toBeNull();
  await page.getByRole("button", { name: "關閉", exact: true }).click();
  await page.getByRole("button", { name: "重新讀取", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "等待核對的設備" }),
  ).toBeVisible();
  expect(state.calls.filter((c) => c.action === "createItem")).toHaveLength(1);
});
test("iframe timeout remains in cloud mode and cancellation never switches to Mock", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  state.ready = false;
  await page.clock.install();
  await page.goto("./#/settings");
  await page.getByLabel("Web App /exec URL").fill(TEST_WEB_APP);
  await page.getByRole("button", { name: "連線並使用 Google Sheets" }).click();
  await expect(page.locator(".bridge-host iframe")).toHaveCount(1);
  await page.clock.fastForward(16000);
  await expect(page.getByRole("alert")).toContainText("未收到 Bridge ready");
  await expect(page.getByTestId("source-label")).toHaveText(
    "Google Sheets 雲端模式",
  );
  await expect(page.locator(".bridge-host iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "連線並使用 Google Sheets" }).click();
  await page.getByRole("button", { name: "中斷連線", exact: true }).click();
  await expect(page.locator(".bridge-host iframe")).toHaveCount(0);
  await page.getByRole("link", { name: "返回生活事項首頁" }).click();
  await expect(page.getByRole("heading", { name: "電熱水器" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "新增生活事項", exact: true }),
  ).toBeDisabled();
});
test("late response for a prior detail cannot replace the new detail", async ({
  page,
}) => {
  const state = await mockGoogleBridge(page);
  state.rows.push({ ...sampleItem, item_id: "second", name: "第二筆獨立資料" });
  await connect(page);
  state.getDelay["test-cloud-item"] = 500;
  await page.locator(".item-card").filter({ hasText: "雲端測試設備" }).click();
  await expect
    .poll(() =>
      state.calls.some(
        (c) =>
          c.action === "getItem" && c.payload.item_id === "test-cloud-item",
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    location.hash = "/items/second";
  });
  await expect(
    page.getByRole("heading", { name: "第二筆獨立資料" }),
  ).toBeVisible();
  await expect
    .poll(() => state.calls.filter((c) => c.action === "getItem").length)
    .toBe(2);
  // Wait on a deterministic round trip after the older request has had time to resolve.
  await page.waitForTimeout(600);
  await expect(
    page.getByRole("heading", { name: "第二筆獨立資料" }),
  ).toBeVisible();
});
