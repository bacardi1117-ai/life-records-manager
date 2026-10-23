// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { DrivePhotosRepository, validateDrivePdf, validateDrivePhoto, type DriveTransport } from "../src/api/drivePhotos";
import { DriveUploadError } from "../src/api/driveAuth";

const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
function file(name = "私密照片.png") { return new File([png], name, { type: "image/png" }); }
const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
function pdfFile(name = "私人文件.pdf", bytes: Uint8Array = pdf) { return new File([bytes], name, { type: "application/pdf" }); }
function response(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
}
function fakeDrive() {
  const files: Array<Record<string, unknown>> = [];
  let serial = 0, uploadCalls = 0, failUpload = false, failTrash = false, resumeAt: number | null = null;
  const payloads = new Map<string, File>();
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
      const changes = JSON.parse(String(init.body));
      if (changes.appProperties) {
        const props = { ...(target.appProperties as Record<string,string>) };
        for (const [key, value] of Object.entries(changes.appProperties)) {
          if (value === null) delete props[key]; else props[key] = String(value);
        }
        target.appProperties = props;
        return response({ id: target.id, appProperties: props });
      }
      target.trashed = true;
      return response({ id: target.id, trashed: true });
    }
    if (method === "PUT" && url.pathname.startsWith("/upload/")) {
      if (resumeAt === null) return response({}, 503);
      return new Response(null, { status: 308, headers: { Range: `bytes=0-${resumeAt - 1}` } });
    }
    if (url.searchParams.has("alt")) {
      const uploaded = Array.from(payloads.entries()).find(([key]) => url.pathname.endsWith(`/${key}`))?.[1];
      return uploaded ? new Response(await uploaded.arrayBuffer(), { headers: { "Content-Type": uploaded.type } })
        : new Response(png, { headers: { "Content-Type": "image/png" } });
    }
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
      if (q.includes("life_records_cover")) return (row.appProperties as Record<string,string>)?.life_records_cover === "true";
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      if (parent && !(row.parents as string[])?.includes(parent)) return false;
      const name = q.match(/name = '([^']+)'/)?.[1];
      return !name || row.name === name;
    });
    return response({ files: rows });
  });
  const upload = vi.fn(async (_url: string, uploadedFile: File, progress: (value: number) => void) => {
    uploadCalls++;
    if (failUpload) throw new DriveUploadError("模擬不確定結果", true);
    progress(55);
    const row = { ...metadata!, id: `photo-${++serial}`, createdTime: "2026-10-23T12:00:00Z", size: uploadedFile.size };
    files.push(row);
    payloads.set(row.id, uploadedFile);
    return row;
  });
  const uploadRange = vi.fn(async (_url: string, uploadedFile: File, start: number, progress: (value: number) => void) => {
    if (start !== resumeAt) throw new Error("續傳位元組不符");
    progress(90);
    const row = { ...metadata!, id: `photo-${++serial}`, createdTime: "2026-10-23T12:00:00Z", size: uploadedFile.size };
    files.push(row); payloads.set(row.id, uploadedFile);
    return row;
  });
  return { files, request, upload, uploadRange, transport: { request, upload, uploadRange } as DriveTransport,
    fail: (value: boolean) => { failUpload = value; }, failTrash: (value: boolean) => { failTrash = value; },
    resume: (value: number | null) => { resumeAt = value; }, calls: () => uploadCalls };
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
it("marks one managed item photo as cover and rejects another item's photo", async () => {
  const drive = fakeDrive(), repo = new DrivePhotosRepository(drive.transport);
  const first = await repo.uploadOne("item-one", file("one.png"), await repo.prepare("item-one", file("one.png")), () => {});
  const secondFile = new File([new Uint8Array([...png, 1])], "two.png", { type: "image/png" });
  const second = await repo.uploadOne("item-one", secondFile, await repo.prepare("item-one", secondFile), () => {});
  await expect(repo.setCover("item-two", first)).rejects.toThrow("不屬於");
  await repo.setCover("item-one", first);
  expect((await repo.listCovers()).map(row => row.id)).toEqual([first.id]);
  await repo.setCover("item-one", second);
  expect((await repo.listCovers()).map(row => row.id)).toEqual([second.id]);
  await repo.trash("item-one", second);
  expect(await repo.listCovers()).toEqual([]);
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
it("validates PDF MIME, header and 20 MB limit without accepting PDFs as photos", async () => {
  await expect(validateDrivePdf(pdfFile())).resolves.toBeUndefined();
  const maximum = new Uint8Array(20 * 1024 * 1024); maximum.set(pdf);
  await expect(validateDrivePdf(pdfFile("最大.pdf", maximum))).resolves.toBeUndefined();
  await expect(validateDrivePdf(pdfFile("超過.pdf", new Uint8Array(20 * 1024 * 1024 + 1)))).rejects.toThrow("20 MB");
  await expect(validateDrivePdf(pdfFile("錯誤.pdf", new TextEncoder().encode("not a pdf")))).rejects.toThrow("內容");
  await expect(validateDrivePdf(new File([pdf], "x.txt", { type: "text/plain" }))).rejects.toThrow("僅支援 PDF");
  await expect(validateDrivePhoto(pdfFile())).rejects.toThrow("僅支援 JPG");
});
it("shares folders while isolating PDF and photo, item and record attachments", async () => {
  const drive = fakeDrive(), repo = new DrivePhotosRepository(drive.transport);
  const record = { type: "record" as const, id: "record-one" };
  const document = await repo.uploadPdf(record, pdfFile(), await repo.preparePdf(record, pdfFile()), () => {});
  await repo.uploadOne(record, file(), await repo.prepare(record, file()), () => {});
  await repo.uploadPdf("record-one", pdfFile(), await repo.preparePdf("record-one", pdfFile()), () => {});
  expect(document).toMatchObject({ mimeType: "application/pdf", ownerType: "record", ownerId: "record-one" });
  expect(await repo.listPdf(record)).toHaveLength(1);
  expect(await repo.list(record)).toHaveLength(1);
  expect(await repo.listPdf({ type: "record", id: "record-two" })).toHaveLength(0);
  expect(await repo.listPdf("record-one")).toHaveLength(1);
  expect((await repo.readPdf(document)).type).toBe("application/pdf");
  await expect(repo.trashPdf("record-one", document)).rejects.toThrow("不屬於");
  const row = drive.files.find(value => value.id === document.id)!;
  (row.appProperties as Record<string,string>).attachment_id = "wrong";
  await expect(repo.trashPdf(record, document)).rejects.toThrow("識別碼");
  (row.appProperties as Record<string,string>).attachment_id = document.attachmentId;
  await repo.trashPdf(record, document);
  expect(await repo.listPdf(record)).toHaveLength(0);
  expect(await repo.list(record)).toHaveLength(1);
  expect(await repo.listPdf("record-one")).toHaveLength(1);
});
it("queries the same resumable PDF session and resumes at Drive's confirmed byte", async () => {
  const drive = fakeDrive(), repo = new DrivePhotosRepository(drive.transport);
  const large = new Uint8Array(11 * 1024 * 1024); large.set(pdf);
  const documentFile = pdfFile("大檔.pdf", large);
  const pending = await repo.preparePdf("item-one", documentFile);
  drive.fail(true); drive.resume(256 * 1024);
  const progress = vi.fn();
  const result = await repo.uploadPdf("item-one", documentFile, pending, progress);
  expect(result.attachmentId).toBe(pending.attachmentId);
  expect(drive.uploadRange).toHaveBeenCalledWith(expect.any(String), documentFile, 256 * 1024, expect.any(Function));
  expect(drive.calls()).toBe(1);
  expect(progress).toHaveBeenCalledWith(100);
  expect(await repo.listPdf("item-one")).toHaveLength(1);
  expect((await repo.readPdf(result)).size).toBe(documentFile.size);
});
it("keeps the PDF UUID and blocks a second upload when session recovery is uncertain", async () => {
  const drive = fakeDrive(), repo = new DrivePhotosRepository(drive.transport);
  const pending = await repo.preparePdf("item-one", pdfFile());
  drive.fail(true);
  await expect(repo.uploadPdf("item-one", pdfFile(), pending, () => {})).rejects.toThrow("未確認");
  expect((await repo.preparePdf("item-one", pdfFile())).attachmentId).toBe(pending.attachmentId);
  await expect(repo.uploadPdf("item-one", pdfFile(), pending, () => {})).rejects.toThrow("未確認");
  expect(drive.calls()).toBe(1);
});
