import { useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock3,
  Edit3,
  MapPin,
  Plus,
  Repeat2,
} from "lucide-react";
import type {
  LifeItem,
  MaintenanceRecord,
  Photo,
  RecurringTask,
} from "../models";
import { daysUntil, dueLabel, money, nextDue, today } from "../lib/dates";
import { CompleteForm, ItemForm, Modal, PhotoInput, TaskForm } from "./Forms";
import CloudMaintenancePlans from "./CloudMaintenancePlans";
import type { ItemsStore, PlansSnapshot } from "../api/itemsStore";
function Gallery({ photos }: { photos: Photo[] }) {
  return (
    <div className="gallery">
      {photos.map((p) => (
        <a
          key={p.id}
          href={p.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`檢視照片：${p.name}`}
        >
          <img src={p.url} alt={p.name} />
          <span>{p.name}</span>
        </a>
      ))}
    </div>
  );
}
export default function Detail({
  item,
  store,
  plans,
  save,
  complete,
  busy,
  error,
  cloud = false,
  readOnly = false,
  update,
  setArchived,
  recover,
}: {
  store: ItemsStore;
  plans: PlansSnapshot;
  cloud?: boolean;
  readOnly?: boolean;
  update: (item: LifeItem, original: LifeItem) => Promise<void>;
  setArchived: (archived: boolean) => Promise<void>;
  recover?: () => Promise<void>;
  error: string;
  item: LifeItem;
  save: (i: LifeItem) => Promise<void>;
  complete: (r: MaintenanceRecord) => Promise<void>;
  busy: boolean;
}) {
  const [tab, setTab] = useState("定期子項目");
  const [modal, setModal] = useState<
    "edit" | "task" | "complete" | "photos" | null
  >(null);
  const [selected, setSelected] = useState<RecurringTask>();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [note, setNote] = useState("");
  async function saveAndClose(value: LifeItem) {
    await save(value);
    setModal(null);
  }
  return (
    <>
      <a className="back-link" href="#/">
        <ArrowLeft size={16} />
        所有生活事項
        <ChevronRight size={14} />
        <span>{item.name}</span>
      </a>
      <div className="detail-hero">
        <div className="detail-image">
          {item.photos[0] ? (
            <img src={item.photos[0].url} alt={item.photos[0].name} />
          ) : (
            <Repeat2 size={60} />
          )}
        </div>
        <div className="detail-title">
          <span className="pill">{item.category}</span>
          <h1>{item.name}</h1>
          <p>{item.brand || "生活裡，值得好好照顧的一件事。"}</p>
          <span className="muted small">
            <MapPin size={14} />
            {item.location || "尚未設定地點"}
          </span>
        </div>
        <button
          className="secondary"
          disabled={readOnly}
          onClick={() => setModal("edit")}
        >
          <Edit3 size={16} />
          編輯資料
        </button>
      </div>
      <div className="detail-grid">
        <aside className="panel basic-info">
          <div className="section-heading">
            <h2>基本資料</h2>
            <span className="eyebrow">DETAILS</span>
          </div>
          <dl>
            <dt>購入 / 建立日期</dt>
            <dd>{item.date}</dd>
            <dt>購入及安裝金額</dt>
            <dd className="large-money">{money(item.amount)}</dd>
            <dt>品牌</dt>
            <dd>{item.brand || "未填寫"}</dd>
            <dt>型號</dt>
            <dd>{item.model || "未填寫"}</dd>
            <dt>位置</dt>
            <dd>{item.location || "未填寫"}</dd>
            <dt>保固日期</dt>
            <dd>{item.warrantyDate || "未填寫"}</dd>
            <dt>狀態</dt>
            <dd>{item.status === "archived" ? "已封存" : "使用中"}</dd>
            {!cloud && (
              <>
                <dt>累計保養支出</dt>
                <dd>{money(item.history.reduce((a, r) => a + r.amount, 0))}</dd>
                <dt>購買及安裝資料</dt>
                <dd className="description">
                  {item.description || "尚未填寫"}
                </dd>
              </>
            )}
          </dl>
          <div className="local-note">
            <ShieldIcon />
            {cloud
              ? "Google Sheets 雲端模式 · Items"
              : "本機 Mock 模式 · 資料保存在此瀏覽器"}
          </div>
          {cloud && (
            <button
              className="secondary"
              disabled={readOnly}
              onClick={() =>
                void setArchived(item.status !== "archived").catch(() => {})
              }
            >
              {item.status === "archived" ? "還原事項" : "封存事項"}
            </button>
          )}
        </aside>
        <section className="detail-content">
          <div className="tabs" role="tablist" aria-label="事項內容">
            {["定期子項目", "歷史紀錄", "備註", "照片"].map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
              >
                {t}
                <span>
                  {cloud
                    ? t === "定期子項目"
                      ? "雲端"
                      : "未同步"
                    : t === "定期子項目"
                      ? item.tasks.length
                      : t === "歷史紀錄"
                        ? item.history.length
                        : t === "備註"
                          ? item.notes.length
                          : item.photos.length}
                </span>
              </button>
            ))}
          </div>
          <div className="panel tab-panel" role="tabpanel" aria-label={tab}>
            {cloud && tab === "定期子項目" ? (
              <CloudMaintenancePlans
                item={item}
                store={store}
                state={plans}
                busy={busy}
                readOnly={readOnly}
              />
            ) : cloud ? (
              <div className="empty">
                <h2>{tab}尚未支援雲端同步</h2>
                <p>
                  目前雲端支援 Items 基本資料及保養計畫，此處不會讀取或寫入本機
                  Mock 紀錄。
                </p>
              </div>
            ) : (
              <>
                {tab === "定期子項目" && (
                  <>
                    <div className="section-heading">
                      <div>
                        <h2>定期照顧，安心生活</h2>
                        <p className="muted small">
                          完成後，自動從實際日期重新計算。
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => {
                          setSelected(undefined);
                          setModal("task");
                        }}
                      >
                        <Plus size={16} />
                        新增子項目
                      </button>
                    </div>
                    {item.tasks.map((task) => {
                      const due = nextDue(item, task);
                      return (
                        <div className="task-row" key={task.id}>
                          <span
                            className={`task-icon ${daysUntil(due) < 0 ? "amber" : ""}`}
                          >
                            <Repeat2 size={20} />
                          </span>
                          <div className="task-info">
                            <h3>{task.name}</h3>
                            <p>
                              每 {task.intervalDays} 天 <span>·</span> 下次{" "}
                              {due}
                            </p>
                            <span
                              className={`status ${daysUntil(due) < 0 ? "overdue" : ""}`}
                            >
                              {dueLabel(due)}
                            </span>
                          </div>
                          <div className="task-actions">
                            <button
                              className="icon-button"
                              aria-label={`編輯${task.name}`}
                              onClick={() => {
                                setSelected(task);
                                setModal("task");
                              }}
                            >
                              <Edit3 size={16} />
                            </button>
                            <button
                              className="secondary"
                              onClick={() => {
                                setSelected(task);
                                setModal("complete");
                              }}
                            >
                              <Check size={16} />
                              完成保養
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {!item.tasks.length && (
                      <p className="empty">
                        還沒有定期子項目，新增一個保養計畫吧。
                      </p>
                    )}
                  </>
                )}
                {tab === "歷史紀錄" && (
                  <>
                    <div className="section-heading">
                      <h2>每一次照顧，都有記錄</h2>
                      <Clock3 size={19} />
                    </div>
                    <div className="timeline">
                      {[...item.history]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .map((r) => (
                          <article key={r.id}>
                            <div className="record-top">
                              <span>{r.date}</span>
                              <strong>{money(r.amount)}</strong>
                            </div>
                            <h3>{r.taskName}</h3>
                            <p>{r.note || "無備註"}</p>
                            <Gallery photos={r.photos} />
                          </article>
                        ))}
                    </div>
                    {!item.history.length && (
                      <p className="empty">
                        完成第一次保養後，紀錄會出現在這裡。
                      </p>
                    )}
                  </>
                )}
                {tab === "備註" && (
                  <>
                    <h2>生活筆記</h2>
                    <form
                      className="note-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        try {
                          await save({
                            ...item,
                            notes: [
                              ...item.notes,
                              {
                                id: crypto.randomUUID(),
                                date: today(),
                                text: note.trim(),
                              },
                            ],
                          });
                          setNote("");
                        } catch {
                          /* API error is shown without clearing the note. */
                        }
                      }}
                    >
                      <textarea
                        aria-label="新增備註"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="補充保固資訊、師傅的叮嚀，或下次要注意的事…"
                        rows={3}
                        maxLength={3000}
                        required
                      />
                      <button
                        className="primary"
                        disabled={busy || !note.trim()}
                      >
                        <Plus size={16} />
                        新增備註
                      </button>
                    </form>
                    {[...item.notes].reverse().map((n) => (
                      <article className="note" key={n.id}>
                        <time>{n.date}</time>
                        <p>{n.text}</p>
                      </article>
                    ))}
                  </>
                )}
                {tab === "照片" && (
                  <>
                    <div className="section-heading">
                      <h2>照片與憑證</h2>
                      <button
                        className="text-button"
                        onClick={() => {
                          setPhotos([]);
                          setModal("photos");
                        }}
                      >
                        <Plus size={16} />
                        新增照片
                      </button>
                    </div>
                    <Gallery photos={item.photos} />
                    {!item.photos.length && (
                      <p className="empty">
                        留下設備照片與購買憑證，日後更容易查找。
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </section>
      </div>
      {modal && (
        <Modal
          error={error}
          title={
            modal === "edit"
              ? "編輯生活事項"
              : modal === "task"
                ? selected
                  ? "編輯定期子項目"
                  : "新增定期子項目"
                : modal === "complete"
                  ? "完成保養"
                  : "新增照片"
          }
          close={() => !busy && setModal(null)}
        >
          {modal === "edit" && (
            <ItemForm
              item={item}
              cloud={cloud}
              busy={busy}
              disabled={readOnly}
              recover={recover}
              submit={async (value, original) => {
                await update(value, original!);
                setModal(null);
              }}
            />
          )}{" "}
          {modal === "task" && (
            <TaskForm
              task={selected}
              startDate={item.date}
              busy={busy}
              submit={(t) =>
                saveAndClose({
                  ...item,
                  tasks: selected
                    ? item.tasks.map((old) => (old.id === t.id ? t : old))
                    : [...item.tasks, t],
                })
              }
            />
          )}{" "}
          {modal === "complete" && selected && (
            <CompleteForm
              task={selected}
              itemDate={item.date}
              busy={busy}
              submit={async (r) => {
                await complete(r);
                setModal(null);
              }}
            />
          )}{" "}
          {modal === "photos" && (
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                void saveAndClose({
                  ...item,
                  photos: [...item.photos, ...photos],
                }).catch(() => {});
              }}
            >
              <PhotoInput onChange={setPhotos} />
              <button className="primary" disabled={busy || !photos.length}>
                儲存照片
              </button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
function ShieldIcon() {
  return <Check size={16} />;
}
