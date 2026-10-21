import { useState } from "react";
import type { SheetsConnection } from "../hooks/useSheetsConnection";
import type { ItemChanges, SheetsItem } from "../api/sheetsItems";
import { Modal } from "./Forms";
import { today } from "../lib/dates";
function CloudItemForm({
  item,
  busy,
  submit,
}: {
  item?: SheetsItem;
  busy: boolean;
  submit: (payload: ItemChanges) => void;
}) {
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        submit({
          name: String(d.get("name")),
          item_date: String(d.get("item_date")),
          category: String(d.get("category")),
          amount: Number(d.get("amount")),
          brand: String(d.get("brand")),
          model: String(d.get("model")),
          location: String(d.get("location")),
          warranty_date: String(d.get("warranty_date")),
        });
      }}
    >
      <label>
        雲端事項名稱
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={item?.name}
          autoFocus
        />
      </label>
      <div className="field-row">
        <label>
          事項日期
          <input
            name="item_date"
            type="date"
            required
            defaultValue={item?.item_date ?? today()}
          />
        </label>
        <label>
          事項分類
          <input
            name="category"
            required
            maxLength={100}
            defaultValue={item?.category ?? "家電設備"}
          />
        </label>
      </div>
      <div className="field-row">
        <label>
          金額（NT$）
          <input
            name="amount"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={item?.amount ?? 0}
          />
        </label>
        <label>
          保固到期日
          <input
            name="warranty_date"
            type="date"
            defaultValue={item?.warranty_date ?? ""}
          />
        </label>
      </div>
      <div className="field-row">
        <label>
          品牌
          <input
            name="brand"
            maxLength={150}
            defaultValue={item?.brand ?? ""}
          />
        </label>
        <label>
          型號
          <input
            name="model"
            maxLength={150}
            defaultValue={item?.model ?? ""}
          />
        </label>
      </div>
      <label>
        地點
        <input
          name="location"
          maxLength={150}
          defaultValue={item?.location ?? ""}
        />
      </label>
      <p className="hint">
        只寫入 Items 基本欄位，不包含保養、歷史、備註或圖片。
      </p>
      <button className="primary" disabled={busy}>
        儲存雲端事項
      </button>
    </form>
  );
}
const labels: Record<string, string> = {
  item_id: "事項 ID",
  name: "名稱",
  category: "分類",
  item_date: "事項日期",
  amount: "金額",
  brand: "品牌",
  model: "型號",
  location: "地點",
  warranty_date: "保固到期日",
  status: "狀態",
  created_at: "建立時間",
  updated_at: "更新時間",
};
export default function SheetsItems({ cloud }: { cloud: SheetsConnection }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [archive, setArchive] = useState<SheetsItem | null>(null);
  const [filter, setFilter] = useState("");
  const canWrite = cloud.status === "connected" && !cloud.busy && !cloud.stale;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">GOOGLE SHEETS · ITEMS ONLY</div>
          <h1>Google Sheets 生活事項</h1>
          <p>獨立雲端清單；本機保養、歷史與圖片尚未同步。</p>
        </div>
        <button
          className="primary"
          disabled={!canWrite}
          onClick={() => setAdding(true)}
        >
          新增雲端事項
        </button>
      </div>
      {cloud.error && (
        <p role="alert" className="error-banner">
          {cloud.error}
        </p>
      )}
      {cloud.notice && (
        <p className="cloud-notice" role="status">
          {cloud.notice}
        </p>
      )}
      <div className="panel">
        <div className="connection-actions">
          <a href="#/settings" className="secondary">
            連線設定
          </a>
          {cloud.status !== "connected" && cloud.url && (
            <button
              className="primary"
              disabled={cloud.busy}
              onClick={() => void cloud.connect(cloud.url)}
            >
              連接已儲存的網址
            </button>
          )}
          <button
            className="secondary"
            disabled={cloud.busy || cloud.status !== "connected"}
            onClick={() => void cloud.refresh()}
          >
            重新讀取
          </button>
          <a className="text-button" href="#/">
            返回本機 Mock
          </a>
        </div>
        {cloud.status !== "connected" && (
          <p className="cloud-notice">
            尚未連線。請從連線設定連接自己的 Web
            App；不會自動使用示範資料填入雲端。
          </p>
        )}
        {cloud.stale && cloud.items.length > 0 && (
          <p role="status" className="cloud-notice">
            以下是本次工作階段上次成功讀取的資料，尚未確認最新狀態；重新讀取成功前不能寫入。
          </p>
        )}
        <label className="cloud-search">
          搜尋雲端事項
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="名稱或分類"
          />
        </label>
        <div className="cloud-list">
          {cloud.items
            .filter((i) => `${i.name} ${i.category}`.includes(filter))
            .map((item) => (
              <article key={item.item_id} className="cloud-row">
                <div>
                  <button
                    className="cloud-item-title"
                    disabled={cloud.busy || cloud.status !== "connected"}
                    onClick={() => {
                      setEditing(false);
                      void cloud.get(item.item_id);
                    }}
                  >
                    {item.name}
                  </button>
                  <p>
                    {item.item_date} · {item.category}{" "}
                    {item.status === "archived" ? "· 已封存" : ""}
                  </p>
                </div>
                <button
                  className="secondary"
                  disabled={!canWrite}
                  onClick={() =>
                    item.status === "archived"
                      ? void cloud.restore(item.item_id)
                      : setArchive(item)
                  }
                >
                  {item.status === "archived" ? "還原" : "封存"}
                </button>
              </article>
            ))}
        </div>
        {cloud.status === "connected" && !cloud.items.length && (
          <p className="empty">
            Items 目前沒有紀錄。新增時只會送出你填寫的資料。
          </p>
        )}
        <p className="hint">
          若後端清單未包含已封存項目，請使用下方 ID 查詢後還原。
        </p>
        <form
          className="connection-actions"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            setEditing(false);
            void cloud.get(String(d.get("id")).trim());
          }}
        >
          <input
            name="id"
            aria-label="查詢 item_id"
            placeholder="以 item_id 查詢（含封存項目）"
            required
          />
          <button
            className="secondary"
            disabled={cloud.busy || cloud.status !== "connected"}
          >
            查詢
          </button>
        </form>
      </div>
      {adding && (
        <Modal
          title="新增雲端事項"
          error={cloud.error}
          close={() => !cloud.busy && setAdding(false)}
        >
          <CloudItemForm
            busy={!canWrite}
            submit={async (payload) => {
              if (await cloud.create(payload)) setAdding(false);
            }}
          />
        </Modal>
      )}
      {cloud.selected && (
        <Modal
          title={editing ? "修改雲端事項" : "雲端事項詳細資料"}
          error={cloud.error}
          close={() => {
            if (!cloud.busy) {
              cloud.clearSelected();
              setEditing(false);
            }
          }}
        >
          {editing ? (
            <CloudItemForm
              item={cloud.selected}
              busy={!canWrite}
              submit={async (payload) => {
                if (await cloud.update(cloud.selected!.item_id, payload))
                  setEditing(false);
              }}
            />
          ) : (
            <>
              <dl className="cloud-details">
                {Object.entries(cloud.selected).map(([key, value]) => (
                  <div key={key}>
                    <dt>{labels[key] ?? key}</dt>
                    <dd>
                      {typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value ?? "")}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="cloud-notice">
                此頁僅顯示後端 Items，不代表本機保養或圖片已同步。
              </p>
              <div className="connection-actions">
                <button
                  className="primary"
                  disabled={!canWrite}
                  onClick={() => setEditing(true)}
                >
                  修改基本資料
                </button>
                {cloud.selected.status === "archived" && (
                  <button
                    className="secondary"
                    disabled={!canWrite}
                    onClick={() => void cloud.restore(cloud.selected!.item_id)}
                  >
                    還原此事項
                  </button>
                )}
              </div>
            </>
          )}
        </Modal>
      )}
      {archive && (
        <Modal
          title="封存雲端事項"
          error={cloud.error}
          close={() => !cloud.busy && setArchive(null)}
        >
          <p>
            確定封存「{archive.name}」？此操作會送至 Google
            Sheets；可依後端支援的查詢結果還原。
          </p>
          <button
            className="primary"
            disabled={!canWrite}
            onClick={async () => {
              if (await cloud.archive(archive.item_id)) setArchive(null);
            }}
          >
            確認封存
          </button>
        </Modal>
      )}
    </>
  );
}
