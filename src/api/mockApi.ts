import type { LifeItem, MaintenanceRecord, StoreData } from "../models";
import { seedData } from "../data/seed";
import { parseDate, today } from "../lib/dates";
export const STORAGE_KEY = "life-records-manager:v1";
export function validateItem(item: LifeItem): void {
  if (!item.name.trim() || !item.category.trim())
    throw new Error("請填寫名稱與分類");
  parseDate(item.date);
  if (!Number.isFinite(item.amount) || item.amount < 0)
    throw new Error("金額須為零或正數");
  if (
    ![item.id, item.brand, item.location, item.description].every(
      (value) => typeof value === "string",
    ) ||
    ![item.notes, item.photos, item.tasks, item.history].every(Array.isArray)
  ) {
    throw new Error("資料格式不正確");
  }
  const photos = [
    ...item.photos,
    ...item.history.flatMap((record) => record.photos),
  ];
  for (const photo of photos) {
    if (
      !photo ||
      ![photo.id, photo.name, photo.url].every(
        (value) => typeof value === "string",
      )
    )
      throw new Error("照片資料格式不正確");
  }
  for (const note of item.notes) {
    parseDate(note.date);
    if (typeof note.id !== "string" || typeof note.text !== "string")
      throw new Error("備註格式不正確");
  }
  for (const record of item.history) {
    parseDate(record.date);
    if (
      ![record.id, record.taskId, record.taskName, record.note].every(
        (value) => typeof value === "string",
      ) ||
      !Array.isArray(record.photos) ||
      !Number.isFinite(record.amount) ||
      record.amount < 0
    )
      throw new Error("保養紀錄格式不正確");
  }
  for (const task of item.tasks) {
    if (
      !task.name.trim() ||
      !Number.isInteger(task.intervalDays) ||
      task.intervalDays < 1 ||
      task.intervalDays > 36500
    )
      throw new Error("請填寫子項目名稱與有效週期");
    parseDate(task.anchorDate);
  }
}
export function completeMaintenance(
  item: LifeItem,
  record: MaintenanceRecord,
): LifeItem {
  if (!item.tasks.some((t) => t.id === record.taskId))
    throw new Error("找不到保養項目");
  parseDate(record.date);
  if (record.date > today()) throw new Error("完成日期不可晚於今天");
  if (record.date < item.date) throw new Error("完成日期不可早於事項日期");
  if (!Number.isFinite(record.amount) || record.amount < 0)
    throw new Error("金額須為零或正數");
  return { ...item, history: [...item.history, record] };
}
export function createMockApi(storage: Pick<Storage, "getItem" | "setItem">) {
  function read(): StoreData {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return seedData();
    try {
      const data = JSON.parse(raw) as StoreData;
      if (data.version !== 1 || !Array.isArray(data.items)) throw new Error();
      for (const item of data.items) {
        validateItem(item);
        if (
          ![item.notes, item.photos, item.tasks, item.history].every(
            Array.isArray,
          )
        )
          throw new Error();
      }
      return data;
    } catch {
      throw new Error(
        "無法讀取已儲存資料。原始資料已保留，請先備份瀏覽器儲存空間後再處理。",
      );
    }
  }
  function write(data: StoreData) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      throw new Error(
        "儲存失敗，可能是瀏覽器空間不足。請減少照片大小後重試；原有資料未被覆蓋。",
      );
    }
  }
  return {
    async list(): Promise<LifeItem[]> {
      return structuredClone(read().items);
    },
    async save(item: LifeItem): Promise<void> {
      validateItem(item);
      const data = read();
      const index = data.items.findIndex((i) => i.id === item.id);
      if (index < 0) data.items.unshift(item);
      else data.items[index] = item;
      write(data);
    },
    async complete(itemId: string, record: MaintenanceRecord): Promise<void> {
      const data = read();
      const index = data.items.findIndex((i) => i.id === itemId);
      if (index < 0) throw new Error("找不到生活事項");
      data.items[index] = completeMaintenance(data.items[index], record);
      write(data);
    },
  };
}
export const mockApi = createMockApi({
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
