import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mockGoogleBridge, sampleItem, sampleRecord, TEST_WEB_APP } from "../fixtures/googleBridge";
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
async function openHistory(page: Page) {
  await page.goto("./#/settings");
  await page.getByLabel("Web App /exec URL").fill(TEST_WEB_APP);
  await page.getByRole("button", { name: "連線並使用 Google Sheets" }).click();
  await page.getByRole("link", { name: "返回生活事項首頁" }).click();
  await page.locator(".item-card").filter({ hasText: sampleItem.name }).click();
  await page.getByRole("tab", { name: /歷史紀錄/ }).click();
}
async function fakeDrive(page: Page) {
  const state = { files: [] as Array<Record<string, unknown>>, pending: null as Record<string, unknown> | null,
    folderCreates: 0, uploads: 0, failUpload: false, failUploadAt: 0, failTrash: false, trashStatus: 0, mediaAuth: [] as string[] };
  let serial = 0;
  await page.route("https://www.googleapis.com/**", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const fulfill = (body: unknown, status = 200, headers: Record<string,string> = {}) => route.fulfill({
      status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Location", ...headers }, body: JSON.stringify(body),
    });
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: {
      "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type,Content-Range,X-Upload-Content-Length,X-Upload-Content-Type",
    }});
    if (url.pathname.startsWith("/upload/drive/v3/files") && method === "POST") {
      state.pending = JSON.parse(request.postData()!);
      return fulfill({}, 200, { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic" });
    }
    if (url.pathname.startsWith("/upload/drive/v3/files") && method === "PUT") {
      state.uploads++;
      if (state.failUpload || state.failUploadAt === state.uploads) return route.abort("failed");
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
    if (method === "PATCH") {
      if (state.trashStatus) return fulfill({}, state.trashStatus);
      if (state.failTrash) return fulfill({}, 503);
      const row = state.files.find(value => url.pathname.endsWith(`/${value.id}`));
      if (!row) return fulfill({}, 404);
      row.trashed = true;
      return fulfill({ id: row.id, trashed: true });
    }
    if (url.searchParams.get("alt") === "media") {
      state.mediaAuth.push(request.headers().authorization);
      return route.fulfill({
      status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: png,
    });
    }
    const found = state.files.find(row => url.pathname.endsWith(`/${row.id}`));
    if (found) return fulfill({ ...found, trashed: found.trashed ?? false });
    if (url.pathname !== "/drive/v3/files") return fulfill({}, 404);
    const q = url.searchParams.get("q") ?? "";
    const rows = state.files.filter(row => {
      if (row.trashed === true) return false;
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
test("opens private photos, switches by buttons and swipe, and closes by Escape", async ({ page }, testInfo) => {
  test.skip(!enabled);
  await fakeGis(page); await mockGoogleBridge(page); const drive = await fakeDrive(page);
  await open(page);
  await page.getByLabel("選取私人 Drive 照片").setInputFiles([
    { name: "第一張.png", mimeType: "image/png", buffer: png },
    { name: "第二張.png", mimeType: "image/png", buffer: Buffer.concat([png, Buffer.from([1])]) },
  ]);
  await page.getByRole("button", { name: "上傳／核對選取的照片" }).click();
  await expect(page.locator(".drive-photo-card")).toHaveCount(2);
  await page.getByRole("button", { name: "放大預覽 第一張.png" }).click();
  const dialog = page.getByRole("dialog", { name: "照片放大預覽" });
  await expect(dialog).toContainText("第一張.png · 1 / 2");
  await expect(dialog.locator("img")).toHaveAttribute("src", /^blob:/);
  await dialog.getByRole("button", { name: "上一張" }).click();
  await expect(dialog).toContainText("第二張.png · 2 / 2");
  if (testInfo.project.name === "mobile") {
    const box = await dialog.locator(".drive-photo-viewer").boundingBox();
    if (box) {
      await page.evaluate(({ x, y }) => {
        const element = document.querySelector(".drive-photo-viewer")!;
        element.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [new Touch({ identifier: 1, target: element, clientX: x + 100, clientY: y + 30 })] }));
        element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [new Touch({ identifier: 1, target: element, clientX: x + 10, clientY: y + 30 })] }));
      }, { x: box.x, y: box.y });
      await expect(dialog).toContainText("第一張.png · 1 / 2");
    }
  } else {
    await dialog.getByRole("button", { name: "下一張" }).click();
    await expect(dialog).toContainText("第一張.png · 1 / 2");
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(drive.mediaAuth.every(value => value === "Bearer SYNTHETIC_DRIVE_TOKEN")).toBe(true);
});
test("confirms trash, leaves failed operations visible, and rechecks owner metadata", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page); await mockGoogleBridge(page); const drive = await fakeDrive(page);
  await open(page);
  await page.getByLabel("選取私人 Drive 照片").setInputFiles({ name: "要刪除.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "上傳／核對選取的照片" }).click();
  await expect(page.locator(".drive-photo-card")).toHaveCount(1);
  await page.locator(".drive-photo-card").getByRole("button", { name: "刪除", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "刪除私人照片" })).toContainText("要刪除.png");
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".drive-photo-card")).toHaveCount(1);
  drive.failTrash = true;
  await page.locator(".drive-photo-card").getByRole("button", { name: "刪除", exact: true }).click();
  await page.getByRole("button", { name: "確認移入垃圾桶" }).click();
  await expect(page.getByRole("alert")).toContainText("HTTP 503");
  await expect(page.locator(".drive-photo-card")).toHaveCount(1);
  drive.failTrash = false;
  const row = drive.files.find(value => String(value.id).startsWith("photo-"))!;
  (row.appProperties as Record<string,string>).owner_id = "other-item";
  await page.getByRole("button", { name: "確認移入垃圾桶" }).click();
  await expect(page.getByRole("alert")).toContainText("所屬資料");
  expect(row.trashed).not.toBe(true);
  (row.appProperties as Record<string,string>).owner_id = sampleItem.item_id;
  await page.getByRole("button", { name: "確認移入垃圾桶" }).click();
  await expect(page.locator(".drive-photo-card")).toHaveCount(0);
  expect(row.trashed).toBe(true);
});
test("replaces only after new photo is readable and retries partial completion without another upload", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page); await mockGoogleBridge(page); const drive = await fakeDrive(page);
  await open(page);
  await page.getByLabel("選取私人 Drive 照片").setInputFiles({ name: "原照片.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "上傳／核對選取的照片" }).click();
  await expect(page.locator(".drive-photo-card")).toHaveCount(1);
  const old = drive.files.find(value => String(value.id).startsWith("photo-"))!;
  await page.locator(".drive-photo-card").getByRole("button", { name: "更換" }).click();
  const dialog = page.getByRole("dialog", { name: "更換私人照片" });
  await dialog.getByLabel("選取更換照片").setInputFiles({ name: "新照片.png", mimeType: "image/png", buffer: Buffer.concat([png, Buffer.from([2])]) });
  await expect(dialog.getByRole("button", { name: "上傳新照片並更換" })).toBeEnabled();
  drive.failUpload = true;
  await dialog.getByRole("button", { name: "上傳新照片並更換" }).click();
  await expect(dialog.getByRole("alert")).toContainText("結果尚未確認");
  expect(old.trashed).not.toBe(true);
  drive.failUpload = false;
  // An uncertain PUT may have created the file. Reconcile the same attachment ID before retrying.
  drive.files.push({ ...drive.pending!, id: "late-replacement", createdTime: "2026-10-23T10:00:00Z", size: png.length });
  drive.failTrash = true;
  await dialog.getByRole("button", { name: "上傳新照片並更換" }).click();
  await expect(dialog.getByRole("alert")).toContainText("部分完成");
  expect(drive.uploads).toBe(2);
  expect(old.trashed).not.toBe(true);
  drive.failTrash = false;
  await dialog.getByRole("button", { name: "核對並完成更換" }).click();
  await expect(dialog).toHaveCount(0);
  expect(drive.uploads).toBe(2);
  expect(old.trashed).toBe(true);
  await expect(page.locator(".drive-photo-card")).toHaveCount(1);
  await expect(page.locator(".drive-photo-card")).toContainText("新照片.png");
});
test("expired token during trash stops the operation and offers reauthorization", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page); await mockGoogleBridge(page); const drive = await fakeDrive(page);
  await open(page);
  await page.getByLabel("選取私人 Drive 照片").setInputFiles({ name: "保留.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "上傳／核對選取的照片" }).click();
  await expect(page.locator(".drive-photo-card")).toHaveCount(1);
  drive.trashStatus = 401;
  await page.locator(".drive-photo-card").getByRole("button", { name: "刪除", exact: true }).click();
  await page.getByRole("button", { name: "確認移入垃圾桶" }).click();
  await expect(page.getByText("Google Drive 授權已過期，請重新授權")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新授權 Google Drive" })).toBeVisible();
  expect(drive.files.find(row => String(row.id).startsWith("photo-"))?.trashed).not.toBe(true);
});
test("Mock photo tab never calls Google Drive", async ({ page }) => {
  let requests = 0;
  await page.route("https://www.googleapis.com/**", route => { requests++; return route.abort(); });
  await page.goto("./#/items/water-heater");
  await page.getByRole("tab", { name: /照片/ }).click();
  await expect(page.getByRole("heading", { name: "照片與憑證" })).toBeVisible();
  await expect(page.getByText("私人 Google Drive", { exact: true })).toHaveCount(0);
  expect(requests).toBe(0);
});
test("record photos use record ownership and stay separate from other records and item photos after reload", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page);
  const backend = await mockGoogleBridge(page);
  backend.records.push(structuredClone(sampleRecord), { ...sampleRecord, record_id: "second-record", title: "第二次保養" });
  const drive = await fakeDrive(page);
  await openHistory(page);
  const first = page.locator(".cloud-history article").filter({ hasText: sampleRecord.title });
  await first.getByRole("button", { name: "查看照片／上傳" }).click();
  await first.getByRole("button", { name: "連接私人 Google Drive" }).click();
  await first.getByLabel("選取私人 Drive 照片").setInputFiles([
    { name: "保養一.png", mimeType: "image/png", buffer: png },
    { name: "保養二.png", mimeType: "image/png", buffer: Buffer.concat([png, Buffer.from([1])]) },
  ]);
  await first.getByRole("button", { name: "上傳／核對選取的照片" }).click();
  await expect(first.locator(".drive-photo-card")).toHaveCount(2);
  expect(drive.files.filter(row => String(row.id).startsWith("photo-")).every(row => {
    const props = row.appProperties as Record<string,string>;
    return props.owner_type === "record" && props.owner_id === sampleRecord.record_id && Boolean(props.attachment_id);
  })).toBe(true);
  const second = page.locator(".cloud-history article").filter({ hasText: "第二次保養" });
  await second.getByRole("button", { name: "查看照片／上傳" }).click();
  await expect(second.getByText("這筆完成紀錄尚無私人 Drive 照片")).toBeVisible();
  await page.getByRole("tab", { name: /照片/ }).click();
  await expect(page.getByText("這件事項尚無私人 Drive 照片")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: /歷史紀錄/ }).click();
  const reloaded = page.locator(".cloud-history article").filter({ hasText: sampleRecord.title });
  await reloaded.getByRole("button", { name: "查看照片／上傳" }).click();
  await reloaded.getByRole("button", { name: "連接私人 Google Drive" }).click();
  await expect(reloaded.locator(".drive-photo-card img")).toHaveCount(2);
  expect(drive.folderCreates).toBe(2);
  expect(drive.mediaAuth.every(value => value === "Bearer SYNTHETIC_DRIVE_TOKEN")).toBe(true);
});
test("record photos can be previewed, replaced and moved to trash with partial failure recovery", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page);
  const backend = await mockGoogleBridge(page);
  backend.records.push(structuredClone(sampleRecord));
  const drive = await fakeDrive(page);
  await openHistory(page);
  const card = page.locator(".cloud-history article").filter({ hasText: sampleRecord.title });
  await card.getByRole("button", { name: "查看照片／上傳" }).click();
  await card.getByRole("button", { name: "連接私人 Google Drive" }).click();
  await card.getByLabel("選取私人 Drive 照片").setInputFiles({ name: "舊照片.png", mimeType: "image/png", buffer: png });
  await card.getByRole("button", { name: "上傳／核對選取的照片" }).click();
  await card.getByRole("button", { name: "放大預覽 舊照片.png" }).click();
  await expect(page.getByRole("dialog", { name: "照片放大預覽" }).locator("img")).toHaveAttribute("src", /^blob:/);
  await page.keyboard.press("Escape");
  const old = drive.files.find(row => String(row.id).startsWith("photo-"))!;
  await card.locator(".drive-photo-card").getByRole("button", { name: "更換", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "更換私人照片" });
  await dialog.getByLabel("選取更換照片").setInputFiles({ name: "新照片.png", mimeType: "image/png", buffer: Buffer.concat([png, Buffer.from([2])]) });
  drive.failTrash = true;
  await dialog.getByRole("button", { name: "上傳新照片並更換" }).click();
  await expect(dialog.getByRole("alert")).toContainText("部分完成");
  expect(old.trashed).not.toBe(true);
  const uploadCount = drive.uploads;
  drive.failTrash = false;
  await dialog.getByRole("button", { name: "核對並完成更換" }).click();
  await expect(dialog).toHaveCount(0);
  expect(drive.uploads).toBe(uploadCount);
  expect(old.trashed).toBe(true);
  await expect(card.locator(".drive-photo-card")).toContainText("新照片.png");
  await card.locator(".drive-photo-card").getByRole("button", { name: "刪除", exact: true }).click();
  await page.getByRole("button", { name: "確認移入垃圾桶" }).click();
  await expect(card.locator(".drive-photo-card")).toHaveCount(0);
  expect(drive.files.filter(row => String(row.id).startsWith("photo-")).every(row => row.trashed === true)).toBe(true);
});
test("record photo upload stops if Sheets cannot confirm the saved record", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page);
  const backend = await mockGoogleBridge(page);
  backend.records.push(structuredClone(sampleRecord));
  const drive = await fakeDrive(page);
  await openHistory(page);
  const card = page.locator(".cloud-history article").filter({ hasText: sampleRecord.title });
  await card.getByRole("button", { name: "查看照片／上傳" }).click();
  await card.getByRole("button", { name: "連接私人 Google Drive" }).click();
  backend.records.length = 0; // The visible row is stale; the backend no longer confirms it.
  await card.getByLabel("選取私人 Drive 照片").setInputFiles({ name: "不可上傳.png", mimeType: "image/png", buffer: png });
  await card.getByRole("button", { name: "上傳／核對選取的照片" }).click();
  await expect(card.getByRole("alert")).toContainText("Google Sheets 未確認此完成紀錄");
  expect(drive.uploads).toBe(0);
  expect(drive.files.filter(row => String(row.id).startsWith("photo-"))).toHaveLength(0);
});
test("a failed photo in a record batch keeps previously uploaded private photos", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page);
  const backend = await mockGoogleBridge(page);
  backend.records.push(structuredClone(sampleRecord));
  const drive = await fakeDrive(page);
  drive.failUploadAt = 2;
  await openHistory(page);
  const card = page.locator(".cloud-history article").filter({ hasText: sampleRecord.title });
  await card.getByRole("button", { name: "查看照片／上傳" }).click();
  await card.getByRole("button", { name: "連接私人 Google Drive" }).click();
  await card.getByLabel("選取私人 Drive 照片").setInputFiles([
    { name: "成功.png", mimeType: "image/png", buffer: png },
    { name: "失敗.png", mimeType: "image/png", buffer: Buffer.concat([png, Buffer.from([9])]) },
  ]);
  await card.getByRole("button", { name: "上傳／核對選取的照片" }).click();
  await expect(card.locator(".drive-photo-card")).toHaveCount(1);
  await expect(card.getByRole("alert")).toContainText("結果尚未確認");
  expect(drive.files.filter(row => String(row.id).startsWith("photo-"))).toHaveLength(1);
  await page.reload();
  await page.getByRole("tab", { name: /歷史紀錄/ }).click();
  const restored = page.locator(".cloud-history article").filter({ hasText: sampleRecord.title });
  await restored.getByRole("button", { name: "查看照片／上傳" }).click();
  await restored.getByRole("button", { name: "連接私人 Google Drive" }).click();
  await expect(restored.locator(".drive-photo-card")).toHaveCount(1);
});
