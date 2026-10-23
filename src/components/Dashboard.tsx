import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, ClipboardList, Plus, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import type { LifeItem } from "../models";
import type { OverviewSnapshot } from "../api/itemsStore";
import { money } from "../lib/dates";
import { buildDashboard, filterItems, maintenanceCosts, taipeiToday } from "../lib/dashboard";
import type { DashboardFilters, DueEntry } from "../lib/dashboard";
import { DashboardCover, useDashboardCovers } from "./DashboardCover";

const initialFilters: DashboardFilters = { query: "", category: "", status: "", plan: "", due: "" };
const itemUrl = (id: string) => `#/items/${encodeURIComponent(id)}`;
const relative = (days: number) => days < 0 ? `逾期 ${-days} 天` : days === 0 ? "今天" : `剩餘 ${days} 天`;
function DueList({ rows, empty }: { rows: DueEntry[]; empty: string }) {
  return rows.length ? <div className="dashboard-list">{rows.map(row => <a key={`${row.item.id}:${row.id}`} href={itemUrl(row.item.id)}>
    <time>{row.date}</time><span><strong>{row.name}</strong><small>{row.item.name}</small></span><em className={row.days < 0 ? "late-text" : ""}>{relative(row.days)}</em>
  </a>)}</div> : <p className="empty">{empty}</p>;
}
export default function Dashboard({ items, add, cloud = false, readOnly = false, overview, refresh }: {
  cloud?: boolean; readOnly?: boolean; items: LifeItem[]; add: () => void;
  overview: OverviewSnapshot; refresh?: () => Promise<void>;
}) {
  const [filters, setFilters] = useState<DashboardFilters>(initialFilters);
  const [year, setYear] = useState(Number(taipeiToday().slice(0, 4)));
  const today = taipeiToday();
  const ready = !cloud || (overview.status === "ready" && !readOnly);
  const data = useMemo(() => ready ? buildDashboard(items, cloud ? "cloud" : "mock", overview.rows, today) : null,
    [items, cloud, overview.rows, ready, today]);
  const filtered = filterItems(items, filters, cloud ? "cloud" : "mock", ready ? overview.rows : {}, today);
  const costs = data ? maintenanceCosts(data.completed, today, year) : null;
  const { photos: covers, error: coverError } = useDashboardCovers(cloud);
  const set = (key: keyof DashboardFilters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  const years = data ? [...new Set([year, Number(today.slice(0,4)), ...data.completed.map(row => Number(row.date.slice(0,4)))])].sort((a,b) => b-a) : [year];
  return <>
    <div className="page-heading"><div><div className="eyebrow">YOUR EVERYDAY, ORGANIZED</div><h1>把生活，照顧得更好。</h1>
      <p>重要的小事都記在這裡，讓每一天更從容。</p></div>
      <button className="primary" onClick={add} disabled={readOnly}><Plus size={18} />新增生活事項</button></div>
    <div className="dashboard-refresh" role="status">
      <span>{cloud ? overview.status === "ready" && !readOnly ? `雲端資料最後成功更新：${new Intl.DateTimeFormat("zh-TW", {timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short"}).format(new Date(overview.updatedAt))}` : "雲端保養資料尚未完整讀取" : "本機 Mock 資料"}</span>
      {cloud && refresh && <button type="button" className="secondary" onClick={() => void refresh()}>重新讀取看板</button>}
    </div>
    {cloud && overview.status === "error" && <p role="alert" className="error-banner">保養看板讀取失敗：{overview.error}。目前不顯示費用或提醒統計。</p>}
    {cloud && overview.status === "loading" && <p role="status">正在讀取雲端保養計畫與完成紀錄…</p>}
    {coverError && <p role="alert" className="error-banner">私人封面讀取失敗：{coverError}</p>}
    <section className="stats" aria-label="事項統計">
      <div><span className="stat-icon green"><ClipboardList /></span><div><p>生活事項</p><strong>{items.length}<small>件</small></strong></div></div>
      <div><span className="stat-icon amber"><CalendarDays /></span><div><p>30 天內待保養</p><strong>{data ? data.next30.length : "—"}<small>項</small></strong></div></div>
      <div><span className="stat-icon rose"><ShieldCheck /></span><div><p>已逾期保養</p><strong>{data ? data.overdue.length : "—"}<small>項</small></strong></div></div>
    </section>
    <section className="dashboard-grid"><div>
      <div className="section-heading"><h2>我的生活事項 <span className="count">{filtered.length}</span></h2><span className="muted small">讓每件事都有跡可循</span></div>
      <div className="dashboard-filters">
        <label className="search"><Search size={18}/><input aria-label="搜尋事項" placeholder="搜尋名稱、品牌、型號或位置…" value={filters.query} onChange={e => set("query", e.target.value)} /></label>
        <label className="filter"><SlidersHorizontal size={16}/><select aria-label="分類篩選" value={filters.category} onChange={e => set("category",e.target.value)}>
          <option value="">全部分類</option>{[...new Set(items.map(i => i.category))].map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="filter"><select aria-label="狀態篩選" value={filters.status} onChange={e => set("status",e.target.value)}><option value="">全部狀態</option><option value="active">使用中</option><option value="archived">已封存</option></select></label>
        <label className="filter"><select aria-label="保養計畫篩選" value={filters.plan} disabled={!ready} onChange={e => set("plan",e.target.value)}><option value="">全部計畫</option><option value="yes">有定期保養</option><option value="no">無定期保養</option></select></label>
        <label className="filter"><select aria-label="保養日期篩選" value={filters.due} disabled={!ready} onChange={e => set("due",e.target.value)}><option value="">全部日期</option><option value="overdue">已逾期</option><option value="7">未來 7 天</option><option value="30">未來 30 天</option></select></label>
        <button type="button" className="secondary" onClick={() => setFilters(initialFilters)}>清除條件</button>
      </div>
      <div className="item-grid">{filtered.map(item => {
        const due = data?.due.find(row => row.item.id === item.id);
        return <a href={itemUrl(item.id)} className="item-card" key={item.id}>
          <div className="item-cover">{cloud ? <DashboardCover photo={covers[item.id]} /> : item.photos[0] ? <img src={item.photos[0].url} alt={item.photos[0].name} /> : <div className="cover-placeholder"><ClipboardList size={64}/></div>}
            <span className="category-badge">{item.category}</span><span className="open-arrow"><ArrowUpRight size={18}/></span></div>
          <div className="item-body"><h3>{item.name}</h3><p className="muted">{item.location || "尚未設定地點"}</p>
            <div className="item-meta"><span><CalendarDays size={14}/>{item.date}</span><span>{ready ? `${cloud ? overview.rows[item.id]?.plans.length ?? 0 : item.tasks.length} 個定期項目` : "保養資料待讀取"}</span></div>
            <div className="item-due"><span className={`dot ${due && due.days < 0 ? "late" : ""}`}/>{item.status === "archived" ? "已封存" : due ? `下次保養 ${due.date} · ${relative(due.days)}` : ready ? "尚未設定定期保養" : "保養日期待讀取"}</div>
            <div className="warranty-line">保固：{!item.warrantyDate ? "未填寫" : `${item.warrantyDate} · ${data?.warranties.find(row => row.item.id === item.id)?.state === "expired" ? "已到期" : data?.warranties.find(row => row.item.id === item.id)?.state === "soon" ? "30 天內到期" : "尚未到期"}`}</div>
          </div></a>;
      })}<button className="add-card" onClick={add} disabled={readOnly}><span><Plus size={26}/></span><strong>新增一件生活事項</strong><p>家電、愛車、生活裡的大小事</p></button></div>
      {filtered.length === 0 && <p className="empty">沒有符合的事項，試試其他條件。</p>}
    </div><aside><div className="section-heading"><h2>保養小日曆</h2><CalendarDays size={19}/></div>
      <div className="schedule-card">{!data ? <p className="empty">保養資料讀取完成後顯示提醒。</p> : <>
        <h3>已逾期</h3><DueList rows={data.overdue.slice(0,5)} empty="目前沒有逾期保養。"/>
        <h3>未來 7 天</h3><DueList rows={data.next7.slice(0,5)} empty="未來 7 天沒有保養。"/>
        <h3>未來 30 天</h3><DueList rows={data.next30.slice(0,5)} empty="未來 30 天沒有保養。"/>
      </>}</div></aside></section>
    {data && costs && <div className="dashboard-overview-grid">
      <section className="panel"><div className="section-heading"><h2>最近完成保養</h2></div>{data.completed.length ? <div className="dashboard-list">{data.completed.slice(0,5).map(row => <a href={itemUrl(row.item.id)} key={row.id}><time>{row.date}</time><span><strong>{row.name}</strong><small>{row.item.name}</small></span><em>{money(row.amount)}</em></a>)}</div> : <p className="empty">尚無完成紀錄。</p>}</section>
      <section className="panel"><div className="section-heading"><h2>設備保固</h2></div>{data.warranties.length ? <div className="dashboard-list">{data.warranties.filter(row => row.state === "expired" || row.state === "soon").slice(0,5).map(row => <a href={itemUrl(row.item.id)} key={row.item.id}><time>{row.date}</time><span><strong>{row.item.name}</strong><small>設備保固</small></span><em>{row.state === "expired" ? `已到期 ${-row.days} 天` : relative(row.days)}</em></a>)}</div> : null}{!data.warranties.some(row => row.state === "expired" || row.state === "soon") && <p className="empty">近期沒有到期保固。</p>}</section>
      <section className="panel cost-panel"><div className="section-heading"><h2>保養費用統計</h2><label>年度 <select aria-label="費用年度" value={year} onChange={e => setYear(Number(e.target.value))}>{years.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
        <div className="cost-totals"><p>全部累計<strong>{money(costs.total)}</strong></p><p>{year} 年<strong>{money(costs.annual)}</strong></p><p>最近 12 個月<strong>{money(costs.last12)}</strong></p></div>
        <h3>各事項費用排行</h3>{costs.ranking.length ? <ol className="cost-ranking">{costs.ranking.map(row => <li key={row.item.id}><a href={itemUrl(row.item.id)}>{row.item.name}</a><strong>{money(row.amount)}</strong></li>)}</ol> : <p className="empty">尚無保養費用。</p>}
        <h3>月度費用趨勢</h3><div className="cost-trend" aria-label="最近 12 個月保養費用趨勢">{costs.trend.map(row => <div key={row.month} title={`${row.month} ${money(row.amount)}`} aria-label={`${row.month} ${money(row.amount)}`}><span style={{height: `${costs.last12 ? Math.max(3,row.amount / Math.max(...costs.trend.map(x => x.amount),1) * 100) : 3}%`}}/><small>{row.month.slice(5)}</small></div>)}</div>
      </section>
    </div>}
  </>;
}
