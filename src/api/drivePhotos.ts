import { DriveUploadError, driveAuth } from "./driveAuth";

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,parents,appProperties,createdTime,size";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_NAME = "日日有序 Life Records";
const MAX_BYTES = 10 * 1024 * 1024;
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
}
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
}
function id(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Google Drive 識別碼格式錯誤");
  return value;
}
function quote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
function parsePhoto(value: unknown, expected: PhotoOwner): DrivePhoto {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Drive 照片資料格式錯誤");
  const row = value as Record<string, unknown>;
  const props = row.appProperties as Record<string, unknown> | undefined;
  if (!props || props.owner_type !== expected.type || props.owner_id !== expected.id ||
      typeof props.attachment_id !== "string" || !props.attachment_id ||
      typeof row.name !== "string" || !PHOTO_MIMES.has(String(row.mimeType)))
    throw new Error("Drive 照片所屬資料或格式不符");
  return { id: id(row.id), name: row.name, mimeType: String(row.mimeType),
    ownerId: expected.id, ownerType: expected.type, attachmentId: props.attachment_id, createdTime: String(row.createdTime ?? ""),
    size: Number(row.size ?? 0) };
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
  async list(value: OwnerArg): Promise<DrivePhoto[]> {
    const expected = owner(value);
    const folderId = await this.ownerFolder(expected, false);
    if (!folderId) return [];
    const rows = await this.listRaw(`${quote(folderId)} in parents and trashed = false`);
    return rows.filter(row => {
      const props = row.appProperties as Record<string, unknown> | undefined;
      return props?.owner_type === expected.type && props.owner_id === expected.id && PHOTO_MIMES.has(String(row.mimeType));
    }).map(row => parsePhoto(row, expected))
      .sort((a,b) => b.createdTime.localeCompare(a.createdTime));
  }
  async findAttachment(value: OwnerArg, attachmentId: string): Promise<DrivePhoto | null> {
    const expected = owner(value);
    const rows = await this.listRaw(`appProperties has { key='attachment_id' and value=${quote(id(attachmentId))} } and trashed = false`);
    if (!rows.length) return null;
    const row = parsePhoto(rows[0], expected);
    if (rows.length > 1) throw new Error("相同附件識別碼出現多筆，已停止上傳");
    return row;
  }
  async prepare(value: OwnerArg, file: File): Promise<PendingPhoto> {
    const expected = owner(value);
    await validateDrivePhoto(file);
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const key = `${expected.type === "item" ? "" : "record:"}${expected.id}:${hash}`;
    const pending = readMap<{attachmentId: string; uncertain: boolean}>(PENDING_KEY);
    const current = pending[key];
    if (current) return { key, attachmentId: id(current.attachmentId), uncertain: Boolean(current.uncertain) };
    const result = { key, attachmentId: crypto.randomUUID(), uncertain: false };
    writeMap(PENDING_KEY, { ...pending, [key]: result });
    return result;
  }
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
  async uploadOne(value: OwnerArg, file: File, pending: PendingPhoto, onProgress: (percent: number) => void): Promise<DrivePhoto> {
    const expected = owner(value);
    await validateDrivePhoto(file);
    const saved = readMap<{attachmentId: string; uncertain: boolean}>(PENDING_KEY)[pending.key];
    if (!saved || saved.attachmentId !== pending.attachmentId) throw new Error("上傳草稿識別碼不符");
    pending = { ...pending, uncertain: saved.uncertain };
    const existing = await this.findAttachment(expected, pending.attachmentId);
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
      const result = await this.transport.upload(location, file, onProgress);
      const row = parsePhoto(result, expected);
      if (row.attachmentId !== pending.attachmentId) throw new Error("上傳附件識別碼不符");
      // Verify via authenticated metadata read before reporting success.
      const check = await json(await this.transport.request(`${API}/${encodeURIComponent(row.id)}?fields=id,name,mimeType,parents,appProperties,createdTime,size`));
      const confirmed = parsePhoto(check, expected);
      if (confirmed.attachmentId !== pending.attachmentId) throw new Error("上傳附件核對失敗");
      this.clear(pending);
      onProgress(100);
      return confirmed;
    } catch (error) {
      this.mark(pending, true);
      const found = await this.findAttachment(expected, pending.attachmentId).catch(() => null);
      if (found) { this.clear(pending); onProgress(100); return found; }
      throw error instanceof DriveUploadError ? error : new Error("上傳結果未確認；請稍後核對原附件，勿重複送出");
    }
  }
  async readBlob(photo: DrivePhoto): Promise<Blob> {
    if (!await this.verifyManaged({ type: photo.ownerType, id: photo.ownerId }, photo))
      throw new Error("照片已移入垃圾桶，無法預覽");
    if (photo.size > MAX_BYTES) throw new Error("照片超過 10 MB，無法預覽");
    const response = await this.transport.request(`${API}/${encodeURIComponent(id(photo.id))}?alt=media`);
    if (!response.ok) throw new Error(`照片讀取失敗（HTTP ${response.status}）`);
    const blob = await response.blob();
    if (blob.type !== photo.mimeType || blob.size > MAX_BYTES) throw new Error("照片內容類型或大小不符");
    return blob;
  }
  /** Re-read private metadata; never trust a thumbnail or filename as proof of ownership. */
  async verifyManaged(value: OwnerArg, photo: DrivePhoto): Promise<boolean> {
    const expected = owner(value);
    if (photo.ownerId !== expected.id || photo.ownerType !== expected.type || !photo.attachmentId)
      throw new Error("照片不屬於目前資料");
    const fileUrl = `${API}/${encodeURIComponent(id(photo.id))}`;
    const check = await json(await this.transport.request(`${fileUrl}?fields=id,name,mimeType,appProperties,trashed`));
    const actual = parsePhoto(check, expected);
    if (actual.id !== photo.id || actual.attachmentId !== photo.attachmentId)
      throw new Error("Drive 附件識別碼或所屬資料不符，已停止刪除");
    if (typeof check.trashed !== "boolean") throw new Error("無法確認 Drive 檔案是否已在垃圾桶");
    return !check.trashed;
  }
  /** Re-read private metadata immediately before moving a managed attachment to trash. */
  async trash(value: OwnerArg, photo: DrivePhoto): Promise<void> {
    if (!await this.verifyManaged(value, photo)) return; // Prior PATCH succeeded before its reply was lost.
    const fileUrl = `${API}/${encodeURIComponent(photo.id)}`;
    const result = await json(await this.transport.request(`${fileUrl}?fields=id,trashed`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }),
    }));
    if (result.id !== photo.id || result.trashed !== true) throw new Error("無法確認照片已移入垃圾桶");
  }
}

export const drivePhotos = new DrivePhotosRepository(driveAuth);
