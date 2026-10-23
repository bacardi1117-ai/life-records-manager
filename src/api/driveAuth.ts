/** Google Identity Services token client. Tokens exist only in this module's memory. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GIS_SCRIPT = "https://accounts.google.com/gsi/client";
const DRIVE_CHECK = "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=nextPageToken";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  callback: (response: TokenResponse) => void;
  error_callback?: (error: { type?: string }) => void;
  requestAccessToken: (options: { prompt: string }) => void;
}
export interface GoogleIdentity {
  accounts: { oauth2: {
    initTokenClient: (options: { client_id: string; scope: string; callback: (response: TokenResponse) => void;
      error_callback?: (error: { type?: string }) => void }) => TokenClient;
    revoke: (token: string, callback: (response: { successful?: boolean }) => void) => void;
  } };
}
declare global { interface Window { google?: GoogleIdentity } }

let gisLoad: Promise<GoogleIdentity> | null = null;
function loadGis(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  if (gisLoad) return gisLoad;
  gisLoad = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT;
    script.async = true;
    script.onload = () => window.google?.accounts?.oauth2
      ? resolve(window.google) : reject(new Error("Google 授權元件無法使用，請重新整理後再試"));
    script.onerror = () => reject(new Error("Google 授權元件載入失敗，請檢查網路或瀏覽器阻擋設定"));
    document.head.append(script);
  }).catch(error => { gisLoad = null; throw error; });
  return gisLoad!;
}
export type DriveAuthState = "unconfigured" | "loading" | "idle" | "authorizing" | "authorized" | "expired" | "revoked" | "error";
export interface DriveSnapshot { state: DriveAuthState; error: string }
export class DriveAuth {
  private google: GoogleIdentity | null = null;
  private preparePromise: Promise<void> | null = null;
  private token = "";
  private expiresAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private listeners = new Set<() => void>();
  private snapshot: DriveSnapshot;
  constructor(private clientId: string, private deps: {
    gis: () => Promise<GoogleIdentity>;
    fetch: typeof fetch;
    now: () => number;
  } = { gis: loadGis, fetch: (...args) => fetch(...args), now: () => Date.now() }) {
    this.snapshot = { state: clientId.trim() ? "loading" : "unconfigured", error: "" };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit(state: DriveAuthState, error = "") {
    this.snapshot = { state, error };
    this.listeners.forEach(listener => listener());
  }
  private clearToken() {
    this.token = "";
    this.expiresAt = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private expire = () => {
    if (!this.token) return;
    this.generation++;
    this.clearToken();
    this.emit("expired", "Google Drive 授權已過期，請重新授權");
  };
  get isPrepared() { return Boolean(this.google); }
  prepare(): Promise<void> {
    if (!this.clientId.trim() || this.google) return Promise.resolve();
    if (this.preparePromise) return this.preparePromise;
    this.emit("loading");
    this.preparePromise = this.deps.gis().then(google => {
      this.google = google;
      if (this.snapshot.state === "loading") this.emit("idle");
    }).catch(error => {
      this.emit("error", error instanceof Error ? error.message : "Google 授權元件載入失敗");
    }).finally(() => { this.preparePromise = null; });
    return this.preparePromise;
  }
  async authorize(): Promise<void> {
    if (!this.clientId.trim()) { this.emit("unconfigured"); return; }
    if (!this.google) { await this.prepare(); return; }
    if (this.snapshot.state === "authorizing") return;
    const generation = ++this.generation;
    this.clearToken();
    this.emit("authorizing");
    try {
      const google = this.google;
      if (generation !== this.generation) return;
      const response = await new Promise<TokenResponse>((resolve, reject) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: this.clientId, scope: DRIVE_SCOPE,
          callback: resolve,
          error_callback: error => reject(new Error(error.type === "popup_closed"
            ? "已取消 Google 授權，請按重新授權再試" : "Google 授權視窗失敗，請檢查瀏覽器彈出視窗設定")),
        });
        client.requestAccessToken({ prompt: "consent" });
      });
      if (generation !== this.generation) return;
      if (response.error) throw new Error(response.error === "access_denied"
        ? "已拒絕 Google Drive 授權，請重新授權" : `Google 授權失敗：${response.error_description || response.error}`);
      if (!response.access_token || !response.scope?.split(/\s+/).includes(DRIVE_SCOPE) ||
          !Number.isFinite(response.expires_in) || (response.expires_in ?? 0) <= 0)
        throw new Error("Google 授權結果不完整，請重新授權");
      this.token = response.access_token;
      this.expiresAt = this.deps.now() + response.expires_in! * 1000;
      const result = await this.deps.fetch(DRIVE_CHECK, {
        method: "GET", headers: { Authorization: `Bearer ${this.token}` }, cache: "no-store",
      });
      if (generation !== this.generation) return;
      if (result.status === 401) { this.expire(); return; }
      if (!result.ok) throw new Error(result.status === 403
        ? "Google Drive API 拒絕存取，請確認帳號、測試使用者與 API 設定後重新授權"
        : `Google Drive 連線驗證失敗（HTTP ${result.status}），請重新授權`);
      if (this.deps.now() >= this.expiresAt) { this.expire(); return; }
      this.timer = setTimeout(this.expire, Math.max(1, this.expiresAt - this.deps.now() - 5000));
      this.emit("authorized");
    } catch (error) {
      if (generation !== this.generation) return;
      this.clearToken();
      this.emit("error", error instanceof Error ? error.message : "Google Drive 授權失敗，請重新授權");
    }
  }
  /** Use the in-memory token for a private Drive API request. */
  async request(url: string, init: RequestInit = {}): Promise<Response> {
    if (this.snapshot.state !== "authorized" || !this.token || this.deps.now() >= this.expiresAt) {
      if (this.token) this.expire();
      throw new Error("Google Drive 尚未授權或授權已過期，請重新授權");
    }
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    const response = await this.deps.fetch(url, { ...init, headers, cache: "no-store" });
    if (response.status === 401) {
      this.expire();
      throw new Error("Google Drive 授權已過期，請重新授權");
    }
    return response;
  }
  /** XHR is needed for upload progress; the token never leaves this service except in the API header. */
  upload(url: string, file: File, onProgress: (percent: number) => void): Promise<unknown> {
    if (this.snapshot.state !== "authorized" || !this.token || this.deps.now() >= this.expiresAt) {
      if (this.token) this.expire();
      return Promise.reject(new Error("Google Drive 尚未授權或授權已過期，請重新授權"));
    }
    const endpoint = new URL(url);
    if (endpoint.protocol !== "https:" || endpoint.hostname !== "www.googleapis.com" ||
        !endpoint.pathname.startsWith("/upload/drive/v3/files"))
      return Promise.reject(new Error("Google Drive 上傳工作階段網址不符"));
    const token = this.token;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", endpoint.href);
      xhr.responseType = "json";
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.setRequestHeader("Content-Range", `bytes 0-${file.size - 1}/${file.size}`);
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) onProgress(Math.min(99, Math.floor(event.loaded / event.total * 100)));
      };
      xhr.onerror = () => reject(new DriveUploadError("上傳連線中斷，結果尚未確認；請先核對原附件", true));
      xhr.ontimeout = () => reject(new DriveUploadError("上傳逾時，結果尚未確認；請先核對原附件", true));
      xhr.onload = () => {
        if (xhr.status === 401) {
          this.expire();
          reject(new DriveUploadError("Google Drive 授權已過期，請先核對上傳結果再重新授權", true));
        } else if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
        else reject(new DriveUploadError(`Google Drive 上傳回應 HTTP ${xhr.status}；請先核對原附件`, true));
      };
      xhr.send(file);
    });
  }
  revoke() {
    const token = this.token;
    const generation = ++this.generation;
    this.clearToken();
    this.emit("revoked");
    if (token) {
      const google = this.google;
      if (!google) return;
      try { google.accounts.oauth2.revoke(token, response => {
        if (generation === this.generation && response.successful === false) this.emit("error", "取消 Google 授權失敗；本頁已清除 Token，請到 Google 帳戶檢查授權");
      }); } catch { if (generation === this.generation) this.emit("error", "無法聯絡 Google 取消授權；本頁已清除 Token，請到 Google 帳戶檢查授權"); }
    }
  }
}
export class DriveUploadError extends Error {
  constructor(message: string, public uncertain: boolean) { super(message); }
}
export const driveAuth = new DriveAuth(import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "");
