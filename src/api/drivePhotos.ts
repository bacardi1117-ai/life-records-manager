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
  attachmentId: string;
  createdTime: string;
  size: number;
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
function parsePhoto(value: unknown, ownerId: string): DrivePhoto {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Drive 照片資料格式錯誤");
  const row = value as Record<string, unknown>;
  const props = row.appProperties as Record<string, unknown> | undefined;
  if (!props || props.owner_type !== "item" || props.owner_id !== ownerId ||
      typeof props.attachment_id !== "string" || !props.attachment_id ||
      typeof row.name !== "string" || !PHOTO_MIMES.has(String(row.mimeType)))
    throw new Error("Drive 照片所屬資料或格式不符");
  return { id: id(row.id), name: row.name, mimeType: String(row.mimeType),
    ownerId, attachmentId: props.attachment_id, createdTime: String(row.createdTime ?? ""),
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
  private async folder(parentId: string, name: string, cacheKey: string, role: "root" | "item", ownerId = "", create = false): Promise<string | null> {
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
              props?.life_records_role === role && (role === "root" || props?.owner_id === ownerId)) return cached;
        }
      } catch { /* Recheck by query before creating. */ }
      delete cache[cacheKey]; writeMap(FOLDER_KEY, cache);
    }
    const matches = await this.listRaw(`name = ${quote(name)} and mimeType = ${quote(FOLDER_MIME)} and ${quote(parentId)} in parents and trashed = false`);
    const existing = matches.find(row => {
      const props = row.appProperties as Record<string, unknown> | undefined;
      return props?.life_records_role === role && (role === "root" || props.owner_id === ownerId);
    });
    if (existing) {
      const found = id(existing.id);
      writeMap(FOLDER_KEY, { ...readMap<string>(FOLDER_KEY), [cacheKey]: found });
      return found;
    }
    if (!create) return null;
    const props: Record<string, string> = { life_records_role: role };
    if (role === "item") { props.owner_type = "item"; props.owner_id = ownerId; }
    const value = await json(await this.transport.request(`${API}?fields=id,name,mimeType,parents,appProperties`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId], appProperties: props }),
    }));
    const folderId = id(value.id);
    writeMap(FOLDER_KEY, { ...readMap<string>(FOLDER_KEY), [cacheKey]: folderId });
    return folderId;
  }
  private async itemFolder(itemId: string, create: boolean): Promise<string | null> {
    const root = await this.folder("root", ROOT_NAME, "root", "root", "", create);
    if (!root) return null;
    return this.folder(root, itemId, `item:${itemId}`, "item", itemId, create);
  }
  private async ensureItemFolder(itemId: string): Promise<string> {
    const existing = this.folderPromises.get(itemId);
    if (existing) return existing;
    const promise = this.itemFolder(itemId, true).then(value => id(value));
    this.folderPromises.set(itemId, promise);
    try { return await promise; } finally { this.folderPromises.delete(itemId); }
  }
  async list(itemId: string): Promise<DrivePhoto[]> {
    id(itemId);
    const folderId = await this.itemFolder(itemId, false);
    if (!folderId) return [];
    const rows = await this.listRaw(`${quote(folderId)} in parents and trashed = false`);
    return rows.filter(row => {
      const props = row.appProperties as Record<string, unknown> | undefined;
      return props?.owner_type === "item" && props.owner_id === itemId && PHOTO_MIMES.has(String(row.mimeType));
    }).map(row => parsePhoto(row, itemId))
      .sort((a,b) => b.createdTime.localeCompare(a.createdTime));
  }
  async findAttachment(itemId: string, attachmentId: string): Promise<DrivePhoto | null> {
    const rows = await this.listRaw(`appProperties has { key='attachment_id' and value=${quote(id(attachmentId))} } and trashed = false`);
    if (!rows.length) return null;
    const row = parsePhoto(rows[0], itemId);
    if (rows.length > 1) throw new Error("相同附件識別碼出現多筆，已停止上傳");
    return row;
  }
  async prepare(itemId: string, file: File): Promise<PendingPhoto> {
    id(itemId);
    await validateDrivePhoto(file);
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const key = `${itemId}:${hash}`;
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
  async uploadOne(itemId: string, file: File, pending: PendingPhoto, onProgress: (percent: number) => void): Promise<DrivePhoto> {
    id(itemId);
    await validateDrivePhoto(file);
    const saved = readMap<{attachmentId: string; uncertain: boolean}>(PENDING_KEY)[pending.key];
    if (!saved || saved.attachmentId !== pending.attachmentId) throw new Error("上傳草稿識別碼不符");
    pending = { ...pending, uncertain: saved.uncertain };
    const existing = await this.findAttachment(itemId, pending.attachmentId);
    if (existing) { this.clear(pending); return existing; }
    if (pending.uncertain) throw new Error("前次上傳結果仍未確認；請稍後核對，避免重複建立附件");
    const folder = await this.ensureItemFolder(itemId);
    const metadata = { name: file.name, mimeType: file.type, parents: [folder],
      appProperties: { attachment_id: pending.attachmentId, owner_type: "item", owner_id: itemId } };
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
      const row = parsePhoto(result, itemId);
      if (row.attachmentId !== pending.attachmentId) throw new Error("上傳附件識別碼不符");
      // Verify via authenticated metadata read before reporting success.
      const check = await json(await this.transport.request(`${API}/${encodeURIComponent(row.id)}?fields=id,name,mimeType,parents,appProperties,createdTime,size`));
      const confirmed = parsePhoto(check, itemId);
      if (confirmed.attachmentId !== pending.attachmentId) throw new Error("上傳附件核對失敗");
      this.clear(pending);
      onProgress(100);
      return confirmed;
    } catch (error) {
      this.mark(pending, true);
      const found = await this.findAttachment(itemId, pending.attachmentId).catch(() => null);
      if (found) { this.clear(pending); onProgress(100); return found; }
      throw error instanceof DriveUploadError ? error : new Error("上傳結果未確認；請稍後核對原附件，勿重複送出");
    }
  }
  async readBlob(photo: DrivePhoto): Promise<Blob> {
    if (photo.size > MAX_BYTES) throw new Error("照片超過 10 MB，無法預覽");
    const response = await this.transport.request(`${API}/${encodeURIComponent(id(photo.id))}?alt=media`);
    if (!response.ok) throw new Error(`照片讀取失敗（HTTP ${response.status}）`);
    const blob = await response.blob();
    if (blob.type !== photo.mimeType || blob.size > MAX_BYTES) throw new Error("照片內容類型或大小不符");
    return blob;
  }
}

export const drivePhotos = new DrivePhotosRepository(driveAuth);
