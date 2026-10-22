import { expect, it, vi } from "vitest";
import {
  createMaintenancePlansRepository,
  parseMaintenancePlan,
  planFields,
} from "../src/api/maintenancePlans";
import { samplePlan } from "./fixtures/googleBridge";
const setup = () => {
  const request = vi.fn();
  return { request, api: createMaintenancePlansRepository({ request }) };
};
it("lists the exact parent without converting dates or timestamps", async () => {
  const { request, api } = setup();
  request.mockResolvedValue([samplePlan]);
  expect(await api.list(samplePlan.item_id)).toEqual([samplePlan]);
  expect(request).toHaveBeenCalledWith("getMaintenancePlans", {
    item_id: samplePlan.item_id,
  });
});
it.each([
  { plans: [samplePlan, samplePlan], reason: "duplicate" },
  { plans: [{ ...samplePlan, item_id: "other" }], reason: "foreign parent" },
  { plans: { plans: [] }, reason: "wrapped array" },
])("rejects $reason lists", async ({ plans }) => {
  const { request, api } = setup();
  request.mockResolvedValue(plans);
  await expect(api.list(samplePlan.item_id)).rejects.toThrow();
});
it("gets a plan or null and rejects a mismatched ID", async () => {
  const { request, api } = setup();
  request
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(samplePlan)
    .mockResolvedValueOnce(samplePlan);
  expect(await api.get("missing")).toBeNull();
  expect(await api.get(samplePlan.plan_id)).toEqual(samplePlan);
  await expect(api.get("wrong")).rejects.toThrow("不同保養計畫");
});
it("create whitelists fields and takes parent ID from its context", async () => {
  const { request, api } = setup();
  request.mockResolvedValue({
    success: true,
    plan_id: "new",
    item_id: "parent",
  });
  await api.create("parent", samplePlan);
  expect(request).toHaveBeenCalledWith("createMaintenancePlan", {
    item_id: "parent",
    ...planFields(samplePlan),
  });
});
it("update sends only changed editable fields and verifies ownership first", async () => {
  const { request, api } = setup();
  request
    .mockResolvedValueOnce(samplePlan)
    .mockResolvedValueOnce({
      success: true,
      plan: { ...samplePlan, interval_value: 12 },
    });
  await api.update(samplePlan.item_id, samplePlan, {
    ...samplePlan,
    interval_value: 12,
    item_id: "injected",
    enabled: false,
  } as typeof samplePlan);
  expect(request.mock.calls).toEqual([
    ["getMaintenancePlan", { plan_id: samplePlan.plan_id }],
    [
      "updateMaintenancePlan",
      { plan_id: samplePlan.plan_id, changes: { interval_value: 12 } },
    ],
  ]);
});
it("refuses update and enable for a plan belonging to another item", async () => {
  const { request, api } = setup();
  request.mockResolvedValue({ ...samplePlan, item_id: "other" });
  await expect(
    api.update(samplePlan.item_id, samplePlan, {
      ...samplePlan,
      name: "changed",
    }),
  ).rejects.toThrow("不屬於");
  await expect(
    api.setEnabled(samplePlan.item_id, samplePlan.plan_id, false),
  ).rejects.toThrow("不屬於");
  expect(
    request.mock.calls.every(([action]) => action === "getMaintenancePlan"),
  ).toBe(true);
});
it.each([true, false])("enable=%s sends only plan ID", async (enabled) => {
  const { request, api } = setup();
  request
    .mockResolvedValueOnce(samplePlan)
    .mockResolvedValueOnce({
      success: true,
      plan_id: samplePlan.plan_id,
      enabled,
    });
  await api.setEnabled(samplePlan.item_id, samplePlan.plan_id, enabled);
  expect(request).toHaveBeenLastCalledWith(
    enabled ? "enableMaintenancePlan" : "disableMaintenancePlan",
    { plan_id: samplePlan.plan_id },
  );
});
it.each([
  { interval_value: 0 },
  { interval_value: 1.5 },
  { interval_unit: "week" },
  { calculation_mode: "unknown" },
  { base_date: "2026-02-30" },
  { reminder_days: -1 },
  { enabled: "false" },
])("rejects invalid fields %j", (patch) => {
  expect(() => parseMaintenancePlan({ ...samplePlan, ...patch })).toThrow();
});
it("rejects unsuccessful writes and mismatched acknowledgements", async () => {
  const { request, api } = setup();
  request
    .mockResolvedValueOnce({ success: false })
    .mockResolvedValueOnce({ success: true, plan_id: "new", item_id: "wrong" });
  await expect(api.create(samplePlan.item_id, samplePlan)).rejects.toThrow(
    "未確認",
  );
  await expect(api.create(samplePlan.item_id, samplePlan)).rejects.toThrow(
    "不符",
  );
});
