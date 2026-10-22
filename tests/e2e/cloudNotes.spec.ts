import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  mockGoogleBridge,
  sampleItem,
  TEST_WEB_APP,
} from "../fixtures/googleBridge";

const enabled = process.env.NOTES_E2E_ENABLED === "true";
async function open(page: Page) {
  await page.goto("./#/settings");
  await page.getByLabel("Web App /exec URL").fill(TEST_WEB_APP);
  await page.getByRole("button", { name: "連線並使用 Google Sheets" }).click();
  await page.getByRole("link", { name: "返回生活事項首頁" }).click();
  await page.locator(".item-card").filter({ hasText: sampleItem.name }).click();
  await page.getByRole("tab", { name: /備註/ }).click();
}
test.describe("Notes API not deployed", () => {
  test.skip(enabled);
  test("shows the unavailable state and never calls proposed actions", async ({
    page,
  }) => {
    const backend = await mockGoogleBridge(page);
    await open(page);
    await expect(page.getByRole("tabpanel")).toContainText(
      "備註雲端 API 尚未連接",
    );
    expect(
      backend.calls.some((call) =>
        /^(getNotes|getNote|createNote|updateNote|archiveNote)$/.test(
          call.action,
        ),
      ),
    ).toBe(false);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("life-records-manager:pending-cloud-note:v1"),
      ),
    ).toBeNull();
  });
});
test.describe("proposed Notes Bridge simulation", () => {
  test.skip(!enabled);
  test("creates, edits, archives and reloads the original Notes tab", async ({
    page,
  }) => {
    const backend = await mockGoogleBridge(page);
    await open(page);
    await page.getByRole("textbox", { name: "新增備註" }).fill("雲端假備註");
    await page.getByRole("button", { name: "新增備註", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "新增備註" })).toHaveValue("");
    await expect(page.getByRole("tabpanel")).toContainText("雲端假備註");
    expect(backend.notes).toHaveLength(1);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("life-records-manager:v1"),
      ),
    ).toBeNull();
    await page.getByRole("button", { name: "編輯", exact: true }).click();
    await page.getByRole("textbox", { name: "編輯備註" }).fill("修改後備註");
    await page.getByRole("button", { name: "儲存備註" }).click();
    await expect(page.getByRole("tabpanel")).toContainText("修改後備註");
    await page.getByRole("button", { name: "封存", exact: true }).click();
    await expect(page.getByRole("tabpanel")).toContainText("已封存");
    await page.reload();
    await page.getByRole("tab", { name: /備註/ }).click();
    await expect(page.getByRole("tabpanel")).toContainText("修改後備註");
  });
  test("failed write keeps draft and its ID; other item never shows it", async ({
    page,
  }) => {
    const backend = await mockGoogleBridge(page);
    backend.rows.push({
      ...sampleItem,
      item_id: "other-item",
      name: "另一件設備",
    });
    await open(page);
    await page.getByRole("textbox", { name: "新增備註" }).fill("待重試內容");
    const first = await page.evaluate(
      () =>
        JSON.parse(
          sessionStorage.getItem("life-records-manager:pending-cloud-note:v1")!,
        )["test-cloud-item"].note_id,
    );
    backend.failNoteWrites = true;
    await page.getByRole("button", { name: "新增備註", exact: true }).click();
    await expect(page.getByRole("tabpanel")).toContainText("模擬備註寫入失敗");
    expect(
      await page.evaluate(
        () =>
          JSON.parse(
            sessionStorage.getItem(
              "life-records-manager:pending-cloud-note:v1",
            )!,
          )["test-cloud-item"].note_id,
      ),
    ).toBe(first);
    backend.failNoteWrites = false;
    await page.getByRole("button", { name: "重新讀取備註" }).click();
    await page.getByRole("button", { name: "新增備註", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "新增備註" })).toHaveValue(
      "",
    );
    expect(backend.notes).toHaveLength(1);
    await page.locator(".back-link").click();
    await page.locator(".item-card").filter({ hasText: "另一件設備" }).click();
    await page.getByRole("tab", { name: /備註/ }).click();
    await expect(page.getByRole("tabpanel")).not.toContainText("待重試內容");
  });
});
