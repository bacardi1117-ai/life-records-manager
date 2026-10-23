import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mockGoogleBridge, sampleItem, sampleRecord, TEST_WEB_APP } from "../fixtures/googleBridge";
const enabled = process.env.DRIVE_E2E_ENABLED === "true";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=", "base64");
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
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
    folderCreates: 0, uploads: 0, failUpload: false, failUploadAt: 0, failTrash: false, trashStatus: 0,
    failPdfMedia: false, failPdfFirst: false, resumeAt: 256 * 1024, statusQueries: 0,
    contents: new Map<string, Buffer>(), pendingBytes: null as Buffer | null, mediaAuth: [] as string[] };
  let serial = 0;
  await page.route("https://www.googleapis.com/**", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const fulfill = (body: unknown, status = 200, headers: Record<string,string> = {}) => route.fulfill({
      status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Location,Range", ...headers }, body: JSON.stringify(body),
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
      const range = request.headers()["content-range"] ?? "";
      if (range.startsWith("bytes */")) {
        state.statusQueries++;
        return fulfill({}, 308, { Range: `bytes=0-${state.resumeAt - 1}` });
      }
      state.uploads++;
      if (state.failPdfFirst && state.pending?.mimeType === "application/pdf") {
        state.failPdfFirst = false;
        state.pendingBytes = request.postDataBuffer();
        return route.abort("failed");
      }
      if (state.failUpload || state.failUploadAt === state.uploads) return route.abort("failed");
      const body = state.pendingBytes ?? request.postDataBuffer() ?? png;
      const total = Number(range.match(/\/(\d+)$/)?.[1] ?? body.length);
      const row = { ...state.pending!, id: `photo-${++serial}`, createdTime: "2026-10-23T10:00:00Z", size: total };
      state.files.push(row);
      state.contents.set(String(row.id), body);
      state.pendingBytes = null;
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
      if (request.postDataJSON()?.appProperties) {
        const changes = request.postDataJSON().appProperties as Record<string,string | null>;
        const props = { ...(row.appProperties as Record<string,string>) };
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) delete props[key]; else props[key] = value;
        }
        row.appProperties = props;
        return fulfill({ id: row.id, appProperties: props });
      }
      row.trashed = true;
      return fulfill({ id: row.id, trashed: true });
    }
    if (url.searchParams.get("alt") === "media") {
      state.mediaAuth.push(request.headers().authorization);
      const fileId = url.pathname.split("/").at(-1) ?? "";
      const row = state.files.find(file => file.id === fileId);
      if (state.failPdfMedia && row?.mimeType === "application/pdf") return fulfill({}, 503);
      return route.fulfill({
      status: 200, contentType: String(row?.mimeType ?? "image/png"), headers: { "Access-Control-Allow-Origin": "*" },
      body: state.contents.get(fileId) ?? png,
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
      if (q.includes("life_records_cover")) return (row.appProperties as Record<string,string>)?.life_records_cover === "true";
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
  await first.locator(".history-toggle").click();
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
  await second.locator(".history-toggle").click();
  await expect(second.getByText("這筆完成紀錄尚無私人 Drive 照片")).toBeVisible();
  await page.getByRole("tab", { name: /照片/ }).click();
  await expect(page.getByText("這件事項尚無私人 Drive 照片")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: /歷史紀錄/ }).click();
  const reloaded = page.locator(".cloud-history article").filter({ hasText: sampleRecord.title });
  await reloaded.locator(".history-toggle").click();
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
  await card.locator(".history-toggle").click();
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
  await card.locator(".history-toggle").click();
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
  await card.locator(".history-toggle").click();
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
  await restored.locator(".history-toggle").click();
  await restored.getByRole("button", { name: "連接私人 Google Drive" }).click();
  await expect(restored.locator(".drive-photo-card")).toHaveCount(1);
});
test("item PDFs upload in a batch beside photos, preview/download privately and reload", async ({ page }) => {
  test.skip(!enabled);
  await page.addInitScript(() => {
    const revoked: string[] = [];
    (window as unknown as { revokedPdfUrls: string[] }).revokedPdfUrls = revoked;
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = (value) => { revoked.push(value); original.call(URL, value); };
  });
  await fakeGis(page); await mockGoogleBridge(page); const drive = await fakeDrive(page);
  await open(page);
  await page.getByLabel("選取私人 Drive 照片").setInputFiles({ name: "設備.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "上傳／核對選取的照片" }).click();
  await page.getByLabel("選取私人 Drive PDF").setInputFiles([
    { name: "保固.pdf", mimeType: "application/pdf", buffer: pdf },
    { name: "說明.pdf", mimeType: "application/pdf", buffer: Buffer.concat([pdf, Buffer.from("other")]) },
  ]);
  await page.getByRole("button", { name: "上傳／核對選取的 PDF" }).click();
  await expect(page.locator(".drive-pdf-row")).toHaveCount(2);
  await expect(page.locator(".drive-photo-card")).toHaveCount(1);
  await expect(page.locator(".drive-pdf-row").first()).toContainText("MB");
  await expect(page.locator(".drive-pdf-row").first()).toContainText("建立於");
  const pdfFiles = drive.files.filter(row => row.mimeType === "application/pdf");
  expect(pdfFiles).toHaveLength(2);
  expect(pdfFiles.every(row => {
    const props = row.appProperties as Record<string,string>;
    return props.owner_type === "item" && props.owner_id === sampleItem.item_id && Boolean(props.attachment_id);
  })).toBe(true);
  await page.locator(".drive-pdf-row").filter({ hasText: "保固.pdf" }).getByRole("button", { name: "預覽" }).click();
  const dialog = page.getByRole("dialog", { name: "預覽 PDF：保固.pdf" });
  await expect(dialog.locator("iframe")).toHaveAttribute("src", /^blob:/);
  const blobUrl = await dialog.locator("iframe").getAttribute("src");
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "下載原始 PDF" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("保固.pdf");
  await dialog.getByRole("button", { name: "關閉" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { revokedPdfUrls: string[] }).revokedPdfUrls)).toContain(blobUrl);
  expect(drive.mediaAuth.every(value => value === "Bearer SYNTHETIC_DRIVE_TOKEN")).toBe(true);
  await page.reload();
  await page.getByRole("tab", { name: /照片/ }).click();
  await page.getByRole("button", { name: "連接私人 Google Drive" }).click();
  await expect(page.locator(".drive-pdf-row")).toHaveCount(2);
  await expect(page.locator(".drive-photo-card")).toHaveCount(1);
  expect(drive.folderCreates).toBe(2);
});
test("record PDFs remain separate from item and other record PDFs", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page); const backend = await mockGoogleBridge(page);
  backend.records.push(structuredClone(sampleRecord), { ...sampleRecord, record_id: "second-record", title: "第二次保養" });
  const drive = await fakeDrive(page);
  await openHistory(page);
  const first = page.locator(".cloud-history article").filter({ hasText: sampleRecord.title });
  await first.locator(".history-toggle").click();
  await first.getByRole("button", { name: "連接私人 Google Drive" }).click();
  await first.getByLabel("選取私人 Drive PDF").setInputFiles({ name: "維修單.pdf", mimeType: "application/pdf", buffer: pdf });
  await first.getByRole("button", { name: "上傳／核對選取的 PDF" }).click();
  await expect(first.locator(".drive-pdf-row")).toHaveCount(1);
  expect((drive.files.find(row => row.mimeType === "application/pdf")?.appProperties as Record<string,string>)).toMatchObject({
    owner_type: "record", owner_id: sampleRecord.record_id,
  });
  const second = page.locator(".cloud-history article").filter({ hasText: "第二次保養" });
  await second.locator(".history-toggle").click();
  await expect(second.getByText("尚無私人 PDF 文件")).toBeVisible();
  await page.getByRole("tab", { name: /照片/ }).click();
  await expect(page.getByText("尚無私人 PDF 文件")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: /歷史紀錄/ }).click();
  const reloaded = page.locator(".cloud-history article").filter({ hasText: sampleRecord.title });
  await reloaded.locator(".history-toggle").click();
  await reloaded.getByRole("button", { name: "連接私人 Google Drive" }).click();
  await expect(reloaded.locator(".drive-pdf-row")).toHaveCount(1);
});
test("large PDF uses the same resumable Drive session after an interrupted upload", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page); await mockGoogleBridge(page); const drive = await fakeDrive(page);
  drive.failPdfFirst = true;
  await open(page);
  const largePdf = Buffer.alloc(11 * 1024 * 1024);
  pdf.copy(largePdf);
  await page.getByLabel("選取私人 Drive PDF").setInputFiles({ name: "大型文件.pdf", mimeType: "application/pdf", buffer: largePdf });
  await page.getByRole("button", { name: "上傳／核對選取的 PDF" }).click();
  await expect(page.locator(".drive-pdf-row")).toHaveCount(1);
  expect(drive.statusQueries).toBeGreaterThanOrEqual(1);
  expect(drive.uploads).toBe(2);
  expect(drive.files.filter(row => row.mimeType === "application/pdf")).toHaveLength(1);
  await expect(page.locator(".drive-pdf-row")).toContainText("大型文件.pdf");
});
test("PDF trash confirms owner, preserves failed files, and never permanently deletes", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page); await mockGoogleBridge(page); const drive = await fakeDrive(page);
  await open(page);
  await page.getByLabel("選取私人 Drive PDF").setInputFiles({ name: "保留.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "上傳／核對選取的 PDF" }).click();
  await expect(page.locator(".drive-pdf-row")).toHaveCount(1);
  const row = drive.files.find(file => file.mimeType === "application/pdf")!;
  await page.locator(".drive-pdf-row").getByRole("button", { name: "刪除" }).click();
  await expect(page.getByRole("dialog", { name: "刪除私人 PDF" })).toContainText("保留.pdf");
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".drive-pdf-row")).toHaveCount(1);
  drive.failTrash = true;
  await page.locator(".drive-pdf-row").getByRole("button", { name: "刪除" }).click();
  await page.getByRole("button", { name: "確認移入垃圾桶" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("HTTP 503");
  await expect(page.locator(".drive-pdf-row")).toHaveCount(1);
  drive.failTrash = false;
  (row.appProperties as Record<string,string>).owner_id = "another-item";
  await page.getByRole("button", { name: "確認移入垃圾桶" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("所屬");
  expect(row.trashed).not.toBe(true);
  (row.appProperties as Record<string,string>).owner_id = sampleItem.item_id;
  await page.getByRole("button", { name: "確認移入垃圾桶" }).click();
  await expect(page.locator(".drive-pdf-row")).toHaveCount(0);
  expect(row.trashed).toBe(true);
});
test("PDF upload blocks unsaved Sheets items and OAuth expiry leaves documents intact", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page); const backend = await mockGoogleBridge(page); const drive = await fakeDrive(page);
  await open(page);
  backend.failGet = true;
  await page.getByLabel("選取私人 Drive PDF").setInputFiles({ name: "待儲存.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "上傳／核對選取的 PDF" }).click();
  await expect(page.locator(".drive-pdf-panel").getByRole("alert")).toContainText("模擬");
  expect(drive.uploads).toBe(0);
  backend.failGet = false;
  await page.getByRole("button", { name: "上傳／核對選取的 PDF" }).click();
  await expect(page.locator(".drive-pdf-row")).toHaveCount(1);
  drive.trashStatus = 401;
  await page.locator(".drive-pdf-row").getByRole("button", { name: "刪除" }).click();
  await page.getByRole("button", { name: "確認移入垃圾桶" }).click();
  await expect(page.getByText("Google Drive 授權已過期，請重新授權")).toBeVisible();
  expect(drive.files.find(row => row.mimeType === "application/pdf")?.trashed).not.toBe(true);
});
test("record PDF upload requires the saved Sheets record", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page); const backend = await mockGoogleBridge(page);
  backend.records.push(structuredClone(sampleRecord));
  const drive = await fakeDrive(page);
  await openHistory(page);
  const card = page.locator(".cloud-history article").filter({ hasText: sampleRecord.title });
  await card.locator(".history-toggle").click();
  await card.getByRole("button", { name: "連接私人 Google Drive" }).click();
  backend.records.length = 0;
  await card.getByLabel("選取私人 Drive PDF").setInputFiles({ name: "未儲存.pdf", mimeType: "application/pdf", buffer: pdf });
  await card.getByRole("button", { name: "上傳／核對選取的 PDF" }).click();
  await expect(card.locator(".drive-pdf-panel").getByRole("alert")).toContainText("紀錄");
  expect(drive.uploads).toBe(0);
  expect(drive.files.filter(row => row.mimeType === "application/pdf")).toHaveLength(0);
});
test("PDF preview failure reports an error and keeps private download available", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page); await mockGoogleBridge(page); const drive = await fakeDrive(page);
  await open(page);
  await page.getByLabel("選取私人 Drive PDF").setInputFiles({ name: "故障後下載.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "上傳／核對選取的 PDF" }).click();
  await expect(page.locator(".drive-pdf-row")).toHaveCount(1);
  drive.failPdfMedia = true;
  await page.locator(".drive-pdf-row").getByRole("button", { name: "預覽" }).click();
  const dialog = page.getByRole("dialog", { name: "預覽 PDF：故障後下載.pdf" });
  await expect(dialog.getByRole("alert")).toContainText("HTTP 503");
  await expect(dialog.locator("iframe")).toHaveCount(0);
  drive.failPdfMedia = false;
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "下載原始 PDF" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("故障後下載.pdf");
  expect(drive.mediaAuth.every(value => value === "Bearer SYNTHETIC_DRIVE_TOKEN")).toBe(true);
});
test("Mock mode never shows private PDF controls or calls Drive", async ({ page }) => {
  let requests = 0;
  await page.route("https://www.googleapis.com/**", route => { requests++; return route.abort(); });
  await page.goto("./#/items/water-heater");
  await page.getByRole("tab", { name: /照片/ }).click();
  await expect(page.getByLabel("選取私人 Drive PDF")).toHaveCount(0);
  expect(requests).toBe(0);
});
test("selected private item cover appears on home and falls back after trash", async ({ page }) => {
  test.skip(!enabled);
  await fakeGis(page);
  await mockGoogleBridge(page);
  const drive = await fakeDrive(page);
  await open(page);
  await page.getByLabel("選取私人 Drive 照片").setInputFiles({name:"封面.png",mimeType:"image/png",buffer:png});
  await page.getByRole("button", {name:"上傳／核對選取的照片"}).click();
  await expect(page.locator(".drive-photo-card")).toHaveCount(1);
  await page.getByRole("button", {name:"設為封面"}).click();
  await expect(page.getByRole("button", {name:"目前封面"})).toBeDisabled();
  await page.getByRole("link", {name:"所有生活事項"}).click();
  await page.locator(".item-card").scrollIntoViewIfNeeded();
  await expect(page.locator(".item-card .dashboard-cover-image img")).toBeVisible();
  expect((await page.locator(".item-card .dashboard-cover-image img").getAttribute("src"))?.startsWith("blob:")).toBe(true);
  await page.locator(".item-card").click();
  await page.getByRole("tab", {name:/照片/}).click();
  await page.getByRole("button", {name:"取消 Google Drive 授權"}).click();
  await page.getByRole("link", {name:"所有生活事項"}).click();
  await expect(page.locator(".item-card .dashboard-cover-image img")).toHaveCount(0);
  await page.locator(".item-card").click();
  await page.getByRole("tab", {name:/照片/}).click();
  await page.getByRole("button", {name:"重新授權 Google Drive"}).click();
  await expect(page.locator(".drive-photo-card")).toHaveCount(1);
  await page.locator(".drive-photo-card").getByRole("button", {name:"刪除"}).click();
  await page.getByRole("button", {name:"確認移入垃圾桶"}).click();
  await page.getByRole("link", {name:"所有生活事項"}).click();
  await expect(page.locator(".item-card .dashboard-cover-image img")).toHaveCount(0);
  expect(drive.files.filter(row => (row.appProperties as Record<string,string>)?.life_records_cover === "true" && !row.trashed)).toHaveLength(0);
});
