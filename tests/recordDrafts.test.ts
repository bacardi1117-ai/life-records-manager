// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { recordDrafts, RECORD_DRAFTS_KEY } from "../src/api/recordDrafts";
import { samplePlan } from "./fixtures/googleBridge";
beforeEach(() => sessionStorage.clear());
it("retains one record ID and fields through reopen and page-style reread", () => {
  const draft = recordDrafts.open(samplePlan.item_id, samplePlan);
  expect(draft.record_id).toMatch(/^[0-9a-f-]{36}$/);
  recordDrafts.save({ ...draft, amount: 245, description: "已完成" });
  expect(recordDrafts.open(samplePlan.item_id, samplePlan)).toMatchObject({
    record_id: draft.record_id,
    amount: 245,
  });
  expect(
    recordDrafts.read(samplePlan.item_id, samplePlan.plan_id)?.description,
  ).toBe("已完成");
  recordDrafts.clear(draft);
  expect(recordDrafts.open(samplePlan.item_id, samplePlan).record_id).not.toBe(
    draft.record_id,
  );
});
it("keeps drafts for different plans and never writes to Mock storage", () => {
  const first = recordDrafts.open(samplePlan.item_id, samplePlan);
  const second = recordDrafts.open(samplePlan.item_id, {
    ...samplePlan,
    plan_id: "other",
  });
  expect(first.record_id).not.toBe(second.record_id);
  expect(recordDrafts.read(samplePlan.item_id, samplePlan.plan_id)).toEqual(
    first,
  );
  expect(sessionStorage.getItem(RECORD_DRAFTS_KEY)).toContain(first.record_id);
  expect(localStorage.getItem("life-records-manager:v1")).toBeNull();
});
it("refuses a changed ID or corrupt existing draft instead of silently replacing it", () => {
  const first = recordDrafts.open(samplePlan.item_id, samplePlan);
  expect(() =>
    recordDrafts.save({ ...first, record_id: crypto.randomUUID() }),
  ).toThrow("已改變");
  sessionStorage.setItem(RECORD_DRAFTS_KEY, "corrupt");
  expect(() => recordDrafts.open(samplePlan.item_id, samplePlan)).toThrow();
});
