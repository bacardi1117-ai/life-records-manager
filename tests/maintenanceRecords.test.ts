import { expect, it, vi } from "vitest";
import {
  createMaintenanceRecordsRepository,
  matchesSubmission,
  parseMaintenanceRecord,
  totalMaintenanceAmount,
} from "../src/api/maintenanceRecords";
import { sampleRecord } from "./fixtures/googleBridge";
const make = () => {
  const request = vi.fn();
  return { request, repo: createMaintenanceRecordsRepository({ request }) };
};
it("reads and sorts only the requested item's records", async () => {
  const { request, repo } = make();
  const later = {
    ...sampleRecord,
    record_id: "later",
    completed_date: "2026-10-22",
    amount: 200,
  };
  request.mockResolvedValue([sampleRecord, later]);
  expect(await repo.byItem(sampleRecord.item_id)).toEqual([
    later,
    sampleRecord,
  ]);
  expect(request).toHaveBeenCalledWith("getMaintenanceRecordsByItem", {
    item_id: sampleRecord.item_id,
  });
  expect(totalMaintenanceAmount([later, sampleRecord, later])).toBe(550);
});
it("rejects foreign or duplicate item and plan records", async () => {
  const { request, repo } = make();
  request
    .mockResolvedValueOnce([{ ...sampleRecord, item_id: "other" }])
    .mockResolvedValueOnce([sampleRecord, sampleRecord]);
  await expect(repo.byItem(sampleRecord.item_id)).rejects.toThrow();
  await expect(repo.byPlan(sampleRecord.plan_id)).rejects.toThrow();
});
it("gets by record ID and verifies returned ID", async () => {
  const { request, repo } = make();
  request
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(sampleRecord)
    .mockResolvedValueOnce(sampleRecord);
  expect(await repo.get("missing")).toBeNull();
  expect(await repo.get(sampleRecord.record_id)).toEqual(sampleRecord);
  await expect(repo.get("wrong")).rejects.toThrow("不同完成紀錄");
});
it("creates with stable ID, whitelisted fields and accepts duplicate acknowledgement", async () => {
  const { request, repo } = make();
  request.mockResolvedValue({
    success: true,
    duplicate: true,
    record_id: sampleRecord.record_id,
    record: sampleRecord,
  });
  expect(
    await repo.create({ ...sampleRecord, created_at: "injected" }),
  ).toEqual({ duplicate: true, record_id: sampleRecord.record_id });
  expect(request).toHaveBeenCalledWith("createMaintenanceRecord", {
    record_id: sampleRecord.record_id,
    plan_id: sampleRecord.plan_id,
    completed_date: sampleRecord.completed_date,
    title: sampleRecord.title,
    amount: sampleRecord.amount,
    vendor: sampleRecord.vendor,
    description: sampleRecord.description,
  });
});
it("detects acknowledgement and record content conflicts", async () => {
  const { request, repo } = make();
  request
    .mockResolvedValueOnce({
      success: true,
      duplicate: false,
      record_id: "wrong",
    })
    .mockResolvedValueOnce({
      success: true,
      duplicate: true,
      record_id: sampleRecord.record_id,
      record: { ...sampleRecord, amount: 999 },
    });
  await expect(repo.create(sampleRecord)).rejects.toThrow("不符");
  await expect(repo.create(sampleRecord)).rejects.toThrow("衝突");
  expect(
    matchesSubmission({ ...sampleRecord, amount: 999 }, sampleRecord),
  ).toBe(false);
});
it.each([
  { completed_date: "2026-02-30" },
  { amount: -1 },
  { amount: Infinity },
  { title: "" },
  { description: "x".repeat(5001) },
])("rejects invalid record case %#", (patch) => {
  expect(() => parseMaintenanceRecord({ ...sampleRecord, ...patch })).toThrow();
});
