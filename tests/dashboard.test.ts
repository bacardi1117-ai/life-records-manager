import { describe, expect, it } from "vitest";
import { buildDashboard, filterItems, maintenanceCosts, taipeiToday, warrantyState } from "../src/lib/dashboard";
import type { LifeItem } from "../src/models";
import type { MaintenancePlan } from "../src/api/maintenancePlans";
import type { CloudMaintenanceRecord } from "../src/api/maintenanceRecords";
const item = (id: string, extras: Partial<LifeItem> = {}): LifeItem => ({ id, name: id, date: "2026-01-01", category: "家電", brand: "冷氣品牌", model: "ABC-1", location: "客廳", amount: 99999, description: "", notes: [], photos: [], tasks: [], history: [], status: "active", ...extras });
const plan = (itemId: string, id: string, date: string): MaintenancePlan => ({ plan_id:id,item_id:itemId,name:"清洗",interval_value:30,interval_unit:"day",calculation_mode:"completion",base_date:"2026-01-01",last_completed_date:"",next_due_date:date,reminder_days:7,enabled:true,created_at:"",updated_at:"" });
const record = (itemId: string, id: string, date: string, amount: number): CloudMaintenanceRecord => ({record_id:id,item_id:itemId,plan_id:`plan-${itemId}`,title:"完成清洗",completed_date:date,amount,vendor:"",description:"",created_at:"",updated_at:""});
describe("home overview", () => {
  it("uses Taipei civil dates near UTC midnight", () => {
    expect(taipeiToday(new Date("2026-10-22T16:30:00Z"))).toBe("2026-10-23");
    expect(taipeiToday(new Date("2026-10-22T15:59:00Z"))).toBe("2026-10-22");
  });
  it("separates overdue, 7/30 day, sorted recent records and owners", () => {
    const items=[item("a"),item("b")];
    const rows={a:{plans:[plan("a","pa","2026-10-22")],records:[record("a","r1","2026-10-20",300)]},b:{plans:[plan("b","pb","2026-10-29"),plan("b","pc","2026-11-10")],records:[record("b","r2","2026-10-21",500)]}};
    const data=buildDashboard(items,"cloud",rows,"2026-10-23");
    expect(data.overdue.map(x=>x.id)).toEqual(["pa"]);
    expect(data.next7.map(x=>x.id)).toEqual(["pb"]);
    expect(data.next30.map(x=>x.id)).toEqual(["pb","pc"]);
    expect(data.completed.map(x=>x.id)).toEqual(["r2","r1"]);
    expect(data.completed[0].item.id).toBe("b");
  });
  it("deduplicates record IDs, excludes purchase amounts, retains zero and shows monthly values", () => {
    const items=[item("a")];
    const rows={a:{plans:[],records:[record("a","one","2026-10-03",100),record("a","one","2026-10-03",100),record("a","zero","2026-09-01",0)]}};
    const result=maintenanceCosts(buildDashboard(items,"cloud",rows,"2026-10-23").completed,"2026-10-23",2026);
    expect(result.total).toBe(100);
    expect(result.annual).toBe(100);
    expect(result.last12).toBe(100);
    expect(result.ranking[0].amount).toBe(100);
    expect(result.trend.at(-1)).toEqual({month:"2026-10",amount:100});
  });
  it("classifies missing warranty separately and combines search filters", () => {
    expect(["", "2026-10-22", "2026-11-10", "2027-01-01"].map(x=>warrantyState(x,"2026-10-23"))).toEqual(["missing","expired","soon","future"]);
    const items=[item("a",{name:"冷氣機"}),item("b",{name:"冰箱",category:"廚房",status:"archived"})];
    const rows={a:{plans:[plan("a","pa","2026-10-22")],records:[]},b:{plans:[],records:[]}};
    expect(filterItems(items,{query:"abc-1",category:"家電",status:"active",plan:"yes",due:"overdue"},"cloud",rows,"2026-10-23").map(x=>x.id)).toEqual(["a"]);
    expect(filterItems(items,{query:"客廳",category:"廚房",status:"",plan:"",due:""},"cloud",rows,"2026-10-23").map(x=>x.id)).toEqual(["b"]);
    expect(() => buildDashboard(items,"cloud",{},"2026-10-23")).toThrow();
  });
  it("keeps Mock plans and records separate from cloud rows", () => {
    const items=[item("a",{tasks:[{id:"local",name:"本機保養",anchorDate:"2026-10-01",intervalDays:30}],history:[{id:"local-record",taskId:"local",taskName:"本機保養",date:"2026-10-02",amount:20,note:"",photos:[]} ]})];
    expect(buildDashboard(items,"mock",{a:{plans:[plan("a","cloud","2026-10-22")],records:[record("a","cloud-record","2026-10-02",900)]}},"2026-10-23").completed[0].amount).toBe(20);
  });
});
