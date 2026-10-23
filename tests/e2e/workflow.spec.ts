import { expect, test } from "@playwright/test";
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=",
  "base64",
);
test("create, maintain, annotate and persist a life item", async ({ page }) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "把生活，照顧得更好。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新增生活事項", exact: true }).click();
  await page.getByLabel("事項名稱").fill("客廳冷氣");
  await page.getByLabel("日期", { exact: true }).fill("2026-01-01");
  await page.getByLabel("購入金額").fill("28000");
  await page.getByLabel("購買及安裝資料").fill("含基本安裝與保固");
  await page.getByRole("button", { name: "儲存事項" }).click();
  await expect(page.getByRole("heading", { name: "客廳冷氣" })).toBeVisible();
  await page.getByRole("button", { name: "新增子項目" }).click();
  await page.getByLabel("子項目名稱").fill("清潔濾網");
  await page.getByLabel("保養週期").selectOption("custom");
  await page.getByLabel("自訂天數").fill("45");
  await page.getByRole("button", { name: "儲存子項目" }).click();
  await expect(
    page.getByText("下次 2026-02-15", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "完成保養", exact: true }).click();
  await page.getByLabel("實際完成日期").fill("2026-02-20");
  await page.getByLabel("保養金額").fill("500");
  await page.getByLabel("完成備註").fill("濾網清潔完成");
  await page.locator("input[type=file]").setInputFiles({
    name: "maintenance.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  await page.getByRole("button", { name: "確認完成保養" }).click();
  await expect(
    page.getByText("下次 2026-04-06", { exact: false }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "歷史紀錄" }).click();
  await page.locator(".history-toggle").first().click();
  await expect(page.getByText("濾網清潔完成")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "maintenance.png" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "備註" }).click();
  await page.getByRole("textbox", { name: "新增備註" }).fill("下次檢查排水管");
  await page.getByRole("button", { name: "新增備註" }).click();
  await expect(page.getByText("下次檢查排水管")).toBeVisible();
  await page.getByRole("tab", { name: "照片", exact: false }).click();
  await page.getByRole("button", { name: "新增照片" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  await page.getByRole("button", { name: "儲存照片" }).click();
  await expect(
    page.getByRole("tabpanel").getByRole("img", { name: "receipt.png" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "客廳冷氣" })).toBeVisible();
  await expect(
    page.getByText("下次 2026-04-06", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "所有生活事項" }).click();
  await page.getByRole("textbox", { name: "搜尋事項" }).fill("冷氣");
  await expect(page.getByRole("heading", { name: "客廳冷氣" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "電熱水器" })).toHaveCount(0);
});
test("seed example, editing, direct detail links and no horizontal overflow", async ({
  page,
}) => {
  await page.goto("./#/items/water-heater");
  await expect(page.getByRole("heading", { name: "電熱水器" })).toBeVisible();
  for (const name of ["更換加熱棒", "清理水垢", "安全檢查"])
    await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.getByRole("button", { name: "編輯安全檢查" }).click();
  await page.getByLabel("保養週期").selectOption("30");
  await page.getByRole("button", { name: "儲存子項目" }).click();
  await expect(
    page.getByText("下次 2026-10-20", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "編輯資料" }).click();
  await page.getByLabel("地點").fill("二樓浴室");
  await page.getByRole("button", { name: "儲存事項" }).click();
  await expect(
    page.locator(".basic-info").getByText("二樓浴室", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".basic-info").getByText("二樓浴室", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "電熱水器" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("corrupt saved data is not overwritten", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() =>
    localStorage.setItem("life-records-manager:v1", "broken data"),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("原始資料已保留");
  expect(
    await page.evaluate(() => localStorage.getItem("life-records-manager:v1")),
  ).toBe("broken data");
});

test("failed storage preserves the form and reports error inside dialog", async ({
  page,
}) => {
  await page.goto("./");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "新增生活事項", exact: true }).click();
  await page.getByLabel("事項名稱").fill("不能遺失的草稿");
  await page.getByRole("button", { name: "儲存事項" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "儲存失敗",
  );
  await expect(page.getByLabel("事項名稱")).toHaveValue("不能遺失的草稿");
});
