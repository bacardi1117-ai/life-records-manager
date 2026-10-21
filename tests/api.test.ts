import { describe, expect, it } from "vitest";
import {
  createMockApi,
  completeMaintenance,
  STORAGE_KEY,
} from "../src/api/mockApi";
import { seedData } from "../src/data/seed";
import { nextDue } from "../src/lib/dates";
function storage(initial?: string) {
  const map = new Map<string, string>(
    initial === undefined ? [] : [[STORAGE_KEY, initial]],
  );
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}
describe("persistent mock API", () => {
  it("seeds only missing data; preserves intentionally empty data", async () => {
    expect(await createMockApi(storage()).list()).toHaveLength(1);
    expect(
      await createMockApi(storage('{"version":1,"items":[]}')).list(),
    ).toEqual([]);
  });
  it("adds and edits without replacing other items", async () => {
    const store = storage();
    const api = createMockApi(store);
    const item = { ...seedData().items[0], id: "new", name: "冷氣" };
    await api.save(item);
    await api.save({ ...item, name: "客廳冷氣" });
    const all = await createMockApi(store).list();
    expect(all).toHaveLength(2);
    expect(all[0].name).toBe("客廳冷氣");
    expect(all[1].name).toBe("電熱水器");
  });
  it("retains completion details and recalculates next date", async () => {
    const api = createMockApi(storage());
    const item = (await api.list())[0];
    const record = {
      ...item.history[0],
      id: "completion",
      date: "2026-04-15",
      amount: 1500,
      note: "保養完成",
      photos: [{ id: "p", name: "photo", url: "data:image/png;base64,test" }],
    };
    await api.complete(item.id, record);
    const updated = (await api.list())[0];
    expect(updated.history.at(-1)).toEqual(record);
    expect(nextDue(updated, updated.tasks[1])).toBe("2026-10-12");
  });
  it("protects corrupt or unsupported stored data", async () => {
    for (const raw of ["broken", '{"version":2,"items":[]}']) {
      const store = storage(raw);
      const api = createMockApi(store);
      await expect(api.list()).rejects.toThrow("原始資料已保留");
      await expect(api.save(seedData().items[0])).rejects.toThrow();
      expect(store.getItem(STORAGE_KEY)).toBe(raw);
    }
  });
  it("reports storage quota errors", async () => {
    const api = createMockApi({
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    await expect(api.save(seedData().items[0])).rejects.toThrow("儲存失敗");
  });
  it("rejects invalid completions", () => {
    const item = seedData().items[0];
    const record = item.history[0];
    for (const patch of [
      { date: "2999-01-01" },
      { date: "2020-01-01" },
      { amount: -1 },
      { taskId: "missing" },
    ])
      expect(() =>
        completeMaintenance(item, { ...record, ...patch }),
      ).toThrow();
  });
});
