import { describe, expect, it } from "vitest";
import { calendarEventHref, calendarEvents, monthDays, monthKey, shiftMonth } from "../src/lib/maintenanceCalendar";
import { taipeiToday } from "../src/lib/dashboard";
import type { LifeItem } from "../src/models";
import type { MaintenancePlan } from "../src/api/maintenancePlans";
import type { CloudMaintenanceRecord } from "../src/api/maintenanceRecords";
const item = (id: string): LifeItem => ({ id, name:id, date:"2026-01-01", category:"家電",brand:"",location:"",amount:0,description:"",notes:[],photos:[],tasks:[],history:[] });
const plan = (itemId: string, id: string, date: string, enabled=true): MaintenancePlan => ({ plan_id:id,item_id:itemId,name:`保養${id}`,interval_value:30,interval_unit:"day",calculation_mode:"completion",base_date:"2026-01-01",last_completed_date:"",next_due_date:date,reminder_days:7,enabled,created_at:"",updated_at:"" });
const record = (itemId: string, id: string, date: string): CloudMaintenanceRecord => ({ record_id:id,plan_id:"plan-a",item_id:itemId,title:`完成${id}`,completed_date:date,amount:0,vendor:"",description:"",created_at:"",updated_at:"" });
describe("maintenance calendar", () => {
  it("moves across years and creates the correct month grid", () => {
    expect(shiftMonth("2026-12",1)).toBe("2027-01");
    expect(shiftMonth("2027-01",-1)).toBe("2026-12");
    expect(monthKey("2026-10-23")).toBe("2026-10");
    expect(monthDays("2026-11").filter(day=>day.inMonth)).toHaveLength(30);
    expect(monthDays("2026-11")[0].date).toBe("2026-11-01");
    expect(monthDays("2027-01").filter(day=>day.inMonth).at(-1)?.date).toBe("2027-01-31");
  });
  it("compares Taipei civil dates without a UTC day shift", () => {
    expect(taipeiToday(new Date("2026-12-31T16:15:00Z"))).toBe("2027-01-01");
    const events=calendarEvents([item("a")],"cloud",{a:{plans:[plan("a","plan-a","2026-12-31")],records:[]}},"2027-01-01");
    expect(events[0]).toMatchObject({date:"2026-12-31",overdue:true});
  });
  it("keeps multiple same-day plans and separate record IDs, excluding disabled plans", () => {
    const rows={a:{plans:[plan("a","plan-a","2026-10-24"),plan("a","plan-b","2026-10-24"),plan("a","off","2026-10-24",false)],records:[record("a","rec-one","2026-10-24"),record("a","rec-two","2026-10-24")]},b:{plans:[plan("b","plan-c","2026-10-24")],records:[]}};
    const events=calendarEvents([item("a"),item("b")],"cloud",rows,"2026-10-24");
    expect(events).toHaveLength(5);
    expect(events.filter(event=>event.kind==="scheduled")).toHaveLength(3);
    expect(events.filter(event=>event.kind==="completed").map(event=>event.recordId).sort()).toEqual(["rec-one","rec-two"]);
    expect(events.filter(event=>event.itemId==="b").map(event=>event.planId)).toEqual(["plan-c"]);
    expect(calendarEventHref(events.find(event=>event.recordId==="rec-two")!)).toBe("#/items/a?tab=history&record=rec-two");
    expect(calendarEventHref(events.find(event=>event.planId==="plan-c")!)).toBe("#/items/b?tab=plans&plan=plan-c");
  });
  it("shows only next_due_date rather than inventing future cycles", () => {
    const events=calendarEvents([item("a")],"cloud",{a:{plans:[plan("a","p","2026-10-24")],records:[]}},"2026-10-24");
    expect(events).toHaveLength(1);
    expect(events.filter(event=>event.date.startsWith("2026-11"))).toHaveLength(0);
  });
  it("includes an enabled plan on an archived item in the calendar", () => {
    const archived = { ...item("a"), status: "archived" as const };
    expect(calendarEvents([archived], "cloud", {a:{plans:[plan("a","p","2026-10-24")],records:[]}}, "2026-10-24")).toHaveLength(1);
  });
  it("uses Mock rows only in Mock mode", () => {
    const mock={...item("a"),tasks:[{id:"local",name:"本機保養",intervalDays:30,anchorDate:"2026-10-01"}],history:[]};
    const rows={a:{plans:[plan("a","cloud","2026-10-24")],records:[]}};
    expect(calendarEvents([mock],"mock",rows,"2026-10-24").map(event=>event.planId)).toEqual(["local"]);
  });
});
