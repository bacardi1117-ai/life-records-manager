import type { AppsScriptBridge } from "./appsScriptBridge";
import { parseDate } from "../lib/dates";
/** Items wire schema supplied by the deployed backend's owner. No Mock LifeItem conversion. */
export interface SheetsItem {
  item_id: string;
  name: string;
  category: string;
  item_date: string;
  amount: number;
  brand: string;
  model: string;
  location: string;
  warranty_date: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}
export type ItemChanges = Pick<
  SheetsItem,
  | "name"
  | "category"
  | "item_date"
  | "amount"
  | "brand"
  | "model"
  | "location"
  | "warranty_date"
>;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function parseItem(value: unknown): SheetsItem {
  if (
    !object(value) ||
    ![
      "item_id",
      "name",
      "category",
      "item_date",
      "brand",
      "model",
      "location",
      "warranty_date",
      "created_at",
      "updated_at",
    ].every((key) => typeof value[key] === "string") ||
    !value.item_id ||
    typeof value.amount !== "number" ||
    !Number.isFinite(value.amount) ||
    value.amount < 0 ||
    !["active", "archived"].includes(String(value.status))
  ) {
    throw new Error(
      "Items 回傳欄位或型別不相符，請核對後端部署版本；未變更本機紀錄。",
    );
  }
  parseDate(value.item_date as string);
  if (value.warranty_date) parseDate(value.warranty_date as string);
  return { ...value } as unknown as SheetsItem;
}
export function parseItems(value: unknown): SheetsItem[] {
  if (!Array.isArray(value))
    throw new Error("getItems 必須回傳 Items 陣列；原有畫面資料已保留。");
  const items = value.map(parseItem);
  if (new Set(items.map((i) => i.item_id)).size !== items.length)
    throw new Error("Items 回傳重複 item_id，請核對後端資料");
  return items;
}
function changes(value: ItemChanges): ItemChanges {
  const fields = {
    name: value.name.trim(),
    category: value.category.trim(),
    item_date: value.item_date,
    amount: value.amount,
    brand: value.brand.trim(),
    model: value.model.trim(),
    location: value.location.trim(),
    warranty_date: value.warranty_date,
  };
  if (!fields.name || !fields.category) throw new Error("請填寫名稱與分類");
  if (!Number.isFinite(fields.amount) || fields.amount < 0)
    throw new Error("金額須為零或正數");
  parseDate(fields.item_date);
  if (fields.warranty_date) parseDate(fields.warranty_date);
  return fields;
}
export function createSheetsItemsApi(
  bridge: Pick<AppsScriptBridge, "request">,
) {
  return {
    async list() {
      return parseItems(await bridge.request("getItems"));
    },
    async get(item_id: string) {
      return parseItem(await bridge.request("getItem", { item_id }));
    },
    create(payload: ItemChanges) {
      return bridge.request("createItem", changes(payload));
    },
    update(item_id: string, payload: ItemChanges) {
      return bridge.request("updateItem", {
        item_id,
        changes: changes(payload),
      });
    },
    archive(item_id: string) {
      return bridge.request("archiveItem", { item_id });
    },
    restore(item_id: string) {
      return bridge.request("restoreItem", { item_id });
    },
  };
}
