import { useEffect, useState } from "react";
import type { SheetsConnection } from "../hooks/useSheetsConnection";
import { validateWebAppUrl } from "../api/appsScriptBridge";
export default function ConnectionSettings({
  cloud,
}: {
  cloud: SheetsConnection;
}) {
  const [draft, setDraft] = useState(cloud.url);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(cloud.url);
  }, [cloud.url]);
  let validUrl = "";
  try {
    validUrl = validateWebAppUrl(draft);
  } catch {
    /* Invalid URLs never become links. */
  }
  return (
    <section className="connection-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONNECTION SETTINGS</div>
          <h1>資料連線設定</h1>
          <p>選擇使用本機紀錄，或連接自己的 Google Sheets Items。</p>
        </div>
      </div>
      <div className="panel">
        <h2>Google Apps Script Web App</h2>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            try {
              const value = validateWebAppUrl(draft);
              void cloud.connect(value);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label>
            Web App /exec URL
            <input
              type="url"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="貼上自己的 Apps Script 部署網址"
              disabled={cloud.busy}
            />
          </label>
          <p className="hint">
            網址只存在目前瀏覽器。收到 ready 並成功讀取 Items
            後才儲存；不會上傳本機示範資料。
          </p>
          {error && (
            <p role="alert" className="error-banner">
              {error}
            </p>
          )}
          {cloud.error && (
            <p role="alert" className="error-banner">
              {cloud.error}
            </p>
          )}
          <div className="connection-actions">
            <button className="primary" disabled={cloud.busy}>
              {cloud.busy ? "連線中…" : "連線並儲存網址"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => cloud.disconnect()}
            >
              中斷連線
            </button>
            {validUrl && (
              <a
                className="secondary"
                href={validUrl}
                target="_blank"
                rel="noreferrer"
              >
                在新分頁開啟 Web App
              </a>
            )}
          </div>
        </form>
        <p className="connection-state" role="status">
          {cloud.status === "connected"
            ? "已連線 · Google Sheets Items"
            : cloud.status === "connecting"
              ? "正在等候 Bridge 與 Items 回應…"
              : cloud.status === "error"
                ? "連線失敗，本機資料未變更"
                : "尚未連線 · 可繼續使用本機 Mock"}
        </p>
        {cloud.notice && <p role="status">{cloud.notice}</p>}
        <div className="connection-actions">
          <a className="text-button" href="#/cloud">
            前往 Google Sheets Items →
          </a>
          <a className="text-button" href="#/">
            使用本機 Mock →
          </a>
          <button
            className="text-button"
            disabled={cloud.busy}
            onClick={() => {
              cloud.disconnect(true);
            }}
          >
            移除已儲存網址
          </button>
        </div>
      </div>
      <div className="panel connection-help">
        <h2>登入與資料範圍</h2>
        <p>
          此整合目前已通過模擬測試；實際 Google
          登入、嵌入與後端呼叫仍需另外驗證。
        </p>
        <p>
          維持 Apps Script「只有我自己」部署權限。請先在新分頁登入部署所屬
          Google 帳號，再回到這裡連線；登入成功不代表 iframe 一定可用。
        </p>
        <p>
          Google 登入頁面可能禁止嵌入，第三方
          Cookie、瀏覽器跨網站限制或後端允許來源不符，也可能阻擋連線。逾時時請先核對這些條件，不需要改成「任何人」。
        </p>
        <p>
          目前只有 Items
          的新增、查詢、修改、封存與還原使用橋接。定期保養、歷史紀錄、備註及圖片仍在本機
          Mock，尚未同步 Google Sheets。
        </p>
        <p>
          來源檢查與每次連線的隨機 token
          只用來比對通訊，不是身分驗證，不能保護匿名公開的寫入 API。
        </p>
      </div>
    </section>
  );
}
