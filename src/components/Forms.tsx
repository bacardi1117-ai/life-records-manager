import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { X } from "lucide-react";
import type {
  LifeItem,
  Photo,
  RecurringTask,
  MaintenanceRecord,
} from "../models";
import { today } from "../lib/dates";
import { readPhotos } from "../lib/photos";
export function Modal({
  title,
  children,
  close,
  error,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="關閉">
          <X size={20} />
        </button>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
export function PhotoInput({
  onChange,
}: {
  onChange: (photos: Photo[]) => void;
}) {
  const [error, setError] = useState("");
  const [names, setNames] = useState("");
  return (
    <label>
      照片
      <span className="hint">
        JPG、PNG、WebP，每張 800 KB 以下，每次最多 4 張
      </span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={async (e) => {
          const input = e.currentTarget;
          try {
            const photos = await readPhotos(input.files);
            onChange(photos);
            setNames(photos.map((p) => p.name).join("、"));
            setError("");
          } catch (err) {
            input.value = "";
            onChange([]);
            setNames("");
            setError((err as Error).message);
          }
        }}
      />
      {names && <span className="hint">{names}</span>}
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </label>
  );
}
export function ItemForm({
  item,
  submit,
  busy,
  cloud = false,
  disabled = false,
  recover,
}: {
  cloud?: boolean;
  disabled?: boolean;
  recover?: () => Promise<void>;
  item?: LifeItem;
  submit: (item: LifeItem, original?: LifeItem) => Promise<void>;
  busy: boolean;
}) {
  const initial = useRef(item).current;
  function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void submit(
      {
        id: initial?.id ?? "",
        name: String(data.get("name")).trim(),
        date: String(data.get("date")),
        category: String(data.get("category")),
        brand: String(data.get("brand")).trim(),
        model: String(data.get("model") ?? "").trim(),
        warrantyDate: String(data.get("warrantyDate") ?? ""),
        status: initial?.status ?? "active",
        location: String(data.get("location")).trim(),
        amount: Number(data.get("amount")),
        description: cloud ? "" : String(data.get("description") ?? "").trim(),
        notes: initial?.notes ?? [],
        photos: initial?.photos ?? [],
        tasks: initial?.tasks ?? [],
        history: initial?.history ?? [],
      },
      initial,
    ).catch(() => {});
  }
  return (
    <form onSubmit={handle} className="form-grid">
      <label>
        事項名稱
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={initial?.name}
          placeholder="例如：電熱水器"
          autoFocus
        />
      </label>
      <div className="field-row">
        <label>
          日期
          <input
            name="date"
            type="date"
            required
            defaultValue={initial?.date ?? today()}
          />
        </label>
        <label>
          分類
          <select
            name="category"
            defaultValue={initial?.category ?? "家電設備"}
          >
            {Array.from(
              new Set([
                initial?.category ?? "家電設備",
                "家電設備",
                "居家生活",
                "交通工具",
                "健康照護",
                "其他事項",
              ]),
            ).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        品牌
        <input name="brand" defaultValue={initial?.brand} maxLength={150} />
      </label>
      <div className="field-row">
        <label>
          型號
          <input
            name="model"
            defaultValue={initial?.model ?? ""}
            maxLength={150}
          />
        </label>
        <label>
          保固日期
          <input
            name="warrantyDate"
            type="date"
            defaultValue={initial?.warrantyDate ?? ""}
          />
        </label>
      </div>
      <div className="field-row">
        <label>
          地點
          <input
            name="location"
            defaultValue={initial?.location}
            maxLength={150}
          />
        </label>
        <label>
          購入金額（NT$）
          <input
            name="amount"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={initial?.amount ?? 0}
          />
        </label>
      </div>
      {!cloud && (
        <label>
          購買及安裝資料
          <textarea
            name="description"
            rows={3}
            defaultValue={initial?.description}
            maxLength={3000}
          />
        </label>
      )}
      {cloud && (
        <p className="hint">
          只儲存實際變更的 Items
          基本欄位；保養、歷史、備註與照片尚未支援雲端同步。
        </p>
      )}
      {recover && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void recover()}
        >
          重新讀取資料並保留草稿
        </button>
      )}
      <button className="primary" disabled={busy || disabled}>
        {busy ? "儲存中…" : "儲存事項"}
      </button>
    </form>
  );
}
export function TaskForm({
  task,
  startDate,
  submit,
  busy,
}: {
  task?: RecurringTask;
  startDate: string;
  submit: (task: RecurringTask) => Promise<void>;
  busy: boolean;
}) {
  const [period, setPeriod] = useState(
    task && ![30, 60, 180, 365].includes(task.intervalDays)
      ? "custom"
      : String(task?.intervalDays ?? 180),
  );
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        void submit({
          id: task?.id ?? crypto.randomUUID(),
          name: String(d.get("name")).trim(),
          intervalDays: Number(period === "custom" ? d.get("custom") : period),
          anchorDate: String(d.get("anchor")),
        }).catch(() => {});
      }}
    >
      <label>
        子項目名稱
        <input
          name="name"
          defaultValue={task?.name}
          required
          maxLength={100}
          placeholder="例如：清理水垢"
          autoFocus
        />
      </label>
      <label>
        保養週期
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {[30, 60, 180, 365].map((n) => (
            <option key={n} value={n}>
              {n} 天
            </option>
          ))}
          <option value="custom">自訂週期</option>
        </select>
      </label>
      {period === "custom" && (
        <label>
          自訂天數
          <input
            name="custom"
            type="number"
            min="1"
            max="36500"
            step="1"
            required
            defaultValue={task?.intervalDays ?? 90}
          />
        </label>
      )}
      <label>
        首次計算基準日
        <input
          name="anchor"
          type="date"
          required
          defaultValue={task?.anchorDate ?? startDate}
        />
      </label>
      <p className="hint">
        有完成紀錄後，將自動以最近的實際完成日期加上週期計算。
      </p>
      <button className="primary" disabled={busy}>
        儲存子項目
      </button>
    </form>
  );
}
export function CompleteForm({
  task,
  itemDate,
  submit,
  busy,
}: {
  task: RecurringTask;
  itemDate: string;
  submit: (r: MaintenanceRecord) => Promise<void>;
  busy: boolean;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        void submit({
          id: crypto.randomUUID(),
          taskId: task.id,
          taskName: task.name,
          date: String(d.get("date")),
          amount: Number(d.get("amount")),
          note: String(d.get("note")).trim(),
          photos,
        }).catch(() => {});
      }}
    >
      <p className="form-description">
        {task.name} · 每 {task.intervalDays} 天
      </p>
      <div className="field-row">
        <label>
          實際完成日期
          <input
            autoFocus
            name="date"
            type="date"
            min={itemDate}
            max={today()}
            defaultValue={today()}
            required
          />
        </label>
        <label>
          保養金額（NT$）
          <input
            name="amount"
            type="number"
            min="0"
            step="0.01"
            defaultValue="0"
            required
          />
        </label>
      </div>
      <label>
        完成備註
        <textarea
          name="note"
          rows={3}
          maxLength={3000}
          placeholder="記錄更換零件、保養狀況…"
        />
      </label>
      <PhotoInput onChange={setPhotos} />
      <p className="hint">
        儲存後更新歷史紀錄，並依實際完成日期重新計算下次保養。
      </p>
      <button className="primary" disabled={busy}>
        {busy ? "儲存中…" : "確認完成保養"}
      </button>
    </form>
  );
}
