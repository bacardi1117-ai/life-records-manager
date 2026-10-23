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
import {
  createMaintenanceRecordsRepository,
  matchesSubmission,
} from "./maintenanceRecords";
import type {
  CloudMaintenanceRecord,
  MaintenanceRecordsRepository,
} from "./maintenanceRecords";
import { recordDrafts } from "./recordDrafts";
import type { RecordDraft } from "./recordDrafts";
import { createCloudNotesRepository, NOTES_API_ENABLED } from "./cloudNotes";
import type {
  CloudNote,
  CloudNotesRepository,
  NewCloudNote,
  NoteOwnerType,
} from "./cloudNotes";
import { noteDrafts } from "./noteDrafts";
export interface NotesSnapshot {
  ownerType: NoteOwnerType | null;
  ownerId: string | null;
  status: "unavailable" | "idle" | "loading" | "ready" | "error";
  rows: CloudNote[];
  error: string;
  notice: string;
}
const emptyNotes = (enabled: boolean): NotesSnapshot => ({
  ownerType: null,
  ownerId: null,
  status: enabled ? "idle" : "unavailable",
  rows: [],
  error: "",
  notice: "",
});
import {
  CALENDAR_SYNC_STATUS_API_ENABLED,
  createCalendarSyncRepository,
} from "./calendarSync";
import type {
  CalendarSyncRepository,
  CalendarSyncStatus,
} from "./calendarSync";
export interface CalendarSyncSnapshot {
  itemId: string | null;
  enabled: boolean;
  statuses: Record<
    string,
    {
      state: "loading" | "ready" | "error";
      data?: CalendarSyncStatus;
      error?: string;
    }
  >;
}
const emptyCalendarSync = (enabled: boolean): CalendarSyncSnapshot => ({
  itemId: null,
  enabled,
  statuses: {},
});
export interface RecordsSnapshot {
  itemId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  rows: CloudMaintenanceRecord[];
  error: string;
  notice: string;
  byPlan: {
    planId: string | null;
    status: "idle" | "loading" | "ready" | "error";
    rows: CloudMaintenanceRecord[];
    error: string;
  };
}
const emptyRecords = (): RecordsSnapshot => ({
  itemId: null,
  status: "idle",
  rows: [],
  error: "",
  notice: "",
  byPlan: { planId: null, status: "idle", rows: [], error: "" },
});
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
  notes: NotesSnapshot;
  plans: PlansSnapshot;
  records: RecordsSnapshot;
  calendarSync: CalendarSyncSnapshot;
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
    notes: emptyNotes(NOTES_API_ENABLED),
    plans: emptyPlans(),
    records: emptyRecords(),
    calendarSync: emptyCalendarSync(CALENDAR_SYNC_STATUS_API_ENABLED),
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
  private recordsRepository: MaintenanceRecordsRepository | null = null;
  private calendarRepository: CalendarSyncRepository | null = null;
  private notesRepository: CloudNotesRepository | null = null;
  private notesRequest = 0;
  private planRequest = 0;
  private recordRequest = 0;
  private planHistoryRequest = 0;
  private calendarRequest = 0;
  private epoch = 0;
  private detailRequest = 0;
  private detailId: string | null = null;
  constructor(
    private host: () => HTMLElement | null,
    options: {
      calendarSyncStatusApiEnabled?: boolean;
      notesApiEnabled?: boolean;
    } = {},
  ) {
    this.state.calendarSync = emptyCalendarSync(
      options.calendarSyncStatusApiEnabled ?? CALENDAR_SYNC_STATUS_API_ENABLED,
    );
    this.state.notes = emptyNotes(options.notesApiEnabled ?? NOTES_API_ENABLED);
  }
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
    this.recordsRepository = null;
    this.calendarRepository = null;
    this.notesRepository = null;
    this.notesRequest++;
    this.planRequest++;
    this.recordRequest++;
    this.planHistoryRequest++;
    this.calendarRequest++;
    this.detailId = null;
    this.emit({
      plans: emptyPlans(),
      records: emptyRecords(),
      calendarSync: emptyCalendarSync(this.state.calendarSync.enabled),
      notes: emptyNotes(this.state.notes.status !== "unavailable"),
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
      this.recordsRepository = createMaintenanceRecordsRepository(bridge);
      this.calendarRepository = createCalendarSyncRepository(
        bridge,
        this.state.calendarSync.enabled,
      );
      this.notesRepository = createCloudNotesRepository(
        bridge,
        this.state.notes.status !== "unavailable",
      );
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
      this.recordsRepository = null;
      this.calendarRepository = null;
      this.notesRepository = null;
      this.notesRequest++;
      this.planRequest++;
      this.recordRequest++;
      this.planHistoryRequest++;
      this.calendarRequest++;
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
    this.recordsRepository = null;
    this.calendarRepository = null;
    this.planRequest++;
    this.recordRequest++;
    this.planHistoryRequest++;
    this.calendarRequest++;
    this.notesRepository = null;
    this.notesRequest++;
    this.emit({
      calendarSync: emptyCalendarSync(this.state.calendarSync.enabled),
      notes: emptyNotes(this.state.notes.status !== "unavailable"),
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
    this.recordsRepository = null;
    this.calendarRepository = null;
    this.notesRepository = null;
    this.notesRequest++;
    this.planRequest++;
    this.recordRequest++;
    this.planHistoryRequest++;
    this.calendarRequest++;
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
    this.recordRequest++;
    this.planHistoryRequest++;
    this.calendarRequest++;
    this.notesRequest++;
    this.emit({
      plans: emptyPlans(),
      records: emptyRecords(),
      calendarSync: emptyCalendarSync(this.state.calendarSync.enabled),
      notes: emptyNotes(this.state.notes.status !== "unavailable"),
    });
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
    this.recordRequest++;
    this.planHistoryRequest++;
    this.calendarRequest++;
    this.notesRequest++;
    this.emit({
      selected: null,
      detailState: "idle",
      plans: emptyPlans(),
      records: emptyRecords(),
      calendarSync: emptyCalendarSync(this.state.calendarSync.enabled),
      notes: emptyNotes(this.state.notes.status !== "unavailable"),
    });
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
  private emitNotes(patch: Partial<NotesSnapshot>) {
    this.emit({ notes: { ...this.state.notes, ...patch } });
  }
  private noteOwnerValid(ownerType: NoteOwnerType, ownerId: string) {
    return ownerType === "item"
      ? this.detailId === ownerId
      : this.state.plans.itemId === this.detailId &&
        this.state.plans.rows.some(plan => plan.plan_id === ownerId && plan.item_id === this.detailId);
  }
  openNoteDraft = (ownerType: NoteOwnerType, ownerId: string) => noteDrafts.open(ownerType, ownerId);
  saveNoteDraft = (draft: NewCloudNote) => noteDrafts.save(draft);
  loadNotes = async (ownerType: NoteOwnerType, ownerId: string) => {
    if (!this.notesRepository?.enabled || this.state.mode !== "cloud" ||
        this.state.status !== "ready" || !this.noteOwnerValid(ownerType, ownerId)) return;
    const generation = this.epoch, request = ++this.notesRequest;
    this.emitNotes({ ownerType, ownerId, status: "loading", error: "", notice: "", rows: [] });
    try {
      const rows = await this.notesRepository.list(ownerType, ownerId);
      if (generation === this.epoch && request === this.notesRequest &&
          this.noteOwnerValid(ownerType, ownerId) &&
          this.state.notes.ownerType === ownerType && this.state.notes.ownerId === ownerId)
        this.emitNotes({ rows, status: "ready" });
    } catch (error) {
      if (generation === this.epoch && request === this.notesRequest &&
          this.state.notes.ownerType === ownerType && this.state.notes.ownerId === ownerId)
        this.emitNotes({ status: "error", error: message(error) });
    }
  };
  saveNote = async (draft: NewCloudNote, original?: CloudNote) => {
    if (!this.notesRepository?.enabled || this.state.mode !== "cloud" ||
        this.state.status !== "ready" || this.state.stale || this.state.busy ||
        !this.noteOwnerValid(draft.owner_type, draft.owner_id) ||
        this.state.notes.status !== "ready" ||
        this.state.notes.ownerType !== draft.owner_type || this.state.notes.ownerId !== draft.owner_id)
      throw new Error("雲端備註尚未就緒，請先重新讀取");
    const repo = this.notesRepository, generation = this.epoch, request = ++this.notesRequest;
    this.emit({ busy: true });
    this.emitNotes({ error: "", notice: "" });
    try {
      const expected = { ...draft, title: draft.title.trim(), content: draft.content.trim() };
      if (original) {
        if (original.note_id !== draft.note_id || original.owner_type !== draft.owner_type ||
            original.owner_id !== draft.owner_id) throw new Error("備註所屬資料不符");
        await repo.update(original, { title: expected.title, content: expected.content });
      } else {
        // An ambiguous previous response may already have written this UUID.
        const existing = await repo.get(draft.note_id);
        if (existing) {
          if (existing.owner_type !== draft.owner_type || existing.owner_id !== draft.owner_id ||
              existing.title !== expected.title || existing.content !== expected.content)
            throw new Error("相同備註識別碼已有不同內容，已停止重試");
        } else await repo.create(draft);
      }
      const rows = await repo.list(draft.owner_type, draft.owner_id);
      if (!rows.some(row => row.note_id === draft.note_id && row.owner_type === draft.owner_type &&
          row.owner_id === draft.owner_id && row.title === expected.title && row.content === expected.content))
        throw new Error("寫入已確認，但備註清單尚未更新；請重新讀取核對");
      if (generation === this.epoch && request === this.notesRequest &&
          this.noteOwnerValid(draft.owner_type, draft.owner_id) &&
          this.state.notes.ownerType === draft.owner_type && this.state.notes.ownerId === draft.owner_id)
        this.emitNotes({ rows, status: "ready", notice: "備註已重新讀取雲端資料。" });
      if (!original) noteDrafts.clear(draft);
    } catch (error) {
      if (generation === this.epoch && request === this.notesRequest &&
          this.state.notes.ownerType === draft.owner_type && this.state.notes.ownerId === draft.owner_id)
        this.emitNotes({ status: "error", error: message(error) });
      throw error;
    } finally {
      if (generation === this.epoch) this.emit({ busy: false });
    }
  };
  private loadCalendarStatuses(itemId: string, plans: MaintenancePlan[]) {
    const generation = this.epoch;
    const request = ++this.calendarRequest;
    const repository = this.calendarRepository;
    const current = () =>
      generation === this.epoch &&
      request === this.calendarRequest &&
      this.detailId === itemId &&
      this.state.mode === "cloud";
    if (!repository?.enabled) {
      this.emit({
        calendarSync: { itemId, enabled: false, statuses: {} },
      });
      return;
    }
    this.emit({
      calendarSync: {
        itemId,
        enabled: true,
        statuses: Object.fromEntries(
          plans.map((plan) => [plan.plan_id, { state: "loading" }]),
        ),
      },
    });
    for (const plan of plans) {
      void repository.get(plan.plan_id).then(
        (data) => {
          if (current())
            this.emit({
              calendarSync: {
                ...this.state.calendarSync,
                statuses: {
                  ...this.state.calendarSync.statuses,
                  [plan.plan_id]: { state: "ready", data },
                },
              },
            });
        },
        (error) => {
          if (current())
            this.emit({
              calendarSync: {
                ...this.state.calendarSync,
                statuses: {
                  ...this.state.calendarSync.statuses,
                  [plan.plan_id]: { state: "error", error: message(error) },
                },
              },
            });
        },
      );
    }
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
    this.calendarRequest++;
    this.emit({
      calendarSync: emptyCalendarSync(this.state.calendarSync.enabled),
    });
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
      ) {
        this.emitPlans({ rows, status: "ready" });
        this.loadCalendarStatuses(itemId, rows);
      }
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
    this.calendarRequest++;
    this.emit({
      calendarSync: emptyCalendarSync(this.state.calendarSync.enabled),
    });
    this.emitPlans({ error: "", notice: "" });
    try {
      await action(repository);
      // An acknowledged write must not be retried merely because its readback failed.
      try {
        const rows = await repository.list(itemId);
        if (current()) {
          this.emitPlans({
            rows,
            status: "ready",
            notice: "保養計畫已儲存至 Google Sheets，並重新讀取。",
          });
          this.loadCalendarStatuses(itemId, rows);
        }
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
  private emitRecords(patch: Partial<RecordsSnapshot>) {
    this.emit({ records: { ...this.state.records, ...patch } });
  }
  loadRecords = async (itemId: string) => {
    if (
      !this.recordsRepository ||
      this.state.mode !== "cloud" ||
      this.state.status !== "ready" ||
      this.state.busy ||
      this.detailId !== itemId
    )
      return;
    const generation = this.epoch,
      request = ++this.recordRequest;
    this.emitRecords({
      itemId,
      status: "loading",
      error: "",
      rows: this.state.records.itemId === itemId ? this.state.records.rows : [],
    });
    try {
      const rows = await this.recordsRepository.byItem(itemId);
      if (
        generation === this.epoch &&
        request === this.recordRequest &&
        this.detailId === itemId
      )
        this.emitRecords({ rows, status: "ready" });
    } catch (error) {
      if (
        generation === this.epoch &&
        request === this.recordRequest &&
        this.detailId === itemId
      )
        this.emitRecords({ status: "error", error: message(error) });
    }
  };
  loadPlanRecords = async (itemId: string, planId: string) => {
    if (
      !this.recordsRepository ||
      this.state.mode !== "cloud" ||
      this.state.status !== "ready" ||
      this.detailId !== itemId ||
      !this.state.plans.rows.some(
        (plan) => plan.item_id === itemId && plan.plan_id === planId,
      )
    )
      return;
    const generation = this.epoch,
      request = ++this.planHistoryRequest;
    this.emitRecords({
      byPlan: { planId, status: "loading", rows: [], error: "" },
    });
    try {
      const rows = await this.recordsRepository.byPlan(planId);
      if (rows.some((row) => row.item_id !== itemId))
        throw new Error("保養紀錄所屬事項不符");
      if (
        generation === this.epoch &&
        request === this.planHistoryRequest &&
        this.detailId === itemId
      )
        this.emitRecords({
          byPlan: { planId, status: "ready", rows, error: "" },
        });
    } catch (error) {
      if (
        generation === this.epoch &&
        request === this.planHistoryRequest &&
        this.detailId === itemId
      )
        this.emitRecords({
          byPlan: { planId, status: "error", rows: [], error: message(error) },
        });
    }
  };
  openCompletionDraft = (itemId: string, plan: MaintenancePlan) =>
    recordDrafts.open(itemId, plan);
  /** Drive attachments are allowed only for a record the backend can read back. */
  confirmStoredRecord = async (itemId: string, recordId: string) => {
    if (!this.recordsRepository || this.state.mode !== "cloud" ||
        this.state.status !== "ready" || this.state.stale || this.detailId !== itemId ||
        this.state.records.itemId !== itemId || this.state.records.status !== "ready" ||
        !this.state.records.rows.some(row => row.record_id === recordId))
      throw new Error("完成紀錄尚未儲存或雲端資料未就緒，不能操作照片");
    const generation = this.epoch;
    const record = await this.recordsRepository.get(recordId);
    if (generation !== this.epoch || this.detailId !== itemId ||
        !record || record.item_id !== itemId || record.record_id !== recordId)
      throw new Error("Google Sheets 未確認此完成紀錄，不能操作照片");
  };
  getCompletionDraft = (itemId: string, planId: string) =>
    recordDrafts.read(itemId, planId);
  saveCompletionDraft = (draft: RecordDraft) => {
    if (
      draft.phase !== "editing" ||
      this.detailId !== draft.item_id ||
      this.state.mode !== "cloud"
    )
      throw new Error("目前不能修改這份完成草稿");
    recordDrafts.save(draft);
  };
  private async readCompletedRecord(draft: RecordDraft, duplicate: boolean) {
    const repo = this.recordsRepository!,
      plansRepo = this.plansRepository!;
    const record = await repo.get(draft.record_id);
    if (!record)
      throw new Error("寫入已確認，但尚未讀到完成紀錄；請重新查詢，勿重複送出");
    if (!matchesSubmission(record, draft)) {
      recordDrafts.save({ ...draft, phase: "conflict" });
      throw new Error("相同 record_id 的內容與草稿不一致，已停止重試");
    }
    const [plans, records, planRecords] = await Promise.all([
      plansRepo.list(draft.item_id),
      repo.byItem(draft.item_id),
      repo.byPlan(draft.plan_id),
    ]);
    if (
      !plans.some((plan) => plan.plan_id === draft.plan_id) ||
      !records.some((row) => matchesSubmission(row, draft)) ||
      !planRecords.some((row) => matchesSubmission(row, draft))
    )
      throw new Error("寫入已確認，但重新讀取的計畫或紀錄尚未一致；請重新查詢");
    if (this.detailId !== draft.item_id || this.state.mode !== "cloud")
      throw new Error("目前事項已切換，請重新讀取確認完成結果");
    ++this.planRequest;
    ++this.recordRequest;
    ++this.planHistoryRequest;
    this.emit({
      plans: {
        itemId: draft.item_id,
        rows: plans,
        status: "ready",
        error: "",
        notice: "",
      },
      records: {
        itemId: draft.item_id,
        rows: records,
        status: "ready",
        error: "",
        notice: duplicate
          ? "此完成紀錄已存在，已重新讀取，沒有重複新增。"
          : "已儲存完成紀錄，並重新讀取保養計畫與歷史。",
        byPlan: {
          planId: draft.plan_id,
          status: "ready",
          rows: planRecords,
          error: "",
        },
      },
    });
    this.loadCalendarStatuses(draft.item_id, plans);
    try {
      recordDrafts.clear(draft);
    } catch {
      /* Readback is authoritative; a leftover draft remains acknowledged. */
    }
  }
  submitCompletion = async (draft: RecordDraft): Promise<void> => {
    if (
      !this.recordsRepository ||
      !this.plansRepository ||
      this.state.mode !== "cloud" ||
      this.state.status !== "ready" ||
      this.state.stale ||
      this.state.busy ||
      this.detailId !== draft.item_id ||
      this.state.plans.status !== "ready" ||
      this.state.records.status !== "ready" ||
      draft.phase !== "editing"
    )
      throw new Error("雲端完成紀錄尚未就緒，請先重新讀取");
    const saved = recordDrafts.read(draft.item_id, draft.plan_id);
    if (
      !saved ||
      saved.record_id !== draft.record_id ||
      saved.phase !== "editing"
    )
      throw new Error("草稿識別碼不符，已停止送出");
    const generation = this.epoch,
      repo = this.recordsRepository;
    this.emit({ busy: true });
    this.calendarRequest++;
    this.emit({
      calendarSync: emptyCalendarSync(this.state.calendarSync.enabled),
    });
    this.emitRecords({ error: "", notice: "" });
    try {
      const plan = await this.plansRepository.get(draft.plan_id);
      if (!plan || plan.item_id !== draft.item_id || !plan.enabled)
        throw new Error("此保養計畫已停用或不屬於目前事項，不能完成保養");
      recordDrafts.save({ ...draft, phase: "uncertain" });
      let duplicate = false;
      try {
        const result = await repo.create(draft);
        duplicate = result.duplicate;
        recordDrafts.save({ ...draft, phase: "acknowledged" });
      } catch (writeError) {
        if (/conflict|衝突|不同內容/i.test(message(writeError))) {
          recordDrafts.save({ ...draft, phase: "conflict" });
          throw new Error(
            message(writeError).includes("已停止重試")
              ? message(writeError)
              : `${message(writeError)}；已停止重試`,
          );
        }
        // Every uncertain write is resolved by the same record_id before any retry.
        try {
          const existing = await repo.get(draft.record_id);
          if (existing) {
            if (!matchesSubmission(existing, draft)) {
              recordDrafts.save({ ...draft, phase: "conflict" });
              throw new Error("相同 record_id 已有不同內容，已停止重試");
            }
            duplicate = true;
            recordDrafts.save({ ...draft, phase: "acknowledged" });
          } else {
            const conflict = /conflict|衝突|不同內容/i.test(
              message(writeError),
            );
            recordDrafts.save({
              ...draft,
              phase: conflict ? "conflict" : "editing",
            });
            throw new Error(
              conflict
                ? `${message(writeError)}；已停止重試`
                : `${message(writeError)}；未查到原 record_id，請核對後以同一草稿重試`,
            );
          }
        } catch (checkError) {
          if (
            recordDrafts.read(draft.item_id, draft.plan_id)?.phase ===
            "uncertain"
          )
            throw new Error(
              `寫入結果未確認，查詢原 record_id 亦失敗：${message(checkError)}。請重新查詢，勿新增識別碼`,
            );
          throw checkError;
        }
      }
      await this.readCompletedRecord(draft, duplicate);
    } catch (error) {
      if (generation === this.epoch && this.detailId === draft.item_id)
        this.emitRecords({ error: message(error), notice: "" });
      throw error;
    } finally {
      if (generation === this.epoch) this.emit({ busy: false });
    }
  };
  checkCompletion = async (draft: RecordDraft): Promise<boolean> => {
    if (
      !this.recordsRepository ||
      this.state.busy ||
      this.state.mode !== "cloud" ||
      this.detailId !== draft.item_id
    )
      throw new Error("雲端資料尚未就緒");
    const saved = recordDrafts.read(draft.item_id, draft.plan_id);
    if (!saved || saved.record_id !== draft.record_id)
      throw new Error("原草稿識別碼不符");
    const generation = this.epoch;
    this.emit({ busy: true });
    try {
      const existing = await this.recordsRepository.get(draft.record_id);
      if (!existing) {
        if (saved.phase !== "acknowledged" && saved.phase !== "conflict")
          recordDrafts.save({ ...saved, phase: "editing" });
        this.emitRecords({
          error:
            saved.phase === "acknowledged"
              ? "後端已確認寫入，但暫時查不到紀錄；請稍後再查詢，勿重複送出"
              : "尚未查到原 record_id；可沿用同一草稿重新送出",
          notice: "",
        });
        return false;
      }
      if (!matchesSubmission(existing, saved)) {
        recordDrafts.save({ ...saved, phase: "conflict" });
        throw new Error("相同 record_id 已有不同內容，已停止重試");
      }
      recordDrafts.save({ ...saved, phase: "acknowledged" });
      await this.readCompletedRecord(saved, true);
      return true;
    } catch (error) {
      if (generation === this.epoch && this.detailId === draft.item_id)
        this.emitRecords({ error: message(error), notice: "" });
      throw error;
    } finally {
      if (generation === this.epoch) this.emit({ busy: false });
    }
  };
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
