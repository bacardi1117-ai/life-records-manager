import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { driveAuth } from "../api/driveAuth";
import { drivePhotos } from "../api/drivePhotos";
import type { DrivePhoto, PendingPhoto } from "../api/drivePhotos";

interface UploadEntry {
  key: string;
  file: File;
  pending?: PendingPhoto;
  progress: number;
  state: "ready" | "uploading" | "success" | "error";
  error: string;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : "Google Drive 操作失敗";
export default function DriveConnection({ itemId }: { itemId: string }) {
  const snapshot = useSyncExternalStore(driveAuth.subscribe, driveAuth.getSnapshot);
  useEffect(() => { void driveAuth.prepare(); }, []);
  return <section className="drive-connection" aria-label="私人 Google Drive 連線">
    <h2>私人 Google Drive</h2>
    {snapshot.state === "unconfigured" ? <p role="status">Google Drive 尚未設定</p> : <>
      {snapshot.state === "authorized" && <p role="status">Google Drive 已授權</p>}
      {snapshot.state === "loading" && <p role="status">正在載入 Google 授權元件…</p>}
      {snapshot.state === "authorizing" && <p role="status">正在等待 Google 授權並驗證 Drive 連線…</p>}
      {snapshot.state === "idle" && <p>連接後可上傳及查看此生活事項的私人照片。</p>}
      {snapshot.state === "revoked" && <p role="status">已取消 Google Drive 授權</p>}
      {snapshot.error && <p className="error-banner" role="alert">{snapshot.error}</p>}
      {snapshot.state !== "authorized" && <button className="primary" type="button"
        disabled={snapshot.state === "authorizing" || snapshot.state === "loading"}
        onClick={() => void (driveAuth.isPrepared ? driveAuth.authorize() : driveAuth.prepare())}>
        {snapshot.state === "idle" ? "連接私人 Google Drive" : driveAuth.isPrepared ? "重新授權 Google Drive" : "重試載入 Google 授權元件"}
      </button>}
      {snapshot.state === "authorized" && <>
        <button className="secondary" type="button" onClick={() => driveAuth.revoke()}>取消 Google Drive 授權</button>
        <DrivePhotosPanel key={itemId} itemId={itemId} />
      </>}
      <p className="muted small">僅使用 drive.file 權限。照片儲存在私人 Drive，不產生公開連結；目前不提供刪除、分享或保養紀錄附件。</p>
    </>}
  </section>;
}
function PrivateThumbnail({ photo }: { photo: DrivePhoto }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let blobUrl = "";
    void drivePhotos.readBlob(photo).then(blob => {
      blobUrl = URL.createObjectURL(blob);
      if (active) setUrl(blobUrl);
      else URL.revokeObjectURL(blobUrl);
    }).catch(cause => { if (active) setError(errorText(cause)); });
    return () => { active = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [photo.id, photo.mimeType]);
  return <div className="drive-photo-card">
    {url ? <img src={url} alt={photo.name} /> : <div className="drive-photo-placeholder">{error || "正在載入縮圖…"}</div>}
    <span title={photo.name}>{photo.name}</span>
  </div>;
}
function DrivePhotosPanel({ itemId }: { itemId: string }) {
  const [rows, setRows] = useState<DrivePhoto[]>([]);
  const [confirmed, setConfirmed] = useState<DrivePhoto[]>([]);
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void drivePhotos.list(itemId).then(photos => {
      if (active) { setRows(photos); setLoading(false); }
    }).catch(cause => {
      if (active) { setError(errorText(cause)); setLoading(false); }
    });
    return () => { active = false; };
  }, [itemId, generation]);
  const photos = useMemo(() => {
    const ids = new Set(rows.map(row => row.id));
    return [...confirmed.filter(row => !ids.has(row.id)), ...rows];
  }, [rows, confirmed]);
  const patch = (key: string, value: Partial<UploadEntry>) =>
    setEntries(current => current.map(entry => entry.key === key ? { ...entry, ...value } : entry));
  async function select(files: FileList | null) {
    if (!files || busy || selecting) return;
    setSelecting(true);
    setError("");
    const selected: UploadEntry[] = [];
    for (const file of Array.from(files)) {
      const key = crypto.randomUUID();
      try {
        const pending = await drivePhotos.prepare(itemId, file);
        if (selected.some(entry => entry.pending?.key === pending.key)) continue;
        selected.push({ key, file, pending, progress: 0, state: "ready", error: "" });
      } catch (cause) {
        selected.push({ key, file, progress: 0, state: "error", error: errorText(cause) });
      }
    }
    setEntries(selected);
    setSelecting(false);
  }
  async function upload() {
    if (busy || selecting) return;
    setBusy(true);
    setError("");
    try {
      for (const entry of entries) {
        if (!entry.pending || entry.state === "success") continue;
        patch(entry.key, { state: "uploading", error: "" });
        try {
          const photo = await drivePhotos.uploadOne(itemId, entry.file, entry.pending,
            progress => patch(entry.key, { progress }));
          setConfirmed(current => current.some(row => row.id === photo.id) ? current : [photo, ...current]);
          patch(entry.key, { state: "success", progress: 100, error: "" });
        } catch (cause) {
          const pending = await drivePhotos.prepare(itemId, entry.file).catch(() => entry.pending);
          patch(entry.key, { state: "error", pending, error: errorText(cause) });
        }
      }
      setGeneration(value => value + 1);
    } finally { setBusy(false); }
  }
  return <div className="drive-photo-panel">
    <div className="section-heading"><h3>此事項的私人照片</h3>
      <button className="text-button" type="button" disabled={loading || busy} onClick={() => setGeneration(value => value + 1)}>重新讀取照片</button>
    </div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {loading && <p role="status">正在讀取 Drive 照片…</p>}
    {!loading && !error && !photos.length && <p className="empty">這件事項尚無私人 Drive 照片。</p>}
    {!!photos.length && <div className="drive-photo-grid">{photos.map(photo => <PrivateThumbnail key={photo.id} photo={photo} />)}</div>}
    <label>選取照片（JPG、PNG、WebP；每張最多 10 MB）
      <input aria-label="選取私人 Drive 照片" type="file" accept="image/jpeg,image/png,image/webp" multiple
        disabled={busy || selecting} onChange={event => { void select(event.target.files); event.target.value = ""; }} />
    </label>
    {selecting && <p role="status">正在檢查選取的照片…</p>}
    {!!entries.length && <div className="drive-upload-list">{entries.map(entry => <div key={entry.key}>
      <span>{entry.file.name} · {entry.state === "success" ? "已上傳並核對" :
        entry.state === "uploading" ? `上傳中 ${entry.progress}%` :
        entry.pending?.uncertain ? "等待核對" : entry.state === "error" ? "上傳失敗" : "待上傳"}</span>
      {entry.state === "uploading" && <progress max={100} value={entry.progress} aria-label={`${entry.file.name} 上傳進度`} />}
      {entry.error && <p className="error-banner" role="alert">{entry.error}</p>}
    </div>)}</div>}
    <button className="primary" type="button" disabled={busy || selecting || !entries.some(entry => entry.pending && entry.state !== "success")}
      onClick={() => void upload()}>{busy ? "正在上傳…" : "上傳／核對選取的照片"}</button>
  </div>;
}
