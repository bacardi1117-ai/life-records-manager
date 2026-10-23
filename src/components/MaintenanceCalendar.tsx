import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react";
import type { LifeItem } from "../models";
import type { OverviewSnapshot } from "../api/itemsStore";
import { taipeiToday } from "../lib/dashboard";
import { daysUntil } from "../lib/dates";
import { calendarEventHref, calendarEvents, monthDays, monthKey, shiftMonth } from "../lib/maintenanceCalendar";
import type { CalendarEvent } from "../lib/maintenanceCalendar";

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
function EventLink({ event }: { event: CalendarEvent }) {
  return <a className={`calendar-event ${event.kind === "completed" ? "completed" : event.overdue ? "overdue" : "scheduled"}`}
    href={calendarEventHref(event)} aria-label={`${event.itemName} ${event.name} ${event.kind === "completed" ? "已完成" : event.overdue ? "已逾期" : "預定保養"} ${event.date}`}>
    <span>{event.kind === "completed" ? "已完成" : event.overdue ? "逾期" : "預定"}</span>
    <strong>{event.name}</strong><small>{event.itemName}</small>
  </a>;
}
export default function MaintenanceCalendar({ items, cloud, readOnly, overview, refresh }: {
  items: LifeItem[]; cloud: boolean; readOnly: boolean; overview: OverviewSnapshot; refresh?: () => Promise<void>;
}) {
  const today = taipeiToday();
  const [month, setMonth] = useState(() => monthKey(today));
  const [selectedDate, setSelectedDate] = useState(today);
  const [itemId, setItemId] = useState("");
  const ready = !cloud || (overview.status === "ready" && !readOnly);
  const source = cloud ? "cloud" : "mock";
  const allEvents = useMemo(() => ready ? calendarEvents(items, source, overview.rows, today) : [],
    [items, source, overview.rows, ready, today]);
  const events = itemId ? allEvents.filter(event => event.itemId === itemId) : allEvents;
  const byDate = new Map<string,CalendarEvent[]>();
  for (const event of events) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
  const dayEvents = byDate.get(selectedDate) ?? [];
  const monthEvents = events.filter(event => event.date.startsWith(month));
  const overdueCount = events.filter(event => event.kind === "scheduled" && event.overdue).length;
  const next30Count = events.filter(event => event.kind === "scheduled" && daysUntil(event.date, today) >= 0 && daysUntil(event.date, today) <= 30).length;
  const completedMonth = events.filter(event => event.kind === "completed" && event.date.startsWith(month)).length;
  function changeMonth(delta: number) {
    const next = shiftMonth(month, delta);
    setMonth(next);
    setSelectedDate(`${next}-01`);
  }
  return <div className="maintenance-calendar-page">
    <a href="#/" className="back-link">← 返回生活事項</a>
    <div className="page-heading"><div><div className="eyebrow">MAINTENANCE CALENDAR</div><h1>保養月曆</h1>
      <p>依目前資料來源查看已啟用計畫的下一次保養日與實際完成紀錄。</p></div><CalendarDays size={34}/></div>
    {cloud && <div className="dashboard-refresh" role="status"><span>{overview.status === "ready" && !readOnly
      ? `雲端資料最後成功更新：${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(new Date(overview.updatedAt))}`
      : "雲端保養資料尚未完整讀取"}</span>
      {refresh && <button type="button" className="secondary" onClick={() => void refresh()}>重新讀取月曆</button>}</div>}
    {cloud && overview.status === "error" && <p role="alert" className="error-banner">保養月曆讀取失敗：{overview.error}。請重新讀取；目前不顯示不完整資料。</p>}
    {cloud && overview.status === "loading" && <p role="status">正在讀取雲端保養計畫與完成紀錄…</p>}
    {ready && <section className="calendar-summary" aria-label="保養月曆統計">
      <div><span>已逾期保養</span><strong>{overdueCount}</strong></div>
      <div><span>未來 30 天</span><strong>{next30Count}</strong></div>
      <div><span>本月已完成</span><strong>{completedMonth}</strong></div>
    </section>}
    <div className="calendar-controls">
      <div className="calendar-month-nav"><button type="button" className="secondary" aria-label="上一個月" onClick={() => changeMonth(-1)}><ArrowLeft size={18}/></button>
        <h2 aria-live="polite">{Number(month.slice(0,4))} 年 {Number(month.slice(5,7))} 月</h2>
        <button type="button" className="secondary" aria-label="下一個月" onClick={() => changeMonth(1)}><ArrowRight size={18}/></button>
        <button type="button" className="secondary" onClick={() => { setMonth(monthKey(today)); setSelectedDate(today); }}>回到本月</button></div>
      <label>篩選生活事項 <select aria-label="月曆事項篩選" value={itemId} onChange={event => setItemId(event.target.value)}><option value="">全部事項</option>
        {items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
    {ready ? <>
      <section className="calendar-shell" aria-label={`${month} 保養月曆`}>
        <div className="calendar-grid" role="grid" aria-label={`${month} 月份日期`}>
          {weekdays.map(day => <div className="calendar-weekday" role="columnheader" key={day}>{day}</div>)}
          {monthDays(month).map(({date,inMonth}) => <div key={date} className={`calendar-day ${inMonth ? "" : "other-month"} ${date === today ? "today" : ""} ${date === selectedDate ? "selected" : ""}`} role="gridcell" aria-label={date}>
            <button type="button" className="calendar-day-button" aria-label={`查看 ${date} 的事項，共 ${byDate.get(date)?.length ?? 0} 筆`} aria-pressed={date === selectedDate}
              onClick={() => { setSelectedDate(date); if (!inMonth) setMonth(monthKey(date)); }}>{Number(date.slice(8))}</button>
            <div className="calendar-cell-events">{(byDate.get(date) ?? []).map(event => <EventLink key={event.key} event={event}/>)}</div>
            {(byDate.get(date)?.length ?? 0) > 0 && <small className="calendar-mobile-count">{byDate.get(date)?.length} 筆</small>}
          </div>)}
        </div>
      </section>
      {!monthEvents.length && <p className="empty">{itemId ? "此事項在這個月沒有保養計畫或完成紀錄。" : "這個月沒有保養計畫或完成紀錄。"}目前僅顯示每個計畫的下一次預定日，不推算往後的週期。</p>}
      <section className="panel calendar-day-list" aria-label={`${selectedDate} 當天事項`}><div className="section-heading"><h2>{selectedDate} 的事項</h2><span className="count">{dayEvents.length}</span></div>
        {dayEvents.length ? <div className="calendar-day-events">{dayEvents.map(event => <EventLink key={event.key} event={event}/>)}</div> : <p className="empty">這一天沒有預定保養或完成紀錄。</p>}
      </section>
      <p className="muted small">月曆只顯示已啟用保養計畫的 next_due_date 與實際完成日期。Google Calendar 仍由既有私人服務定期同步；此頁不會寫入日曆。</p>
    </> : <p className="empty">資料完整讀取後才會顯示月曆事件。</p>}
  </div>;
}
