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
  let serial = 0, uploadCalls = 0, failUpload = false;
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
    if (url.searchParams.has("alt")) return new Response(png, { headers: { "Content-Type": "image/png" } });
    const found = files.find(row => url.pathname.endsWith(`/${row.id}`));
    if (found) return response(found);
    if (url.pathname !== "/drive/v3/files") return response({}, 404);
    const q = url.searchParams.get("q") ?? "";
    const rows = files.filter(row => {
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
    fail: (value: boolean) => { failUpload = value; }, calls: () => uploadCalls };
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
