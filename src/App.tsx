import { useEffect, useState } from "react";
import { ArrowUpRight, LayoutGrid, Leaf } from "lucide-react";
import Dashboard from "./components/Dashboard";
import Detail from "./components/Detail";
import ConnectionSettings from "./components/ConnectionSettings";
import { useItemsStore } from "./hooks/useItemsStore";
import { ItemForm, Modal } from "./components/Forms";
export default function App() {
  const { store, state, host } = useItemsStore();
  const [route, setRoute] = useState(location.hash);
  const [adding, setAdding] = useState(false);
  const [switchingMock, setSwitchingMock] = useState(false);
  const cloud = state.mode === "cloud";
  const writable = state.status === "ready" && !state.stale && !state.busy;
  let itemId: string | null = null;
  try {
    if (route.startsWith("#/items/"))
      itemId = decodeURIComponent(route.slice(8));
  } catch {
    itemId = "invalid-id";
  }
  useEffect(() => {
    const change = () => {
      setRoute(location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (itemId && state.status === "ready") void store.openItem(itemId);
    else store.closeItem();
  }, [store, itemId, state.mode, state.status]);
  useEffect(() => {
    setAdding(false);
  }, [state.mode]);
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#/">
            <span className="brand-icon">
              <Leaf size={23} />
            </span>
            <span>
              日日有序<small>LIFE RECORDS</small>
            </span>
          </a>
          <a className="nav-link" href="#/">
            <LayoutGrid size={17} />
            生活事項
          </a>
          <div className="header-right">
            <a className="settings-link" href="#/settings">
              連線設定
            </a>
            <span className="mock-label" data-testid="source-label">
              <i />
              {state.mode === null
                ? "正在確認資料來源"
                : cloud
                  ? "Google Sheets 雲端模式"
                  : "本機 Mock 模式"}
            </span>
          </div>
        </div>
      </header>
      <div ref={host} className="bridge-host" />
      <main>
        {route === "#/settings" ? (
          <ConnectionSettings
            store={store}
            state={state}
            requestMock={() => setSwitchingMock(true)}
          />
        ) : (
          <>
            {state.error && (
              <p role="alert" className="error-banner">
                {state.error}
              </p>
            )}
            {state.notice && (
              <p role="status" className="cloud-notice">
                {state.notice}
              </p>
            )}
            {cloud && (
              <div className="source-toolbar">
                <span>
                  {state.status === "ready" && !state.stale
                    ? "Items、保養計畫、完成紀錄與備註使用雲端；照片分頁使用私人 Google Drive 儲存事項照片。"
                    : "雲端資料尚未就緒，已停止寫入；不會自動回退為 Mock。"}
                </span>
                <a href="#/settings" className="text-button">
                  連線設定
                </a>
                {state.status === "ready" ? (
                  <button
                    className="secondary"
                    disabled={state.busy}
                    onClick={() => void store.refresh()}
                  >
                    重新讀取
                  </button>
                ) : (
                  state.url && (
                    <button
                      className="secondary"
                      disabled={state.status === "connecting"}
                      onClick={() => void store.connect(state.url)}
                    >
                      重新連線
                    </button>
                  )
                )}
              </div>
            )}
            {state.stale && state.items.length > 0 && (
              <p className="cloud-notice">
                以下為上次讀取的資料；重新讀取成功前不能寫入。
              </p>
            )}
            {state.status === "loading" || state.status === "connecting" ? (
              <p className="empty">
                {cloud ? "正在連接 Google Sheets…" : "正在載入本機紀錄…"}
              </p>
            ) : !state.mode ? (
              <a href="#/settings">前往設定選擇資料來源</a>
            ) : itemId ? (
              state.detailState === "loading" ? (
                <p className="empty">正在讀取事項…</p>
              ) : state.selected?.id === itemId ? (
                <Detail
                  key={`${state.mode}:${itemId}`}
                  item={state.selected}
                  store={store}
                  plans={state.plans}
                  records={state.records}
                  calendarSync={state.calendarSync}
                  notes={state.notes}
                  cloud={cloud}
                  busy={state.busy}
                  readOnly={!writable}
                  error={state.error}
                  save={store.saveLocal}
                  update={store.update}
                  complete={(r) => store.complete(itemId!, r)}
                  setArchived={(archived) =>
                    store.setArchived(state.selected!, archived)
                  }
                  recover={
                    state.stale && state.status === "ready"
                      ? store.refresh
                      : undefined
                  }
                />
              ) : (
                <div className="empty">
                  <h1>
                    {state.status === "ready"
                      ? "無法讀取這件生活事項"
                      : "請先恢復所選資料來源的連線"}
                  </h1>
                  <a href="#/">回到首頁</a>
                  {state.status === "ready" && (
                    <button
                      className="secondary"
                      onClick={() => void store.openItem(itemId!)}
                    >
                      重新讀取事項
                    </button>
                  )}
                </div>
              )
            ) : (
              <Dashboard
                key={state.mode}
                items={state.items}
                cloud={cloud}
                readOnly={!writable}
                add={() => setAdding(true)}
              />
            )}
          </>
        )}
      </main>
      <footer>
        <span>
          <Leaf size={14} />
          日日有序 · 把日子過得井井有條
        </span>
        <span>
          {cloud
            ? "Items 使用 Google Sheets；未混入本機 Mock 資料。"
            : "資料僅存於此瀏覽器，清除網站資料會遺失紀錄。"}
          <ArrowUpRight size={13} />
        </span>
      </footer>
      {adding && (
        <Modal
          title="新增生活事項"
          error={state.error}
          close={() => !state.busy && setAdding(false)}
        >
          <ItemForm
            cloud={cloud}
            busy={state.busy}
            disabled={!writable}
            recover={
              state.stale && state.status === "ready"
                ? store.refresh
                : undefined
            }
            submit={async (item) => {
              const id = await store.create(item);
              setAdding(false);
              location.hash = `/items/${encodeURIComponent(id)}`;
            }}
          />
        </Modal>
      )}
      {switchingMock && (
        <Modal
          title="切換為本機 Mock 模式"
          close={() => setSwitchingMock(false)}
          error={state.error}
        >
          <p>
            本機 Mock 與 Google Sheets
            是不同資料來源。切換後只會操作此瀏覽器的本機資料；不會上傳、合併或刪除任何既有紀錄。
          </p>
          <div className="connection-actions">
            <button
              className="secondary"
              onClick={() => setSwitchingMock(false)}
            >
              取消
            </button>
            <button
              className="primary"
              disabled={state.busy}
              onClick={async () => {
                await store.useMock();
                if (store.getSnapshot().mode === "mock") {
                  setSwitchingMock(false);
                  location.hash = "/";
                }
              }}
            >
              確認切換至 Mock
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
