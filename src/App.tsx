import { useEffect, useState } from "react";
import { ArrowUpRight, LayoutGrid, Leaf } from "lucide-react";
import type { LifeItem, MaintenanceRecord } from "./models";
import { mockApi } from "./api/mockApi";
import Dashboard from "./components/Dashboard";
import Detail from "./components/Detail";
import { ItemForm, Modal } from "./components/Forms";
export default function App() {
  const [items, setItems] = useState<LifeItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [route, setRoute] = useState(location.hash);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    mockApi
      .list()
      .then((data) => {
        setItems(data);
        setLoaded(true);
      })
      .catch((err) => setError(err.message));
    const change = () => {
      setRoute(location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  async function mutate(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setItems(await mockApi.list());
      setNotice("已儲存，生活又有序了一點。");
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setBusy(false);
    }
  }
  const itemId = route.startsWith("#/items/") ? route.slice(8) : null;
  const item = items.find((i) => i.id === itemId);
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
            <span className="mock-label">
              <i />
              本機示範模式
            </span>
            <span className="avatar">日</span>
          </div>
        </div>
      </header>
      <main>
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button onClick={() => setError("")} aria-label="關閉錯誤訊息">
              ×
            </button>
          </div>
        )}
        {!loaded ? (
          <div className="empty">
            {error
              ? "資料載入失敗，請保留現有儲存資料並檢查錯誤。"
              : "正在整理生活事項…"}
          </div>
        ) : itemId ? (
          item ? (
            <Detail
              error={error}
              key={item.id}
              item={item}
              busy={busy}
              save={(i) => mutate(() => mockApi.save(i))}
              complete={(r: MaintenanceRecord) =>
                mutate(() => mockApi.complete(item.id, r))
              }
            />
          ) : (
            <div className="empty">
              <h1>找不到這件生活事項</h1>
              <a href="#/">回到首頁</a>
            </div>
          )
        ) : (
          <Dashboard items={items} add={() => setAdding(true)} />
        )}
      </main>
      <footer>
        <span>
          <Leaf size={14} />
          日日有序 · 把日子過得井井有條
        </span>
        <span>
          資料僅存於此瀏覽器，清除網站資料會遺失紀錄。
          <ArrowUpRight size={13} />
        </span>
      </footer>
      {adding && (
        <Modal
          error={error}
          title="新增生活事項"
          close={() => !busy && setAdding(false)}
        >
          <ItemForm
            busy={busy}
            submit={async (i) => {
              await mutate(() => mockApi.save(i));
              setAdding(false);
              location.hash = `/items/${i.id}`;
            }}
          />
        </Modal>
      )}
      {notice && (
        <div className="toast" role="status">
          ✓ {notice}
        </div>
      )}
    </>
  );
}
