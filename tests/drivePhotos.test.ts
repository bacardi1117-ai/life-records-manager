// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { DrivePhotosRepository, validateDrivePhoto, type DriveTransport } from "../src/api/drivePhotos";
import { DriveUploadError } from "../src/api/driveAuth";

const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
function file(name = "私密照片.png") { return new File([png], name, { type: "image/png" }); }
function response(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
}
function fakeDrive() {
  const files: Array<Record<string, unknown>> = [];
  let serial = 0, uploadCalls = 0, failUpload = false, failTrash = false;
  let metadata: Record<string, unknown> | null = null;
  const request = vi.fn(async (raw: string, init: RequestInit = {}) => {
    const url = new URL(raw), method = init.method ?? "GET";
    if (method === "POST" && url.pathname.startsWith("/upload/")) {
      metadata = JSON.parse(String(init.body));
      return response({}, 200, { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=test" });
    }
    if (method === "POST") {
      const body = JSON.parse(String(init.body));
      const row = { ...body, id: `folder-${++serial}`, createdTime: "2026-10-23T10:00:00Z" };
      files.push(row);
      return response(row);
    }
    if (method === "PATCH") {
      if (failTrash) return response({}, 503);
      const target = files.find(row => url.pathname.endsWith(`/${row.id}`));
      if (!target) return response({}, 404);
      target.trashed = true;
      return response({ id: target.id, trashed: true });
    }
    if (url.searchParams.has("alt")) return new Response(png, { headers: { "Content-Type": "image/png" } });
    const found = files.find(row => url.pathname.endsWith(`/${row.id}`));
    if (found) return response({ ...found, trashed: found.trashed ?? false });
    if (url.pathname !== "/drive/v3/files") return response({}, 404);
    const q = url.searchParams.get("q") ?? "";
    const rows = files.filter(row => {
      if (row.trashed === true) return false;
      if (q.includes("attachment_id")) {
        const match = q.match(/value='([^']+)'/);
        return (row.appProperties as Record<string,string>)?.attachment_id === match?.[1];
      }
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      if (parent && !(row.parents as string[])?.includes(parent)) return false;
      const name = q.match(/name = '([^']+)'/)?.[1];
      return !name || row.name === name;
    });
    return response({ files: rows });
  });
  const upload = vi.fn(async (_url: string, _file: File, progress: (value: number) => void) => {
    uploadCalls++;
    if (failUpload) throw new DriveUploadError("模擬不確定結果", true);
    progress(55);
    const row = { ...metadata!, id: `photo-${++serial}`, createdTime: "2026-10-23T12:00:00Z", size: png.length };
    files.push(row);
    return row;
  });
  return { files, request, upload, transport: { request, upload } as DriveTransport,
    fail: (value: boolean) => { failUpload = value; }, failTrash: (value: boolean) => { failTrash = value; }, calls: () => uploadCalls };
}
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); sessionStorage.clear(); });
it("accepts only matching JPG/PNG/WebP content and at most 10 MB", async () => {
  await expect(validateDrivePhoto(file())).resolves.toBeUndefined();
  await expect(validateDrivePhoto(new File([new Uint8Array([255,216,255,0])], "x.jpg", { type: "image/jpeg" }))).resolves.toBeUndefined();
  await expect(validateDrivePhoto(new File([new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80])], "x.webp", { type: "image/webp" }))).resolves.toBeUndefined();
  const maximum = new Uint8Array(10 * 1024 * 1024);
  maximum.set(png);
  await expect(validateDrivePhoto(new File([maximum], "max.png", { type: "image/png" }))).resolves.toBeUndefined();
  await expect(validateDrivePhoto(new File(["wrong"], "x.png", { type: "image/png" }))).rejects.toThrow("內容");
  await expect(validateDrivePhoto(new File(["x"], "x.pdf", { type: "application/pdf" }))).rejects.toThrow("僅支援");
  await expect(validateDrivePhoto(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "x.png", { type: "image/png" }))).rejects.toThrow("10 MB");
});
it("creates one private root and item folder, persists photos and separates item IDs", async () => {
  const drive = fakeDrive(), repo = new DrivePhotosRepository(drive.transport);
  const draft = await repo.prepare("item-one", file());
  const progress = vi.fn();
  const photo = await repo.uploadOne("item-one", file(), draft, progress);
  expect(progress).toHaveBeenCalledWith(55);
  expect(progress).toHaveBeenCalledWith(100);
  expect(photo).toMatchObject({ ownerId: "item-one", attachmentId: draft.attachmentId });
  expect(drive.files.filter(row => row.mimeType === "application/vnd.google-apps.folder")).toHaveLength(2);
  expect(await repo.list("item-one")).toHaveLength(1);
  expect(await repo.list("item-two")).toHaveLength(0);
  expect((await repo.readBlob(photo)).type).toBe("image/png");
  // New repository and cleared folder cache simulate reopening the site.
  sessionStorage.removeItem("life-records-manager:drive-folders:v1");
  const again = new DrivePhotosRepository(drive.transport);
  await again.uploadOne("item-one", file("second.png"), await again.prepare("item-one", file("second.png")), () => {});
  expect(drive.files.filter(row => row.mimeType === "application/vnd.google-apps.folder")).toHaveLength(2);
  expect(await again.list("item-one")).toHaveLength(2);
});
it("uncertain upload keeps its UUID, blocks duplicate send, then reconciles existing attachment", async () => {
  const drive = fakeDrive(), repo = new DrivePhotosRepository(drive.transport);
  const draft = await repo.prepare("item-one", file());
  drive.fail(true);
  await expect(repo.uploadOne("item-one", file(), draft, () => {})).rejects.toThrow("模擬不確定");
  expect((await repo.prepare("item-one", file())).attachmentId).toBe(draft.attachmentId);
  await expect(repo.uploadOne("item-one", file(), draft, () => {})).rejects.toThrow("未確認");
  expect(drive.calls()).toBe(1);
  drive.files.push({ id: "confirmed-photo", name: "私密照片.png", mimeType: "image/png",
    parents: ["folder-2"], createdTime: "2026-10-23T12:00:00Z", size: png.length,
    appProperties: { attachment_id: draft.attachmentId, owner_type: "item", owner_id: "item-one" } });
  expect((await repo.uploadOne("item-one", file(), draft, () => {})).id).toBe("confirmed-photo");
  expect(drive.calls()).toBe(1);
});
it("rechecks owner and attachment metadata before trashing only the selected Drive file", async () => {
  const drive = fakeDrive(), repo = new DrivePhotosRepository(drive.transport);
  const photo = await repo.uploadOne("item-one", file(), await repo.prepare("item-one", file()), () => {});
  await expect(repo.trash("item-two", photo)).rejects.toThrow("不屬於");
  const row = drive.files.find(value => value.id === photo.id)!;
  (row.appProperties as Record<string,string>).owner_id = "item-two";
  await expect(repo.trash("item-one", photo)).rejects.toThrow("所屬");
  (row.appProperties as Record<string,string>).owner_id = "item-one";
  (row.appProperties as Record<string,string>).attachment_id = "another-attachment";
  await expect(repo.trash("item-one", photo)).rejects.toThrow("識別碼");
  (row.appProperties as Record<string,string>).attachment_id = photo.attachmentId;
  drive.failTrash(true);
  await expect(repo.trash("item-one", photo)).rejects.toThrow("HTTP 503");
  expect(await repo.list("item-one")).toHaveLength(1);
  drive.failTrash(false);
  await repo.trash("item-one", photo);
  expect(row.trashed).toBe(true);
  expect(await repo.list("item-one")).toHaveLength(0);
  await repo.trash("item-one", photo); // Retry after a lost PATCH reply must not repeat the mutation.
  expect(drive.request.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2);
  expect(drive.request.mock.calls.some(([url, init]) => url.includes(photo.id) && init?.method === "DELETE")).toBe(false);
});
it("keeps record, other record and item attachments separate even when their IDs match", async () => {
  const drive = fakeDrive(), repo = new DrivePhotosRepository(drive.transport);
  const first = { type: "record" as const, id: "record-one" };
  const second = { type: "record" as const, id: "record-two" };
  const recordPhoto = await repo.uploadOne(first, file(), await repo.prepare(first, file()), () => {});
  const itemPhoto = await repo.uploadOne("record-one", file(), await repo.prepare("record-one", file()), () => {});
  expect(recordPhoto).toMatchObject({ ownerType: "record", ownerId: "record-one" });
  expect(itemPhoto).toMatchObject({ ownerType: "item", ownerId: "record-one" });
  expect(await repo.list(first)).toHaveLength(1);
  expect(await repo.list(second)).toHaveLength(0);
  expect(await repo.list("record-one")).toHaveLength(1);
  await expect(repo.trash(second, recordPhoto)).rejects.toThrow("不屬於");
  await expect(repo.trash("record-one", recordPhoto)).rejects.toThrow("不屬於");
  const row = drive.files.find(value => value.id === recordPhoto.id)!;
  (row.appProperties as Record<string,string>).owner_id = "record-two";
  await expect(repo.readBlob(recordPhoto)).rejects.toThrow("所屬");
  await expect(repo.trash(first, recordPhoto)).rejects.toThrow("所屬");
  (row.appProperties as Record<string,string>).owner_id = "record-one";
  await repo.trash(first, recordPhoto);
  expect(await repo.list(first)).toHaveLength(0);
  expect(await repo.list("record-one")).toHaveLength(1);
  sessionStorage.removeItem("life-records-manager:drive-folders:v1");
  expect(await new DrivePhotosRepository(drive.transport).list("record-one")).toHaveLength(1);
});
