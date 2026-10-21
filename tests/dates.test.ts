import { describe, expect, it } from "vitest";
import { addDays, daysUntil, nextDue, parseDate } from "../src/lib/dates";
import { seedData } from "../src/data/seed";
describe("calendar date calculations", () => {
  it("handles leap years and year boundaries", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
  });
  it("uses calendar days across DST", () => {
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(daysUntil("2026-03-09", "2026-03-07")).toBe(2);
  });
  it("rejects invalid dates and intervals", () => {
    expect(() => parseDate("2025-02-29")).toThrow();
    for (const days of [0, -1, 1.5, 36501])
      expect(() => addDays("2026-01-01", days)).toThrow();
  });
  it("uses anchor date before first completion", () => {
    const item = seedData().items[0];
    item.history = [];
    expect(nextDue(item, item.tasks[0])).toBe("2026-10-01");
  });
  it("uses latest actual completion irrespective of insertion order", () => {
    const item = seedData().items[0];
    item.history.push({ ...item.history[0], id: "older", date: "2026-02-01" });
    expect(nextDue(item, item.tasks[1])).toBe("2026-09-28");
  });
  it.each([30, 60, 180, 365, 90])("supports %i days", (days) =>
    expect(daysUntil(addDays("2026-01-01", days), "2026-01-01")).toBe(days),
  );
});
