import type { LifeItem, MaintenanceRecord } from "../models";
import { mockApi } from "./mockApi";
import type { ItemChanges, SheetsItem } from "./sheetsItems";
import { changes, createSheetsItemsApi } from "./sheetsItems";
export interface WriteResult {
  id: string;
  item?: LifeItem;
  readError?: string;
}
export interface ItemsRepository {
  list(): Promise<LifeItem[]>;
  get(id: string): Promise<LifeItem>;
  create(item: LifeItem): Promise<WriteResult>;
  update(item: LifeItem, original: LifeItem): Promise<WriteResult>;
  setArchived(item: LifeItem, archived: boolean): Promise<WriteResult>;
  saveLocal(item: LifeItem): Promise<WriteResult>;
  complete(id: string, record: MaintenanceRecord): Promise<WriteResult>;
}
export function fromSheets(item: SheetsItem): LifeItem {
  return {
    id: item.item_id,
    name: item.name,
    category: item.category,
    date: item.item_date,
    amount: item.amount,
    brand: item.brand,
    model: item.model,
    location: item.location,
    warrantyDate: item.warranty_date,
    status: item.status,
    description: "",
    notes: [],
    photos: [],
    tasks: [],
    history: [],
  };
}
export function toFields(item: LifeItem): ItemChanges {
  return changes({
    name: item.name,
    category: item.category,
    item_date: item.date,
    amount: item.amount,
    brand: item.brand,
    model: item.model ?? "",
    location: item.location,
    warranty_date: item.warrantyDate ?? "",
  }) as ItemChanges;
}
export function changedFields(
  item: LifeItem,
  original: LifeItem,
): Partial<ItemChanges> {
  if (item.id !== original.id) throw new Error("事項 ID 不相符，拒絕更新");
  const current = toFields(item),
    before = toFields(original);
  return Object.fromEntries(
    Object.entries(current).filter(
      ([key, value]) => value !== before[key as keyof ItemChanges],
    ),
  );
}
export function cloudRepository(
  api: ReturnType<typeof createSheetsItemsApi>,
): ItemsRepository {
  const get = async (id: string) => fromSheets(await api.get(id));
  async function readAfterWrite(id: string): Promise<WriteResult> {
    try {
      return { id, item: await get(id) };
    } catch {
      return {
        id,
        readError:
          "雲端寫入已確認，但重新讀取該筆資料失敗；請重新讀取，不要重複送出。",
      };
    }
  }
  const unsupported = async (): Promise<never> => {
    throw new Error("此操作尚未支援直接寫入雲端 Items");
  };
  return {
    list: async () => (await api.list()).map(fromSheets),
    get,
    async create(item) {
      const result = await api.create(toFields(item));
      if (
        !result ||
        typeof result !== "object" ||
        !("item_id" in result) ||
        typeof result.item_id !== "string" ||
        !result.item_id
      )
        throw new Error(
          "新增回應缺少 item_id，寫入結果尚未確認；請重新讀取核對，勿重複新增。",
        );
      return readAfterWrite(result.item_id);
    },
    async update(item, original) {
      const delta = changedFields(item, original);
      if (Object.keys(delta).length) {
        await api.update(item.id, delta);
        return readAfterWrite(item.id);
      }
      return { id: item.id, item: await get(item.id) };
    },
    async setArchived(item, archived) {
      await (archived ? api.archive(item.id) : api.restore(item.id));
      return readAfterWrite(item.id);
    },
    saveLocal: unsupported,
    complete: unsupported,
  };
}
export function mockRepository(): ItemsRepository {
  const get = async (id: string) => {
    const item = (await mockApi.list()).find((i) => i.id === id);
    if (!item) throw new Error("找不到這件生活事項");
    return item;
  };
  const save = async (item: LifeItem) => {
    await mockApi.save(item);
    return { id: item.id, item: await get(item.id) };
  };
  return {
    list: () => mockApi.list(),
    get,
    create: (item) => save({ ...item, id: crypto.randomUUID() }),
    update: (item, original) => {
      if (item.id !== original.id)
        return Promise.reject(new Error("事項 ID 不相符"));
      return save(item);
    },
    setArchived: (item, archived) =>
      save({ ...item, status: archived ? "archived" : "active" }),
    saveLocal: save,
    async complete(id, record) {
      await mockApi.complete(id, record);
      return { id, item: await get(id) };
    },
  };
}
