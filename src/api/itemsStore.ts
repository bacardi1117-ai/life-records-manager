import type { DataSource, LifeItem, MaintenanceRecord } from "../models";
import { AppsScriptBridge, validateWebAppUrl } from "./appsScriptBridge";
import { connectionSettings } from "./connectionSettings";
import { createSheetsItemsApi } from "./sheetsItems";
import { cloudRepository, mockRepository } from "./itemsRepository";
import type { ItemsRepository, WriteResult } from "./itemsRepository";
import { createMaintenancePlansRepository } from "./maintenancePlans";
import type {
  MaintenancePlan,
  MaintenancePlanFields,
  MaintenancePlansRepository,
} from "./maintenancePlans";
export interface PlansSnapshot {
  itemId: string | null;
  rows: MaintenancePlan[];
  status: "idle" | "loading" | "ready" | "error";
  error: string;
  notice: string;
}
const emptyPlans = (): PlansSnapshot => ({
  itemId: null,
  rows: [],
  status: "idle",
  error: "",
  notice: "",
});
interface Snapshot {
  plans: PlansSnapshot;
  mode: DataSource | null;
  url: string;
  status: "loading" | "connecting" | "ready" | "error" | "disconnected";
  items: LifeItem[];
  selected: LifeItem | null;
  detailState: "idle" | "loading" | "ready" | "error";
  busy: boolean;
  stale: boolean;
  error: string;
  notice: string;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "資料操作失敗";
export class ItemsStore {
  private state: Snapshot = {
    plans: emptyPlans(),
    mode: null,
    url: "",
    status: "loading",
    items: [],
    selected: null,
    detailState: "idle",
    busy: false,
    stale: false,
    error: "",
    notice: "",
  };
  private listeners = new Set<() => void>();
  private repository: ItemsRepository | null = null;
  private bridge: AppsScriptBridge | null = null;
  private plansRepository: MaintenancePlansRepository | null = null;
  private planRequest = 0;
  private epoch = 0;
  private detailRequest = 0;
  private detailId: string | null = null;
  constructor(private host: () => HTMLElement | null) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private emit(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private reset(mode: DataSource, status: Snapshot["status"]) {
    this.epoch++;
    this.detailRequest++;
    this.bridge?.dispose();
    this.bridge = null;
    this.repository = null;
    this.plansRepository = null;
    this.planRequest++;
    this.detailId = null;
    this.emit({
      plans: emptyPlans(),
      mode,
      status,
      items: [],
      selected: null,
      detailState: "idle",
      busy: false,
      stale: true,
      error: "",
      notice: "",
    });
    return this.epoch;
  }
  start = async () => {
    try {
      const url = connectionSettings.read(),
        choice = connectionSettings.readMode();
      this.emit({ url });
      if (choice === "cloud" || (choice === null && url))
        await this.connect(url);
      else await this.useMock(false);
    } catch (error) {
      this.emit({ status: "error", error: message(error) });
    }
  };
  connect = async (value: string) => {
    if (this.state.busy) return;
    let url: string;
    try {
      url = validateWebAppUrl(value);
      connectionSettings.saveMode("cloud");
    } catch (error) {
      this.emit({
        mode: this.state.mode ?? "cloud",
        status: "error",
        stale: true,
        error: message(error),
      });
      return;
    }
    const oldItems =
      this.state.mode === "cloud" && this.state.url === url
        ? this.state.items
        : [];
    const generation = this.reset("cloud", "connecting");
    this.emit({ items: oldItems, url });
    try {
      const host = this.host();
      if (!host) throw new Error("無法建立連線容器");
      const bridge = new AppsScriptBridge(host);
      this.bridge = bridge;
      await bridge.connect(url);
      const repository = cloudRepository(createSheetsItemsApi(bridge));
      const items = await repository.list();
      if (generation !== this.epoch) return;
      connectionSettings.save(url);
      this.repository = repository;
      this.plansRepository = createMaintenancePlansRepository(bridge);
      this.emit({
        items,
        status: "ready",
        stale: false,
        notice: "已載入 Google Sheets 雲端資料；未上傳任何 Mock 紀錄。",
      });
    } catch (error) {
      if (generation !== this.epoch) return;
      this.bridge?.dispose();
      this.bridge = null;
      this.repository = null;
      this.plansRepository = null;
      this.planRequest++;
      this.emit({ status: "error", stale: true, error: message(error) });
    }
  };
  useMock = async (persist = true) => {
    if (this.state.busy) return;
    try {
      if (persist) connectionSettings.saveMode("mock");
    } catch (error) {
      this.emit({ error: message(error) });
      return;
    }
    const generation = this.reset("mock", "loading");
    const repository = mockRepository();
    try {
      const items = await repository.list();
      if (generation === this.epoch) {
        this.repository = repository;
        this.emit({ items, status: "ready", stale: false });
      }
    } catch (error) {
      if (generation === this.epoch)
        this.emit({ status: "error", error: message(error) });
    }
  };
  disconnect = (removeUrl = false) => {
    if (this.state.busy) return;
    try {
      if (removeUrl) connectionSettings.remove();
    } catch (error) {
      this.emit({ error: message(error) });
      return;
    }
    if (removeUrl && this.state.mode === "mock") {
      this.emit({
        url: "",
        notice: "已移除雲端網址，本機 Mock 紀錄保持不變。",
      });
      return;
    }
    this.epoch++;
    this.detailRequest++;
    this.bridge?.dispose();
    this.bridge = null;
    this.repository = null;
    this.plansRepository = null;
    this.planRequest++;
    this.emit({
      status: "disconnected",
      stale: true,
      url: removeUrl ? "" : this.state.url,
      error: "",
      notice: "已中斷連線，未切換為 Mock；本機紀錄未變更。",
    });
  };
  dispose = () => {
    this.epoch++;
    this.detailRequest++;
    this.bridge?.dispose();
    this.bridge = null;
    this.repository = null;
    this.plansRepository = null;
    this.planRequest++;
  };
  private upsert(item: LifeItem, items = this.state.items) {
    return items.some((i) => i.id === item.id)
      ? items.map((i) => (i.id === item.id ? item : i))
      : [item, ...items];
  }
  openItem = async (id: string) => {
    const generation = this.epoch,
      request = ++this.detailRequest;
    this.detailId = id;
    this.planRequest++;
    this.emit({ plans: emptyPlans() });
    if (!this.repository || this.state.status !== "ready") return;
    this.emit({
      selected: null,
      detailState: "loading",
      error: this.state.stale ? this.state.error : "",
    });
    try {
      const item = await this.repository.get(id);
      if (generation === this.epoch && request === this.detailRequest)
        this.emit({
          selected: item,
          detailState: "ready",
          items: this.upsert(item),
        });
    } catch (error) {
      if (generation === this.epoch && request === this.detailRequest)
        this.emit({
          detailState: "error",
          stale: this.state.mode === "cloud" || this.state.stale,
          error:
            this.state.stale && this.state.error
              ? this.state.error
              : message(error),
        });
    }
  };
  closeItem = () => {
    this.detailRequest++;
    this.detailId = null;
    this.planRequest++;
    this.emit({ selected: null, detailState: "idle", plans: emptyPlans() });
  };
  refresh = async () => {
    if (!this.repository || this.state.busy) return;
    const generation = this.epoch,
      request = ++this.detailRequest,
      id = this.detailId,
      repository = this.repository;
    this.emit({ busy: true, error: "", notice: "" });
    try {
      const items = await repository.list();
      const selected = id ? await repository.get(id) : null;
      if (generation === this.epoch)
        this.emit({
          items: selected ? this.upsert(selected, items) : items,
          stale: false,
          ...(request === this.detailRequest
            ? { selected, detailState: selected ? "ready" : "idle" }
            : {}),
        });
    } catch (error) {
      if (generation === this.epoch)
        this.emit({ error: message(error), stale: true });
    } finally {
      if (generation === this.epoch) this.emit({ busy: false });
    }
  };
  private async write(
    action: (repository: ItemsRepository) => Promise<WriteResult>,
  ): Promise<string> {
    if (
      !this.repository ||
      this.state.status !== "ready" ||
      this.state.stale ||
      this.state.busy
    )
      throw new Error("資料來源尚未就緒，請先重新連線或讀取");
    const generation = this.epoch;
    this.emit({ busy: true, error: "", notice: "" });
    try {
      const result = await action(this.repository);
      if (generation !== this.epoch)
        throw new Error("資料來源已切換，請確認原來源的寫入結果");
      if (result.item)
        this.emit({
          items: this.upsert(result.item),
          ...(this.detailId === result.id
            ? { selected: result.item, detailState: "ready" }
            : {}),
        });
      if (result.readError) this.emit({ stale: true, error: result.readError });
      else
        this.emit({
          notice:
            this.state.mode === "cloud"
              ? "已儲存至 Google Sheets。"
              : "已儲存至本機 Mock。",
        });
      return result.id;
    } catch (error) {
      if (generation === this.epoch)
        this.emit({
          error: message(error),
          stale: this.state.mode === "cloud",
        });
      throw error;
    } finally {
      if (generation === this.epoch) this.emit({ busy: false });
    }
  }
  private emitPlans(patch: Partial<PlansSnapshot>) {
    this.emit({ plans: { ...this.state.plans, ...patch } });
  }
  loadPlans = async (itemId: string) => {
    if (
      !this.plansRepository ||
      this.state.mode !== "cloud" ||
      this.state.status !== "ready" ||
      this.state.busy ||
      this.detailId !== itemId
    )
      return;
    const generation = this.epoch,
      request = ++this.planRequest;
    this.emitPlans({
      itemId,
      status: "loading",
      error: "",
      notice: "",
      rows: this.state.plans.itemId === itemId ? this.state.plans.rows : [],
    });
    try {
      const rows = await this.plansRepository.list(itemId);
      if (
        generation === this.epoch &&
        request === this.planRequest &&
        this.detailId === itemId
      )
        this.emitPlans({ rows, status: "ready" });
    } catch (error) {
      if (
        generation === this.epoch &&
        request === this.planRequest &&
        this.detailId === itemId
      )
        this.emitPlans({ status: "error", error: message(error) });
    }
  };
  private async writePlan(
    itemId: string,
    action: (repository: MaintenancePlansRepository) => Promise<void>,
  ) {
    if (
      !this.plansRepository ||
      this.state.mode !== "cloud" ||
      this.state.status !== "ready" ||
      this.state.stale ||
      this.state.busy ||
      this.detailId !== itemId ||
      this.state.plans.itemId !== itemId ||
      this.state.plans.status !== "ready"
    )
      throw new Error("保養資料尚未就緒，請先重新讀取");
    const repository = this.plansRepository,
      generation = this.epoch,
      request = ++this.planRequest;
    const current = () =>
      generation === this.epoch &&
      request === this.planRequest &&
      this.detailId === itemId;
    this.emit({ busy: true, notice: "" });
    this.emitPlans({ error: "", notice: "" });
    try {
      await action(repository);
      // An acknowledged write must not be retried merely because its readback failed.
      try {
        const rows = await repository.list(itemId);
        if (current())
          this.emitPlans({
            rows,
            status: "ready",
            notice: "保養計畫已儲存至 Google Sheets，並重新讀取。",
          });
      } catch {
        if (current())
          this.emitPlans({
            status: "error",
            error:
              "保養計畫寫入已確認，但重新讀取失敗；請重新讀取核對，不要重複新增。",
          });
      }
    } catch (error) {
      if (current()) this.emitPlans({ status: "error", error: message(error) });
      throw error;
    } finally {
      if (generation === this.epoch) this.emit({ busy: false });
    }
  }
  savePlan = (
    itemId: string,
    fields: MaintenancePlanFields,
    original?: MaintenancePlan,
  ) =>
    this.writePlan(itemId, (repository) =>
      original
        ? repository.update(itemId, original, fields)
        : repository.create(itemId, fields),
    );
  setPlanEnabled = (itemId: string, planId: string, enabled: boolean) =>
    this.writePlan(itemId, (repository) =>
      repository.setEnabled(itemId, planId, enabled),
    );
  create = (item: LifeItem) =>
    this.write((repository) => repository.create(item));
  update = async (item: LifeItem, original: LifeItem) => {
    await this.write((repository) => repository.update(item, original));
  };
  saveLocal = async (item: LifeItem) => {
    await this.write((repository) => repository.saveLocal(item));
  };
  complete = async (id: string, record: MaintenanceRecord) => {
    await this.write((repository) => repository.complete(id, record));
  };
  setArchived = async (item: LifeItem, archived: boolean) => {
    await this.write((repository) => repository.setArchived(item, archived));
  };
}
