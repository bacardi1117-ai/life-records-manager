export const BRIDGE_CHANNEL = "life-records-v1";
export const BRIDGE_ACTIONS = [
  "getItems",
  "getItem",
  "createItem",
  "updateItem",
  "archiveItem",
  "restoreItem",
] as const;
export type BridgeAction = (typeof BRIDGE_ACTIONS)[number];
export function validateWebAppUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("請輸入有效的 Apps Script /exec 網址");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "script.google.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)
  ) {
    throw new Error(
      "請使用 https://script.google.com 的 /macros/s/…/exec 網址，不含查詢參數或片段",
    );
  }
  return url.href;
}
export function isGoogleBridgeOrigin(origin: string): boolean {
  return (
    origin === "https://script.google.com" ||
    origin === "https://script.googleusercontent.com" ||
    /^https:\/\/[a-z0-9-]+(?:\.|-)script\.googleusercontent\.com$/.test(origin)
  );
}
interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
export interface BridgeOptions {
  readyTimeoutMs?: number;
  requestTimeoutMs?: number;
}
/** Session nonce and origin/source checks correlate messages; they are NOT user authentication. */
export class AppsScriptBridge {
  private frame: HTMLIFrameElement | null = null;
  private token = "";
  private target: Window | null = null;
  private origin = "";
  private pending = new Map<string, Pending>();
  private readyTimer?: ReturnType<typeof setTimeout>;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  constructor(
    private host: HTMLElement,
    private options: BridgeOptions = {},
  ) {}
  connect(value: string): Promise<void> {
    const url = validateWebAppUrl(value);
    this.dispose();
    this.token = crypto.randomUUID();
    const frame = document.createElement("iframe");
    frame.title = "Google Sheets Items 資料橋接";
    frame.hidden = true;
    frame.referrerPolicy = "no-referrer";
    const src = new URL(url);
    src.searchParams.set("token", this.token);
    frame.src = src.href;
    this.frame = frame;
    window.addEventListener("message", this.onMessage);
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.readyTimer = setTimeout(
        () =>
          this.dispose(
            "連線逾時：未收到 Bridge ready。請檢查 Google 登入、iframe／跨網站 Cookie 限制與允許的網站來源；保持「只有我自己」設定。",
          ),
        this.options.readyTimeoutMs ?? 15000,
      );
      frame.addEventListener(
        "error",
        () => {
          if (this.frame === frame)
            this.dispose("iframe 載入失敗。請在新分頁登入部署所屬帳號後重試。");
        },
        { once: true },
      );
      try {
        this.host.append(frame);
      } catch {
        this.dispose("無法建立連線 iframe");
      }
    });
  }
  private onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (
      !this.frame ||
      !data ||
      typeof data !== "object" ||
      data.channel !== BRIDGE_CHANNEL ||
      data.token !== this.token ||
      !isGoogleBridgeOrigin(event.origin) ||
      !event.source
    )
      return;
    if (data.type === "ready") {
      if (this.target) return; // Never let another ready message replace the pinned peer.
      // HtmlService uses a nested Google iframe; event.source can differ from frame.contentWindow.
      this.target = event.source as Window;
      this.origin = event.origin;
      clearTimeout(this.readyTimer);
      this.readyResolve?.();
      this.readyResolve = undefined;
      this.readyReject = undefined;
      return;
    }
    if (
      event.source !== this.target ||
      event.origin !== this.origin ||
      data.type !== "response" ||
      typeof data.id !== "string" ||
      typeof data.ok !== "boolean"
    )
      return;
    const request = this.pending.get(data.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(data.id);
    if (data.ok) request.resolve(data.result);
    else
      request.reject(
        new Error(
          typeof data.error === "string" ? data.error : "Apps Script 操作失敗",
        ),
      );
  };
  request(action: BridgeAction, payload: unknown = {}): Promise<unknown> {
    if (!BRIDGE_ACTIONS.includes(action))
      return Promise.reject(new Error("不支援的橋接動作"));
    if (!this.target)
      return Promise.reject(new Error("尚未連接 Google Sheets"));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            "請求逾時，結果尚未確認；寫入可能已完成，請先重新讀取確認，勿直接重複送出。",
          ),
        );
      }, this.options.requestTimeoutMs ?? 20000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.target!.postMessage(
          {
            channel: BRIDGE_CHANNEL,
            token: this.token,
            type: "request",
            id,
            action,
            payload,
          },
          this.origin,
        );
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("無法傳送橋接請求，請重新連線"));
      }
    });
  }
  dispose(reason = "連線已中斷") {
    window.removeEventListener("message", this.onMessage);
    clearTimeout(this.readyTimer);
    this.readyReject?.(new Error(reason));
    this.readyResolve = undefined;
    this.readyReject = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(reason));
    }
    this.pending.clear();
    this.target = null;
    this.origin = "";
    this.token = "";
    this.frame?.remove();
    this.frame = null;
  }
}
