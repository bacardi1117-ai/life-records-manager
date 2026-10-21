import { validateWebAppUrl } from "./appsScriptBridge";
export const CONNECTION_KEY = "life-records-manager:apps-script-url:v1";
export const connectionSettings = {
  read(): string {
    try {
      return localStorage.getItem(CONNECTION_KEY) ?? "";
    } catch {
      throw new Error("無法讀取連線設定；請確認瀏覽器允許本機儲存");
    }
  },
  save(value: string) {
    const url = validateWebAppUrl(value);
    try {
      localStorage.setItem(CONNECTION_KEY, url);
    } catch {
      throw new Error("連線成功，但無法儲存網址；請確認瀏覽器本機儲存設定");
    }
  },
  remove() {
    try {
      localStorage.removeItem(CONNECTION_KEY);
    } catch {
      throw new Error("無法移除連線網址；本機事項未變更");
    }
  },
};
