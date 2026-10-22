import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mockGoogleBridge, sampleItem, TEST_WEB_APP } from "../fixtures/googleBridge";

const configured = process.env.DRIVE_E2E_ENABLED === "true";
async function openPhotoTab(page: Page) {
  await page.goto("./#/settings");
  await page.getByLabel("Web App /exec URL").fill(TEST_WEB_APP);
  await page.getByRole("button", { name: "連線並使用 Google Sheets" }).click();
  await page.getByRole("link", { name: "返回生活事項首頁" }).click();
  await page.locator(".item-card").filter({ hasText: sampleItem.name }).click();
  await page.getByRole("tab", { name: /照片/ }).click();
}
async function fakeGis(page: Page) {
  await page.addInitScript(() => {
    const scope = "https://www.googleapis.com/auth/drive.file";
    const context = window as unknown as { driveScenario: string; google: unknown };
    context.driveScenario = "success";
    context.google = { accounts: { oauth2: {
      initTokenClient: (options: {
        callback: (response: unknown) => void;
        error_callback: (error: { type: string }) => void;
      }) => ({ requestAccessToken: () => {
        if (context.driveScenario === "cancel") options.error_callback({ type: "popup_closed" });
        else if (context.driveScenario === "deny") options.callback({ error: "access_denied" });
        else options.callback({ access_token: "SYNTHETIC_MEMORY_TOKEN", expires_in: 3600, scope });
      } }),
      revoke: (_token: string, done: (response: { successful: boolean }) => void) => done({ successful: true }),
    } } };
  });
}
test("without Client ID, cloud photo tab reports unconfigured and never requests Drive", async ({ page }) => {
  test.skip(configured);
  const backend = await mockGoogleBridge(page);
  let driveRequests = 0;
  await page.route("https://www.googleapis.com/drive/v3/**", route => { driveRequests++; return route.abort(); });
  await openPhotoTab(page);
  await expect(page.getByRole("tabpanel")).toContainText("Google Drive 尚未設定");
  await expect(page.getByRole("button", { name: "連接私人 Google Drive" })).toHaveCount(0);
  expect(driveRequests).toBe(0);
  expect(backend.calls.some(call => call.action.toLowerCase().includes("drive"))).toBe(false);
});
test("GIS authorization verifies private Drive API, keeps token in memory and revokes", async ({ page }) => {
  test.skip(!configured);
  await fakeGis(page);
  await mockGoogleBridge(page);
  const requests: string[] = [];
  await page.route("https://www.googleapis.com/drive/v3/**", route => {
    requests.push(route.request().headers().authorization);
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await openPhotoTab(page);
  await page.getByRole("button", { name: "連接私人 Google Drive" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Google Drive 已授權");
  expect(requests).toEqual(["Bearer SYNTHETIC_MEMORY_TOKEN"]);
  const storage = await page.evaluate(() => localStorage.length + sessionStorage.length);
  expect(storage).toBeGreaterThan(0); // Existing source settings may be present.
  expect(await page.evaluate(() => Object.values(localStorage).concat(Object.values(sessionStorage)).join(" ")))
    .not.toContain("SYNTHETIC_MEMORY_TOKEN");
  await page.getByRole("button", { name: "取消 Google Drive 授權" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("已取消 Google Drive 授權");
  await expect(page.getByRole("button", { name: "重新授權 Google Drive" })).toBeVisible();
});
test("OAuth cancellation, denial and HTTP 401/403 show errors and allow retry", async ({ page }) => {
  test.skip(!configured);
  await fakeGis(page);
  await mockGoogleBridge(page);
  let status = 200;
  await page.route("https://www.googleapis.com/drive/v3/**", route => route.fulfill({
    status, contentType: "application/json", body: "{}",
  }));
  await openPhotoTab(page);
  await page.evaluate(() => { (window as unknown as { driveScenario: string }).driveScenario = "cancel"; });
  await page.getByRole("button", { name: "連接私人 Google Drive" }).click();
  await expect(page.getByRole("alert")).toContainText("已取消 Google 授權");
  await page.evaluate(() => { (window as unknown as { driveScenario: string }).driveScenario = "deny"; });
  await page.getByRole("button", { name: "重新授權 Google Drive" }).click();
  await expect(page.getByRole("alert")).toContainText("已拒絕 Google Drive 授權");
  await page.evaluate(() => { (window as unknown as { driveScenario: string }).driveScenario = "success"; });
  status = 401;
  await page.getByRole("button", { name: "重新授權 Google Drive" }).click();
  await expect(page.getByRole("alert")).toContainText("授權已過期");
  status = 403;
  await page.getByRole("button", { name: "重新授權 Google Drive" }).click();
  await expect(page.getByRole("alert")).toContainText("Drive API 拒絕存取");
  status = 200;
  await page.getByRole("button", { name: "重新授權 Google Drive" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Google Drive 已授權");
});
