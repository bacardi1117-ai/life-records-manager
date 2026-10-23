import { DriveUploadError, driveAuth } from "./driveAuth";

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,parents,appProperties,createdTime,size";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_NAME = "日日有序 Life Records";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const PDF_MIME = "application/pdf";
type AttachmentKind = "photo" | "pdf";
const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const FOLDER_KEY = "life-records-manager:drive-folders:v1";
const PENDING_KEY = "life-records-manager:drive-pending:v1";
export interface DrivePhoto {
  id: string;
  name: string;
  mimeType: string;
  ownerId: string;
  ownerType: "item" | "record";
  attachmentId: string;
  createdTime: string;
  size: number;
  isCover?: boolean;
}
export type DrivePdf = DrivePhoto;
export interface PhotoOwner { type: "item" | "record"; id: string }
type OwnerArg = string | PhotoOwner;
function owner(value: OwnerArg): PhotoOwner {
  const result = typeof value === "string" ? { type: "item" as const, id: value } : value;
  if ((result.type !== "item" && result.type !== "record") || !result.id?.trim())
    throw new Error("Drive 照片擁有者格式錯誤");
  return result;
}
export interface PendingPhoto { key: string; attachmentId: string; uncertain: boolean }
export interface DriveTransport {
  request(url: string, init?: RequestInit): Promise<Response>;
  upload(url: string, file: File, onProgress: (percent: number) => void): Promise<unknown>;
  uploadRange?: (url: string, file: File, start: number, onProgress: (percent: number) => void) => Promise<unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Google Drive 識別碼格式錯誤");
  return value;
}
function quote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
function parseAttachment(value: unknown, expected: PhotoOwner, kind: AttachmentKind): DrivePhoto {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Drive 照片資料格式錯誤");
  const row = value as Record<string, unknown>;
  const props = row.appProperties as Record<string, unknown> | undefined;
  if (!props || props.owner_type !== expected.type || props.owner_id !== expected.id ||
      typeof props.attachment_id !== "string" || !props.attachment_id ||
      typeof row.name !== "string" || !(kind === "pdf" ? row.mimeType === PDF_MIME : PHOTO_MIMES.has(String(row.mimeType))))
    throw new Error("Drive 附件所屬資料或格式不符");
  return { id: id(row.id), name: row.name, mimeType: String(row.mimeType),
    ownerId: expected.id, ownerType: expected.type, attachmentId: props.attachment_id, createdTime: String(row.createdTime ?? ""),
    size: Number(row.size ?? 0), isCover: props.life_records_cover === "true" };
}
function readMap<T>(key: string): Record<string, T> {
  const raw = sessionStorage.getItem(key);
  if (!raw) return {};
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Drive 本機工作階段資料格式錯誤");
  return data as Record<string, T>;
}
function writeMap<T>(key: string, value: Record<string, T>) { sessionStorage.setItem(key, JSON.stringify(value)); }
async function json(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`Google Drive API 回應 HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Google Drive API 回傳格式錯誤");
  return data as Record<string, unknown>;
}
export async function validateDrivePhoto(file: File): Promise<void> {
  if (file.size <= 0 || file.size > MAX_BYTES) throw new Error("照片檔案須小於或等於 10 MB");
  if (!PHOTO_MIMES.has(file.type)) throw new Error("僅支援 JPG、PNG、WebP 照片");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const matches = file.type === "image/jpeg"
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : file.type === "image/png"
      ? [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
      : bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!matches) throw new Error("照片內容與 JPG、PNG、WebP 格式不符");
}
export async function validateDrivePdf(file: File): Promise<void> {
  if (file.size <= 0 || file.size > MAX_PDF_BYTES) throw new Error("PDF 文件須小於或等於 20 MB");
  if (file.type !== PDF_MIME) throw new Error("僅支援 PDF 文件");
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...header) !== "%PDF-") throw new Error("PDF 文件內容格式不符");
}
async function validateAttachment(file: File, kind: AttachmentKind) {
  if (kind === "pdf") await validateDrivePdf(file);
  else await validateDrivePhoto(file);
}
export class DrivePhotosRepository {
  private folderPromises = new Map<string, Promise<string>>();
  constructor(private transport: DriveTransport) {}
  private async listRaw(q: string): Promise<Record<string, unknown>[]> {
    const files: Record<string, unknown>[] = [];
    let pageToken = "";
    do {
      const url = new URL(API);
      url.searchParams.set("q", q);
      url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,parents,appProperties,createdTime,size)");
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = await json(await this.transport.request(url.href));
      if (!Array.isArray(data.files)) throw new Error("Google Drive 清單格式錯誤");
      files.push(...data.files as Record<string, unknown>[]);
      pageToken = typeof data.nextPageToken === "string" ? data.nextPageToken : "";
    } while (pageToken);
    return files;
  }
  private async folder(parentId: string, name: string, cacheKey: string, role: "root" | "item" | "record", ownerId = "", create = false): Promise<string | null> {
    const cache = readMap<string>(FOLDER_KEY);
    const cached = cache[cacheKey];
    if (cached) {
      try {
        const response = await this.transport.request(`${API}/${encodeURIComponent(cached)}?fields=id,name,mimeType,parents,appProperties`);
        if (response.ok) {
          const value = await json(response);
          const props = value.appProperties as Record<string, unknown> | undefined;
          if (value.id === cached && value.name === name && value.mimeType === FOLDER_MIME &&
              Array.isArray(value.parents) && (parentId === "root" || value.parents.includes(parentId)) &&
              props?.life_records_role === role && (role === "root" ||
                (props?.owner_type === role && props?.owner_id === ownerId))) return cached;
        }
      } catch { /* Recheck by query before creating. */ }
      delete cache[cacheKey]; writeMap(FOLDER_KEY, cache);
    }
    const matches = await this.listRaw(`name = ${quote(name)} and mimeType = ${quote(FOLDER_MIME)} and ${quote(parentId)} in parents and trashed = false`);
    const existing = matches.find(row => {
      const props = row.appProperties as Record<string, unknown> | undefined;
      return props?.life_records_role === role && (role === "root" ||
        (props.owner_type === role && props.owner_id === ownerId));
    });
    if (existing) {
      const found = id(existing.id);
      writeMap(FOLDER_KEY, { ...readMap<string>(FOLDER_KEY), [cacheKey]: found });
      return found;
    }
    if (!create) return null;
    const props: Record<string, string> = { life_records_role: role };
    if (role !== "root") { props.owner_type = role; props.owner_id = ownerId; }
    const value = await json(await this.transport.request(`${API}?fields=id,name,mimeType,parents,appProperties`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId], appProperties: props }),
    }));
    const folderId = id(value.id);
    writeMap(FOLDER_KEY, { ...readMap<string>(FOLDER_KEY), [cacheKey]: folderId });
    return folderId;
  }
  private async ownerFolder(value: PhotoOwner, create: boolean): Promise<string | null> {
    const root = await this.folder("root", ROOT_NAME, "root", "root", "", create);
    if (!root) return null;
    const name = value.type === "item" ? value.id : `record-${value.id}`;
    return this.folder(root, name, `${value.type}:${value.id}`, value.type, value.id, create);
  }
  private async ensureOwnerFolder(value: PhotoOwner): Promise<string> {
    const key = `${value.type}:${value.id}`;
    const existing = this.folderPromises.get(key);
    if (existing) return existing;
    const promise = this.ownerFolder(value, true).then(found => id(found));
    this.folderPromises.set(key, promise);
    try { return await promise; } finally { this.folderPromises.delete(key); }
  }
  private async listKind(value: OwnerArg, kind: AttachmentKind): Promise<DrivePhoto[]> {
    const expected = owner(value);
    const folderId = await this.ownerFolder(expected, false);
    if (!folderId) return [];
    const rows = await this.listRaw(`${quote(folderId)} in parents and trashed = false`);
    return rows.filter(row => {
      const props = row.appProperties as Record<string, unknown> | undefined;
      return props?.owner_type === expected.type && props.owner_id === expected.id &&
        (kind === "pdf" ? row.mimeType === PDF_MIME : PHOTO_MIMES.has(String(row.mimeType)));
    }).map(row => parseAttachment(row, expected, kind))
      .sort((a,b) => b.createdTime.localeCompare(a.createdTime));
  }
  async list(value: OwnerArg): Promise<DrivePhoto[]> { return this.listKind(value, "photo"); }
  async setCover(value: OwnerArg, photo: DrivePhoto): Promise<void> {
    const expected = owner(value);
    if (expected.type !== "item" || !await this.verifyManaged(expected, photo))
      throw new Error("封面照片不屬於目前生活事項");
    const covers = (await this.list(expected)).filter(row => row.isCover && row.id !== photo.id);
    const patch = async (target: DrivePhoto, cover: boolean) => {
      const result = await json(await this.transport.request(`${API}/${encodeURIComponent(target.id)}?fields=id,appProperties`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appProperties: { life_records_cover: cover ? "true" : null } }),
      }));
      const actual = (result.appProperties as Record<string, unknown> | undefined)?.life_records_cover;
      if (result.id !== target.id || (cover ? actual !== "true" : actual != null))
        throw new Error("無法確認封面設定，請重新讀取 Drive 照片");
    };
    await patch(photo, true);
    for (const previous of covers) {
      if (!await this.verifyManaged(expected, previous)) continue;
      await patch(previous, false);
    }
  }
  async listPdf(value: OwnerArg): Promise<DrivePdf[]> { return this.listKind(value, "pdf"); }
  private async findAttachmentKind(value: OwnerArg, attachmentId: string, kind: AttachmentKind): Promise<DrivePhoto | null> {
    const expected = owner(value);
    const rows = await this.listRaw(`appProperties has { key='attachment_id' and value=${quote(id(attachmentId))} } and trashed = false`);
    if (!rows.length) return null;
    const row = parseAttachment(rows[0], expected, kind);
    if (rows.length > 1) throw new Error("相同附件識別碼出現多筆，已停止上傳");
    return row;
  }
  async findAttachment(value: OwnerArg, attachmentId: string): Promise<DrivePhoto | null> {
    return this.findAttachmentKind(value, attachmentId, "photo");
  }
  async findPdfAttachment(value: OwnerArg, attachmentId: string): Promise<DrivePdf | null> {
    return this.findAttachmentKind(value, attachmentId, "pdf");
  }
  private async prepareKind(value: OwnerArg, file: File, kind: AttachmentKind): Promise<PendingPhoto> {
    const expected = owner(value);
    await validateAttachment(file, kind);
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const key = `${kind === "pdf" ? "pdf:" : ""}${expected.type === "item" ? "" : "record:"}${expected.id}:${hash}`;
    const pending = readMap<{attachmentId: string; uncertain: boolean}>(PENDING_KEY);
    const current = pending[key];
    if (current) return { key, attachmentId: id(current.attachmentId), uncertain: Boolean(current.uncertain) };
    const result = { key, attachmentId: crypto.randomUUID(), uncertain: false };
    writeMap(PENDING_KEY, { ...pending, [key]: result });
    return result;
  }
  async prepare(value: OwnerArg, file: File): Promise<PendingPhoto> { return this.prepareKind(value, file, "photo"); }
  async preparePdf(value: OwnerArg, file: File): Promise<PendingPhoto> { return this.prepareKind(value, file, "pdf"); }
  private mark(pending: PendingPhoto, uncertain: boolean) {
    const all = readMap<{attachmentId: string; uncertain: boolean}>(PENDING_KEY);
    if (all[pending.key]?.attachmentId === pending.attachmentId)
      writeMap(PENDING_KEY, { ...all, [pending.key]: { attachmentId: pending.attachmentId, uncertain } });
  }
  private clear(pending: PendingPhoto) {
    const all = readMap<{attachmentId: string; uncertain: boolean}>(PENDING_KEY);
    if (all[pending.key]?.attachmentId === pending.attachmentId) {
      delete all[pending.key]; writeMap(PENDING_KEY, all);
    }
  }
  private async uploadKind(value: OwnerArg, file: File, pending: PendingPhoto,
    onProgress: (percent: number) => void, kind: AttachmentKind): Promise<DrivePhoto> {
    const expected = owner(value);
    await validateAttachment(file, kind);
    const saved = readMap<{attachmentId: string; uncertain: boolean}>(PENDING_KEY)[pending.key];
    if (!saved || saved.attachmentId !== pending.attachmentId) throw new Error("上傳草稿識別碼不符");
    pending = { ...pending, uncertain: saved.uncertain };
    const existing = await this.findAttachmentKind(expected, pending.attachmentId, kind);
    if (existing) { this.clear(pending); return existing; }
    if (pending.uncertain) throw new Error("前次上傳結果仍未確認；請稍後核對，避免重複建立附件");
    const folder = await this.ensureOwnerFolder(expected);
    const metadata = { name: file.name, mimeType: file.type, parents: [folder],
      appProperties: { attachment_id: pending.attachmentId, owner_type: expected.type, owner_id: expected.id } };
    const init = await this.transport.request(UPLOAD, { method: "POST", headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": file.type,
      "X-Upload-Content-Length": String(file.size),
    }, body: JSON.stringify(metadata) });
    if (!init.ok) throw new Error(`Google Drive 上傳初始化失敗（HTTP ${init.status}）`);
    const location = init.headers.get("Location");
    if (!location) throw new Error("Google Drive 未回傳上傳工作階段網址");
    try {
      let result: unknown;
      try { result = await this.transport.upload(location, file, onProgress); }
      catch (uploadError) {
        if (kind !== "pdf") throw uploadError;
        result = await this.resumePdf(location, file, onProgress);
      }
      const row = parseAttachment(result, expected, kind);
      if (row.attachmentId !== pending.attachmentId) throw new Error("上傳附件識別碼不符");
      // Verify via authenticated metadata read before reporting success.
      const check = await json(await this.transport.request(`${API}/${encodeURIComponent(row.id)}?fields=id,name,mimeType,parents,appProperties,createdTime,size`));
      const confirmed = parseAttachment(check, expected, kind);
      if (confirmed.attachmentId !== pending.attachmentId) throw new Error("上傳附件核對失敗");
      this.clear(pending);
      onProgress(100);
      return confirmed;
    } catch (error) {
      this.mark(pending, true);
      const found = await this.findAttachmentKind(expected, pending.attachmentId, kind).catch(() => null);
      if (found) { this.clear(pending); onProgress(100); return found; }
      throw error instanceof DriveUploadError ? error : new Error("上傳結果未確認；請稍後核對原附件，勿重複送出");
    }
  }
  async uploadOne(value: OwnerArg, file: File, pending: PendingPhoto, onProgress: (percent: number) => void): Promise<DrivePhoto> {
    return this.uploadKind(value, file, pending, onProgress, "photo");
  }
  async uploadPdf(value: OwnerArg, file: File, pending: PendingPhoto, onProgress: (percent: number) => void): Promise<DrivePdf> {
    return this.uploadKind(value, file, pending, onProgress, "pdf");
  }
  private async resumePdf(location: string, file: File, onProgress: (percent: number) => void): Promise<unknown> {
    const endpoint = new URL(location);
    if (endpoint.protocol !== "https:" || endpoint.hostname !== "www.googleapis.com" ||
        !endpoint.pathname.startsWith("/upload/drive/v3/files"))
      throw new Error("Google Drive 續傳工作階段網址不符");
    for (let attempt = 0; attempt < 3; attempt++) {
      const status = await this.transport.request(endpoint.href, {
        method: "PUT", headers: { "Content-Range": `bytes */${file.size}` },
      });
      if (status.status === 200 || status.status === 201) return status.json();
      if (status.status !== 308) throw new Error("PDF 上傳工作階段無法確認，請核對原附件後重試");
      const received = status.headers.get("Range");
      const match = received?.match(/^bytes=0-(\d+)$/);
      if (received && !match) throw new Error("PDF 續傳範圍格式錯誤，已停止重試");
      const start = match ? Number(match[1]) + 1 : 0;
      if (!Number.isSafeInteger(start) || start >= file.size || !this.transport.uploadRange)
        throw new Error("PDF 續傳位置無法確認，已停止重試");
      onProgress(Math.floor(start / file.size * 100));
      try { return await this.transport.uploadRange(location, file, start, onProgress); }
      catch { /* Query the same upload session before another attempt. */ }
    }
    throw new Error("PDF 上傳狀態未確認；已保留原附件 ID，請稍後核對");
  }
  private async readKind(attachment: DrivePhoto, kind: AttachmentKind): Promise<Blob> {
    if (!await this.verifyKind({ type: attachment.ownerType, id: attachment.ownerId }, attachment, kind))
      throw new Error("附件已移入垃圾桶，無法讀取");
    const limit = kind === "pdf" ? MAX_PDF_BYTES : MAX_BYTES;
    if (attachment.size > limit) throw new Error("附件超過大小上限，無法讀取");
    const response = await this.transport.request(`${API}/${encodeURIComponent(id(attachment.id))}?alt=media`);
    if (!response.ok) throw new Error(`附件讀取失敗（HTTP ${response.status}）`);
    const blob = await response.blob();
    if (blob.type !== attachment.mimeType || blob.size > limit) throw new Error("附件內容類型或大小不符");
    if (kind === "pdf" && String.fromCharCode(...new Uint8Array(await blob.slice(0, 5).arrayBuffer())) !== "%PDF-")
      throw new Error("PDF 文件內容格式不符");
    return blob;
  }
  async readBlob(photo: DrivePhoto): Promise<Blob> { return this.readKind(photo, "photo"); }
  async readPdf(document: DrivePdf): Promise<Blob> { return this.readKind(document, "pdf"); }
  /** Re-read private metadata; never trust a thumbnail or filename as proof of ownership. */
  private async verifyKind(value: OwnerArg, attachment: DrivePhoto, kind: AttachmentKind): Promise<boolean> {
    const expected = owner(value);
    if (attachment.ownerId !== expected.id || attachment.ownerType !== expected.type || !attachment.attachmentId ||
        !(kind === "pdf" ? attachment.mimeType === PDF_MIME : PHOTO_MIMES.has(attachment.mimeType)))
      throw new Error("附件不屬於目前資料或格式不符");
    const fileUrl = `${API}/${encodeURIComponent(id(attachment.id))}`;
    const check = await json(await this.transport.request(`${fileUrl}?fields=id,name,mimeType,appProperties,trashed`));
    const actual = parseAttachment(check, expected, kind);
    if (actual.id !== attachment.id || actual.attachmentId !== attachment.attachmentId)
      throw new Error("Drive 附件識別碼或所屬資料不符，已停止刪除");
    if (typeof check.trashed !== "boolean") throw new Error("無法確認 Drive 檔案是否已在垃圾桶");
    return !check.trashed;
  }
  async verifyManaged(value: OwnerArg, photo: DrivePhoto): Promise<boolean> {
    return this.verifyKind(value, photo, "photo");
  }
  async verifyPdf(value: OwnerArg, document: DrivePdf): Promise<boolean> {
    return this.verifyKind(value, document, "pdf");
  }
  /** Re-read private metadata immediately before moving a managed attachment to trash. */
  private async trashKind(value: OwnerArg, attachment: DrivePhoto, kind: AttachmentKind): Promise<void> {
    if (!await this.verifyKind(value, attachment, kind)) return; // Prior PATCH succeeded before its reply was lost.
    const fileUrl = `${API}/${encodeURIComponent(attachment.id)}`;
    const result = await json(await this.transport.request(`${fileUrl}?fields=id,trashed`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }),
    }));
    if (result.id !== attachment.id || result.trashed !== true) throw new Error("無法確認附件已移入垃圾桶");
  }
  async trash(value: OwnerArg, photo: DrivePhoto): Promise<void> { return this.trashKind(value, photo, "photo"); }
  async trashPdf(value: OwnerArg, document: DrivePdf): Promise<void> { return this.trashKind(value, document, "pdf"); }
}

export const drivePhotos = new DrivePhotosRepository(driveAuth);
