import { describe, expect, it, vi } from "vitest";
import {
  createCalendarSyncRepository,
  isConfirmedCalendarSync,
  parseCalendarSyncStatus,
} from "../src/api/calendarSync";
import { samplePlan } from "./fixtures/googleBridge";

const synced = {
  plan_id: samplePlan.plan_id,
  sync_status: "synced",
  last_synced_at: "2026-10-22 12:00:00",
  error_message: "",
  has_event: true,
};

describe("read-only calendar status adapter", () => {
  it("does not send an unsupported action while the capability is off", async () => {
    const request = vi.fn();
    const repo = createCalendarSyncRepository({ request }, false);
    await expect(repo.get(samplePlan.plan_id)).rejects.toThrow(
      "同步狀態尚未連接",
    );
    expect(request).not.toHaveBeenCalled();
  });
  it("sends only getCalendarSyncStatus with the plan ID when enabled", async () => {
    const request = vi.fn().mockResolvedValue({
      ...synced,
      calendar_id: "TEST_ONLY_NOT_REAL",
      event_id: "TEST_ONLY_NOT_REAL",
    });
    const repo = createCalendarSyncRepository({ request }, true);
    await expect(repo.get(samplePlan.plan_id)).resolves.toEqual(synced);
    expect(request).toHaveBeenCalledExactlyOnceWith("getCalendarSyncStatus", {
      plan_id: samplePlan.plan_id,
    });
  });
  it("rejects another plan ID and malformed replies", () => {
    expect(() =>
      parseCalendarSyncStatus(
        { ...synced, plan_id: "other" },
        samplePlan.plan_id,
      ),
    ).toThrow("識別碼");
    expect(() =>
      parseCalendarSyncStatus(
        { ...synced, has_event: "yes" },
        samplePlan.plan_id,
      ),
    ).toThrow("格式");
  });
  it("does not certify a stale event, absent event or disabled plan", () => {
    expect(isConfirmedCalendarSync(samplePlan, synced)).toBe(true);
    expect(
      isConfirmedCalendarSync(
        { ...samplePlan, updated_at: "2026-10-23 00:00:00" },
        synced,
      ),
    ).toBe(false);
    expect(
      isConfirmedCalendarSync(samplePlan, { ...synced, has_event: false }),
    ).toBe(false);
    expect(
      isConfirmedCalendarSync({ ...samplePlan, enabled: false }, synced),
    ).toBe(false);
    expect(
      isConfirmedCalendarSync(samplePlan, {
        ...synced,
        error_message: "舊錯誤",
      }),
    ).toBe(false);
  });
});
