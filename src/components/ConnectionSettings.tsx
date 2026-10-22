import { useEffect, useState } from "react";
import type { ItemsStore } from "../api/itemsStore";
import { validateWebAppUrl } from "../api/appsScriptBridge";
export default function ConnectionSettings({
  store,
  state,
  requestMock,
}: {
  store: ItemsStore;
  state: ReturnType<ItemsStore["getSnapshot"]>;
  requestMock: () => void;
}) {
  const [draft, setDraft] = useState(state.url);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(state.url);
  }, [state.url]);
  let validUrl = "";
  try {
    validUrl = validateWebAppUrl(draft);
  } catch {
    /* Never link an invalid URL. */
  }
  const connecting = state.status === "connecting";
  return (
    <section className="connection-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">DATA SOURCE SETTINGS</div>
          <h1>資料連線設定</h1>
          <p>首頁與詳細頁共同使用此處選擇的資料來源。</p>
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
              void store.connect(validateWebAppUrl(draft));
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
              disabled={state.busy || connecting}
            />
          </label>
          <p className="hint">
            成功連線後，首頁與詳細頁直接使用 Google
            Sheets。資料來源選擇會保留；重新整理會重新連線，不會自動回退 Mock。
          </p>
          {(error || state.error) && (
            <p role="alert" className="error-banner">
              {error || state.error}
            </p>
          )}
          <div className="connection-actions">
            <button className="primary" disabled={state.busy || connecting}>
              {connecting ? "連線中…" : "連線並使用 Google Sheets"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={state.busy || state.mode !== "cloud"}
              onClick={() => store.disconnect()}
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
        <p role="status" className="connection-state">
          {state.mode === "cloud" && state.status === "ready" && !state.stale
            ? "Google Sheets 雲端模式 · 已連線"
            : state.mode === "mock"
              ? "本機 Mock 模式"
              : connecting
                ? "正在等候 Bridge 與 Items 回應…"
                : "雲端未就緒，寫入已停用"}
        </p>
        <div className="connection-actions">
          <a href="#/" className="text-button">
            返回生活事項首頁 →
          </a>
          <button
            className="secondary"
            disabled={state.busy}
            onClick={requestMock}
          >
            切換為本機 Mock
          </button>
          <button
            className="text-button"
            disabled={state.busy}
            onClick={() => store.disconnect(true)}
          >
            移除已儲存網址
          </button>
        </div>
      </div>
      <div className="panel connection-help">
        <h2>登入與資料範圍</h2>
        <p>
          維持 Apps Script「只有我自己」部署權限。Google 登入、第三方
          Cookie、iframe
          嵌入政策與允許來源，仍可能影響實際連線。登入新分頁成功不代表 iframe
          一定可用。
        </p>
        <p>
          雲端模式支援 Items
          基本資料、保養計畫與完成紀錄。備註與照片顯示「尚未支援雲端同步」，相關儲存操作已停用。原有
          Mock 紀錄保留在本機，須明確切換後才能操作。
        </p>
        <p>
          來源檢查與隨機 token
          是通訊關聯機制，不是身分驗證；不能保護匿名公開的寫入 API。
        </p>
      </div>
    </section>
  );
}
