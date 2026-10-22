import { useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  ClipboardList,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Droplets,
} from "lucide-react";
import type { LifeItem } from "../models";
import { daysUntil, dueLabel, nextDue, money } from "../lib/dates";
export default function Dashboard({
  items,
  add,
  cloud = false,
  readOnly = false,
}: {
  cloud?: boolean;
  readOnly?: boolean;
  items: LifeItem[];
  add: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部事項");
  const tasks = items.flatMap((item) =>
    item.tasks.map((task) => ({ item, task, due: nextDue(item, task) })),
  );
  const overdue = tasks.filter((t) => daysUntil(t.due) < 0);
  const upcoming = tasks.filter(
    (t) => daysUntil(t.due) >= 0 && daysUntil(t.due) <= 30,
  );
  const filtered = items.filter(
    (i) =>
      (category === "全部事項" || i.category === category) &&
      `${i.name} ${i.brand} ${i.location}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR EVERYDAY, ORGANIZED</div>
          <h1>把生活，照顧得更好。</h1>
          <p>重要的小事都記在這裡，讓每一天更從容。</p>
        </div>
        <button className="primary" onClick={add} disabled={readOnly}>
          <Plus size={18} />
          新增生活事項
        </button>
      </div>
      <section className="stats" aria-label="事項統計">
        <div>
          <span className="stat-icon green">
            <ClipboardList />
          </span>
          <div>
            <p>生活事項</p>
            <strong>
              {items.length}
              <small>件</small>
            </strong>
          </div>
        </div>
        <div>
          <span className="stat-icon amber">
            <CalendarDays />
          </span>
          <div>
            <p>{cloud ? "事項總金額" : "30 天內待保養"}</p>
            <strong>
              {cloud
                ? money(items.reduce((sum, item) => sum + item.amount, 0))
                : upcoming.length}
              {!cloud && <small>項</small>}
            </strong>
          </div>
        </div>
        <div>
          <span className="stat-icon rose">
            <ShieldCheck />
          </span>
          <div>
            <p>{cloud ? "已封存事項" : "已逾期保養"}</p>
            <strong>
              {cloud
                ? items.filter((item) => item.status === "archived").length
                : overdue.length}
              <small>項</small>
            </strong>
          </div>
        </div>
      </section>
      <section className="dashboard-grid">
        <div>
          <div className="section-heading">
            <h2>
              我的生活事項 <span className="count">{items.length}</span>
            </h2>
            <span className="muted small">讓每件事都有跡可循</span>
          </div>
          <div className="toolbar">
            <label className="search">
              <Search size={18} />
              <input
                aria-label="搜尋事項"
                placeholder="搜尋名稱、品牌或地點…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="filter">
              <SlidersHorizontal size={16} />
              <select
                aria-label="分類篩選"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {["全部事項", ...new Set(items.map((i) => i.category))].map(
                  (c) => (
                    <option key={c}>{c}</option>
                  ),
                )}
              </select>
            </label>
          </div>
          <div className="item-grid">
            {filtered.map((item) => {
              const dates = item.tasks.map((t) => nextDue(item, t)).sort();
              const due = dates[0];
              return (
                <a
                  href={`#/items/${encodeURIComponent(item.id)}`}
                  className="item-card"
                  key={item.id}
                >
                  <div className="item-cover">
                    {item.photos[0] ? (
                      <img src={item.photos[0].url} alt={item.photos[0].name} />
                    ) : (
                      <div className="cover-placeholder">
                        <ClipboardList size={64} />
                      </div>
                    )}
                    <span className="category-badge">{item.category}</span>
                    <span className="open-arrow">
                      <ArrowUpRight size={18} />
                    </span>
                  </div>
                  <div className="item-body">
                    <h3>{item.name}</h3>
                    <p className="muted">{item.location || "尚未設定地點"}</p>
                    <div className="item-meta">
                      <span>
                        <CalendarDays size={14} />
                        {item.date}
                      </span>
                      <span>
                        {cloud
                          ? money(item.amount)
                          : `${item.tasks.length} 個定期項目`}
                      </span>
                    </div>
                    <div className="item-due">
                      <span
                        className={`dot ${due && daysUntil(due) < 0 ? "late" : ""}`}
                      />
                      {cloud
                        ? item.status === "archived"
                          ? "已封存"
                          : "使用中"
                        : due
                          ? `下次保養 ${due}`
                          : "尚未設定定期保養"}
                      {due && <small>{dueLabel(due)}</small>}
                    </div>
                  </div>
                </a>
              );
            })}
            <button className="add-card" onClick={add} disabled={readOnly}>
              <span>
                <Plus size={26} />
              </span>
              <strong>新增一件生活事項</strong>
              <p>家電、愛車、生活裡的大小事</p>
            </button>
          </div>
          {filtered.length === 0 && (
            <p className="empty">沒有符合的事項，試試其他關鍵字。</p>
          )}
        </div>
        <aside>
          <div className="section-heading">
            <h2>保養小日曆</h2>
            <CalendarDays size={19} />
          </div>
          <div className="schedule-card">
            {cloud ? (
              <p className="cloud-notice">
                請進入事項的「定期子項目」查看雲端保養計畫。完成保養、歷史紀錄、備註與照片尚未支援雲端同步。
              </p>
            ) : (
              <>
                <div className="schedule-intro">
                  下一步，照顧生活<span>依到期日期排列</span>
                </div>
                {tasks
                  .sort((a, b) => a.due.localeCompare(b.due))
                  .slice(0, 5)
                  .map(({ item, task, due }) => (
                    <a
                      className="schedule-row"
                      href={`#/items/${encodeURIComponent(item.id)}`}
                      key={`${item.id}-${task.id}`}
                    >
                      <div
                        className={`date-tile ${daysUntil(due) < 0 ? "past" : ""}`}
                      >
                        <span>{Number(due.slice(5, 7))} 月</span>
                        <strong>{due.slice(8)}</strong>
                      </div>
                      <div>
                        <strong>{task.name}</strong>
                        <p>{item.name}</p>
                        <small
                          className={daysUntil(due) < 0 ? "late-text" : "muted"}
                        >
                          {dueLabel(due)}
                        </small>
                      </div>
                    </a>
                  ))}
                {!tasks.length && (
                  <p className="empty">新增定期子項目後，待辦會顯示在這裡。</p>
                )}
              </>
            )}
          </div>
          <div className="tip-card">
            <Droplets size={24} />
            <h3>一點記錄，多一點安心</h3>
            <p>把每次保養的日期與花費留下來，下次需要時，就不用再翻箱倒櫃。</p>
            <span>好好生活，慢慢累積。</span>
          </div>
        </aside>
      </section>
    </>
  );
}
