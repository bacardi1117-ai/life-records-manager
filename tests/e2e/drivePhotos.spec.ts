import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mockGoogleBridge, sampleItem, TEST_WEB_APP } from "../fixtures/googleBridge";
const enabled = process.env.DRIVE_E2E_ENABLED === "true";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=", "base64");
async function fakeGis(page: Page) {
  await page.addInitScript(() => {
    const scope = "https://www.googleapis.com/auth/drive.file";
    (window as unknown as { google: unknown }).google = { accounts: { oauth2: {
      initTokenClient: (options: { callback: (value: unknown) => void }) => ({ requestAccessToken: () =>
        options.callback({ access_token: "SYNTHETIC_DRIVE_TOKEN", expires_in: 3600, scope }) }),
      revoke: (_token: string, done: (value: unknown) => void) => done({ successful: true }),
    } } };
  });
}
async function open(page: Page) {
  await page.goto("./#/settings");
  await page.getByLabel("Web App /exec URL").fill(TEST_WEB_APP);
  await page.getByRole("button", { name: "連線並使用 Google Sheets" }).click();
  await page.getByRole("link", { name: "返回生活事項首頁" }).click();
  await page.locator(".item-card").filter({ hasText: sampleItem.name }).click();
  await page.getByRole("tab", { name: /照片/ }).click();
  await page.getByRole("button", { name: "連接私人 Google Drive" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Google Drive 已授權");
}
async function fakeDrive(page: Page) {
  const state = { files: [] as Array<Record<string, unknown>>, pending: null as Record<string, unknown> | null,
    folderCreates: 0, uploads: 0, failUpload: false, mediaAuth: [] as string[] };
  let serial = 0;
  await page.route("https://www.googleapis.com/**", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const fulfill = (body: unknown, status = 200, headers: Record<string,string> = {}) => route.fulfill({
      status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Location", ...headers }, body: JSON.stringify(body),
    });
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: {
      "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type,Content-Range,X-Upload-Content-Length,X-Upload-Content-Type",
    }});
    if (url.pathname.startsWith("/upload/drive/v3/files") && method === "POST") {
      state.pending = JSON.parse(request.postData()!);
      return fulfill({}, 200, { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic" });
    }
    if (url.pathname.startsWith("/upload/drive/v3/files") && method === "PUT") {
      state.uploads++;
      if (state.failUpload) return route.abort("failed");
      const row = { ...state.pending!, id: `photo-${++serial}`, createdTime: "2026-10-23T10:00:00Z", size: png.length };
      state.files.push(row);
      return fulfill(row);
    }
    if (method === "POST" && url.pathname === "/drive/v3/files") {
      const body = JSON.parse(request.postData()!);
      state.folderCreates++;
      const row = { ...body, id: `folder-${++serial}`, createdTime: "2026-10-23T10:00:00Z" };
      state.files.push(row);
      return fulfill(row);
    }
    if (url.searchParams.get("alt") === "media") {
      state.mediaAuth.push(request.headers().authorization);
      return route.fulfill({
      status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: png,
    });
    }
    const found = state.files.find(row => url.pathname.endsWith(`/${row.id}`));
    if (found) return fulfill(found);
    if (url.pathname !== "/drive/v3/files") return fulfill({}, 404);
    const q = url.searchParams.get("q") ?? "";
    const rows = state.files.filter(row => {
      if (q.includes("attachment_id")) {
        const attachmentId = q.match(/value='([^']+)'/)?.[1];
        return (row.appProperties as Record<string,string>)?.attachment_id === attachmentId;
      }
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      if (parent && !(row.parents as string[])?.includes(parent)) return false;
      const name = q.match(/name = '([^']+)'/)?.[1];
      return !name || row.name === name;
    });
    return fulfill({ files: rows });
  });
  return state;
}
test("uploads multiple private item photos and reloads authorized Blob thumbnails without duplicate folders", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page); const backend = await mockGoogleBridge(page);
  backend.rows.push({ ...sampleItem, item_id: "another-item", name: "另一個事項" });
  const drive = await fakeDrive(page);
  await open(page);
  await page.getByLabel("選取私人 Drive 照片").setInputFiles([
    { name: "設備.png", mimeType: "image/png", buffer: png },
    { name: "憑證.png", mimeType: "image/png", buffer: Buffer.concat([png, Buffer.from([1])]) },
  ]);
  await expect(page.getByRole("button", { name: "上傳／核對選取的照片" })).toBeEnabled();
  await page.getByRole("button", { name: "上傳／核對選取的照片" }).click();
  await expect(page.getByText("已上傳並核對")).toHaveCount(2);
  await expect(page.locator(".drive-photo-card img")).toHaveCount(2);
  expect(await page.locator(".drive-photo-card img").first().getAttribute("src")).toMatch(/^blob:/);
  expect(drive.folderCreates).toBe(2);
  expect(drive.uploads).toBe(2);
  expect(drive.mediaAuth.every(value => value === "Bearer SYNTHETIC_DRIVE_TOKEN")).toBe(true);
  expect(drive.files.filter(row => row.id?.toString().startsWith("photo-")).every(row => {
    const props = row.appProperties as Record<string,string>;
    return Boolean(props.attachment_id) && props.owner_type === "item" && props.owner_id === sampleItem.item_id;
  })).toBe(true);
  await page.reload();
  await page.getByRole("tab", { name: /照片/ }).click();
  await page.getByRole("button", { name: "連接私人 Google Drive" }).click();
  await expect(page.locator(".drive-photo-card img")).toHaveCount(2);
  expect(drive.folderCreates).toBe(2);
  expect(drive.uploads).toBe(2);
  await page.locator(".back-link").click();
  await page.locator(".item-card").filter({ hasText: "另一個事項" }).click();
  await page.getByRole("tab", { name: /照片/ }).click();
  await expect(page.getByText("這件事項尚無私人 Drive 照片")).toBeVisible();
  await expect(page.locator(".drive-photo-card")).toHaveCount(0);
  expect(await page.evaluate(() => Object.values(localStorage).concat(Object.values(sessionStorage)).join(" ")))
    .not.toContain("SYNTHETIC_DRIVE_TOKEN");
});
test("unknown upload outcome keeps attachment ID and blocks duplicate PUT", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page); await mockGoogleBridge(page);
  const drive = await fakeDrive(page);
  await open(page);
  drive.failUpload = true;
  await page.getByLabel("選取私人 Drive 照片").setInputFiles({ name: "待核對.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "上傳／核對選取的照片" }).click();
  await expect(page.getByRole("alert")).toContainText("結果尚未確認");
  expect(drive.uploads).toBe(1);
  await expect(page.getByText("已上傳並核對")).toHaveCount(0);
  const originalId = (drive.pending?.appProperties as Record<string,string>).attachment_id;
  await page.getByRole("button", { name: "上傳／核對選取的照片" }).click();
  await expect(page.getByRole("alert")).toContainText("前次上傳結果仍未確認");
  expect(drive.uploads).toBe(1);
  drive.files.push({ ...drive.pending!, id: "late-photo", createdTime: "2026-10-23T10:00:00Z", size: png.length });
  await page.getByRole("button", { name: "上傳／核對選取的照片" }).click();
  await expect(page.getByText("已上傳並核對")).toHaveCount(1);
  expect((drive.files.find(row => row.id === "late-photo")?.appProperties as Record<string,string>).attachment_id).toBe(originalId);
  expect(drive.uploads).toBe(1);
});
