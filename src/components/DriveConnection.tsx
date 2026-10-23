import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { TouchEvent } from "react";
import { driveAuth } from "../api/driveAuth";
import { drivePhotos } from "../api/drivePhotos";
import type { DrivePhoto, PendingPhoto, PhotoOwner } from "../api/drivePhotos";
import type { ItemsStore } from "../api/itemsStore";
import { Modal } from "./Forms";

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
  return <DriveConnectionBase owner={{ type: "item", id: itemId }} />;
}
export function DriveRecordConnection({ itemId, recordId, store }: {
  itemId: string; recordId: string; store: ItemsStore;
}) {
  return <DriveConnectionBase owner={{ type: "record", id: recordId }}
    ensureSaved={() => store.confirmStoredRecord(itemId, recordId)} />;
}
function DriveConnectionBase({ owner, ensureSaved }: { owner: PhotoOwner; ensureSaved?: () => Promise<void> }) {
  const snapshot = useSyncExternalStore(driveAuth.subscribe, driveAuth.getSnapshot);
  useEffect(() => { void driveAuth.prepare(); }, []);
  return <section className="drive-connection" aria-label="私人 Google Drive 連線">
    <h2>私人 Google Drive</h2>
    {snapshot.state === "unconfigured" ? <p role="status">Google Drive 尚未設定</p> : <>
      {snapshot.state === "authorized" && <p role="status">Google Drive 已授權</p>}
      {snapshot.state === "loading" && <p role="status">正在載入 Google 授權元件…</p>}
      {snapshot.state === "authorizing" && <p role="status">正在等待 Google 授權並驗證 Drive 連線…</p>}
      {snapshot.state === "idle" && <p>連接後可上傳及查看{owner.type === "record" ? "此保養完成紀錄" : "此生活事項"}的私人照片。</p>}
      {snapshot.state === "revoked" && <p role="status">已取消 Google Drive 授權</p>}
      {snapshot.error && <p className="error-banner" role="alert">{snapshot.error}</p>}
      {snapshot.state !== "authorized" && <button className="primary" type="button"
        disabled={snapshot.state === "authorizing" || snapshot.state === "loading"}
        onClick={() => void (driveAuth.isPrepared ? driveAuth.authorize() : driveAuth.prepare())}>
        {snapshot.state === "idle" ? "連接私人 Google Drive" : driveAuth.isPrepared ? "重新授權 Google Drive" : "重試載入 Google 授權元件"}
      </button>}
      {snapshot.state === "authorized" && <>
        <button className="secondary" type="button" onClick={() => driveAuth.revoke()}>取消 Google Drive 授權</button>
        <DrivePhotosPanel key={`${owner.type}:${owner.id}`} owner={owner} ensureSaved={ensureSaved} />
      </>}
      <p className="muted small">僅使用 drive.file 權限。照片儲存在私人 Drive；刪除會移入私人垃圾桶，不產生公開連結或公開分享。</p>
    </>}
  </section>;
}
function PrivateImage({ photo, large = false }: { photo: DrivePhoto; large?: boolean }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let blobUrl = "";
    setUrl(""); setError("");
    void drivePhotos.readBlob(photo).then(blob => {
      blobUrl = URL.createObjectURL(blob);
      if (active) setUrl(blobUrl);
      else URL.revokeObjectURL(blobUrl);
    }).catch(cause => { if (active) setError(errorText(cause)); });
    return () => { active = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [photo.id, photo.mimeType]);
  return url ? <img className={large ? "drive-photo-large" : ""} src={url} alt={photo.name} />
    : <div className="drive-photo-placeholder" role="status">{error || (large ? "正在載入照片…" : "正在載入縮圖…")}</div>;
}
function LocalPreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const blobUrl = URL.createObjectURL(file);
    setUrl(blobUrl);
    return () => URL.revokeObjectURL(blobUrl);
  }, [file]);
  return url ? <img src={url} alt={`新照片：${file.name}`} /> : <p>正在載入新照片…</p>;
}
function PhotoViewer({ photos, index, setIndex, close }: {
  photos: DrivePhoto[]; index: number; setIndex: (index: number) => void; close: () => void;
}) {
  const startX = useRef<number | null>(null);
  const count = photos.length;
  const photo = photos[index];
  const move = (step: number) => setIndex((index + step + count) % count);
  const touchStart = (event: TouchEvent) => { startX.current = event.touches[0]?.clientX ?? null; };
  const touchEnd = (event: TouchEvent) => {
    if (startX.current === null) return;
    const distance = event.changedTouches[0]?.clientX - startX.current;
    startX.current = null;
    if (distance !== undefined && Math.abs(distance) > 45) move(distance < 0 ? 1 : -1);
  };
  return <Modal title="照片放大預覽" close={close}>
    <div className="drive-photo-viewer" onTouchStart={touchStart} onTouchEnd={touchEnd}>
      <p>{photo.name} · {index + 1} / {count}</p>
      <PrivateImage key={photo.id} photo={photo} large />
      <div className="actions">
        <button type="button" className="secondary" onClick={() => move(-1)} disabled={count < 2}>上一張</button>
        <button type="button" className="secondary" onClick={() => move(1)} disabled={count < 2}>下一張</button>
      </div>
    </div>
  </Modal>;
}
interface ReplaceDraft {
  old: DrivePhoto; file: File | null; pending: PendingPhoto | null;
  newPhoto: DrivePhoto | null; verified: boolean; progress: number; error: string;
}
function DrivePhotosPanel({ owner, ensureSaved }: { owner: PhotoOwner; ensureSaved?: () => Promise<void> }) {
  const [rows, setRows] = useState<DrivePhoto[]>([]);
  const [confirmed, setConfirmed] = useState<DrivePhoto[]>([]);
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const [viewId, setViewId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DrivePhoto | null>(null);
  const [replaceDraft, setReplaceDraft] = useState<ReplaceDraft | null>(null);
  const replaceRef = useRef<ReplaceDraft | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const updateReplace = (value: ReplaceDraft | null) => { replaceRef.current = value; setReplaceDraft(value); };
  const closeReplace = () => {
    if (actionBusy) return;
    if (replaceRef.current?.newPhoto) setNotice("新照片已保留在 Drive；請在清單核對後再處理舊照片。");
    updateReplace(null);
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void drivePhotos.list(owner).then(photos => {
      if (active) { setRows(photos); setLoading(false); }
    }).catch(cause => {
      if (active) { setError(errorText(cause)); setLoading(false); }
    });
    return () => { active = false; };
  }, [owner.type, owner.id, generation]);
  const photos = useMemo(() => {
    const ids = new Set(rows.map(row => row.id));
    return [...confirmed.filter(row => !ids.has(row.id)), ...rows];
  }, [rows, confirmed]);
  const viewIndex = photos.findIndex(photo => photo.id === viewId);
  async function refresh(expected?: { added?: string; removed?: string }) {
    const latest = await drivePhotos.list(owner);
    if (expected?.added && !latest.some(photo => photo.id === expected.added))
      throw new Error("Drive 清單尚未顯示新照片，請稍後重新核對");
    if (expected?.removed && latest.some(photo => photo.id === expected.removed))
      throw new Error("Drive 清單仍顯示舊照片，請稍後重新核對");
    setRows(latest);
    setConfirmed([]);
    setError("");
  }
  async function trashSelected() {
    if (!deleting || actionBusy) return;
    setActionBusy(true); setError(""); setNotice("");
    try {
      await ensureSaved?.();
      await drivePhotos.trash(owner, deleting);
      await refresh({ removed: deleting.id });
      setDeleting(null);
      setNotice("照片已移入 Google Drive 垃圾桶。");
    } catch (cause) { setError(errorText(cause)); }
    finally { setActionBusy(false); }
  }
  async function selectReplacement(file: File | undefined) {
    const current = replaceRef.current;
    if (!file || !current || actionBusy) return;
    // Do not abandon a photo that has already been uploaded but not yet reconciled.
    if (current.newPhoto || current.pending?.uncertain) return;
    updateReplace({ ...current, file, pending: null, verified: false, progress: 0, error: "正在檢查新照片…" });
    try {
      const pending = await drivePhotos.prepare(owner, file);
      if (replaceRef.current?.old.id === current.old.id)
        updateReplace({ ...current, file, pending, verified: false, progress: 0, error: "" });
    } catch (cause) {
      if (replaceRef.current?.old.id === current.old.id)
        updateReplace({ ...current, file, pending: null, verified: false, progress: 0, error: errorText(cause) });
    }
  }
  async function submitReplacement() {
    const draft = replaceRef.current;
    if (!draft || actionBusy || (!draft.pending && !draft.newPhoto)) return;
    setActionBusy(true); setError(""); setNotice("");
    try {
      await ensureSaved?.();
      let next = draft;
      if (!next.newPhoto) {
        if (!await drivePhotos.verifyManaged(owner, next.old)) throw new Error("原照片已移入垃圾桶，請重新讀取清單");
        const uploaded = await drivePhotos.uploadOne(owner, next.file!, next.pending!, progress => {
          const active = replaceRef.current;
          if (active?.old.id === draft.old.id) updateReplace({ ...active, progress });
        });
        next = { ...replaceRef.current!, newPhoto: uploaded };
        updateReplace(next);
        setConfirmed(current => current.some(row => row.id === uploaded.id) ? current : [uploaded, ...current]);
      }
      if (!next.verified) {
        await drivePhotos.readBlob(next.newPhoto!); // Confirm the new private image is readable before trashing the old one.
        next = { ...next, verified: true };
        updateReplace(next);
      }
      await drivePhotos.trash(owner, next.old);
      await refresh({ added: next.newPhoto!.id, removed: next.old.id });
      updateReplace(null);
      setNotice("照片已更換，舊照片已移入 Google Drive 垃圾桶。");
    } catch (cause) {
      const active = replaceRef.current;
      if (active) {
        const pending = active.file && !active.newPhoto
          ? await drivePhotos.prepare(owner, active.file).catch(() => active.pending) : active.pending;
        updateReplace({ ...active, pending, error: active.newPhoto
          ? `部分完成：新照片已上傳，舊照片可能仍在 Drive。${errorText(cause)} 請核對後重試移入垃圾桶。`
          : errorText(cause) });
      }
    } finally { setActionBusy(false); }
  }
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
        const pending = await drivePhotos.prepare(owner, file);
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
          await ensureSaved?.();
          const photo = await drivePhotos.uploadOne(owner, entry.file, entry.pending,
            progress => patch(entry.key, { progress }));
          setConfirmed(current => current.some(row => row.id === photo.id) ? current : [photo, ...current]);
          patch(entry.key, { state: "success", progress: 100, error: "" });
        } catch (cause) {
          const pending = await drivePhotos.prepare(owner, entry.file).catch(() => entry.pending);
          patch(entry.key, { state: "error", pending, error: errorText(cause) });
        }
      }
      setGeneration(value => value + 1);
    } finally { setBusy(false); }
  }
  return <div className="drive-photo-panel">
    <div className="section-heading"><h3>{owner.type === "record" ? "此完成紀錄" : "此事項"}的私人照片</h3>
      <button className="text-button" type="button" disabled={loading || busy || actionBusy} onClick={() => setGeneration(value => value + 1)}>重新讀取照片</button>
    </div>
    {error && !deleting && <p className="error-banner" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading && <p role="status">正在讀取 Drive 照片…</p>}
    {!loading && !error && !photos.length && <p className="empty">{owner.type === "record" ? "這筆完成紀錄" : "這件事項"}尚無私人 Drive 照片。</p>}
    {!!photos.length && <div className="drive-photo-grid">{photos.map(photo => <div className="drive-photo-card" key={photo.id}>
      <button type="button" className="drive-photo-open" aria-label={`放大預覽 ${photo.name}`} onClick={() => setViewId(photo.id)}><PrivateImage photo={photo} /></button>
      <span title={photo.name}>{photo.name}</span>
      <div className="actions"><button type="button" className="secondary" disabled={actionBusy || busy} onClick={() => { updateReplace({ old: photo, file: null, pending: null, newPhoto: null, verified: false, progress: 0, error: "" }); }}>更換</button>
        <button type="button" className="secondary" disabled={actionBusy || busy} onClick={() => setDeleting(photo)}>刪除</button></div>
    </div>)}</div>}
    <label>選取照片（JPG、PNG、WebP；每張最多 10 MB）
      <input aria-label="選取私人 Drive 照片" type="file" accept="image/jpeg,image/png,image/webp" multiple
        disabled={busy || selecting || actionBusy} onChange={event => { void select(event.target.files); event.target.value = ""; }} />
    </label>
    {selecting && <p role="status">正在檢查選取的照片…</p>}
    {!!entries.length && <div className="drive-upload-list">{entries.map(entry => <div key={entry.key}>
      <span>{entry.file.name} · {entry.state === "success" ? "已上傳並核對" :
        entry.state === "uploading" ? `上傳中 ${entry.progress}%` :
        entry.pending?.uncertain ? "等待核對" : entry.state === "error" ? "上傳失敗" : "待上傳"}</span>
      {entry.state === "uploading" && <progress max={100} value={entry.progress} aria-label={`${entry.file.name} 上傳進度`} />}
      {entry.error && <p className="error-banner" role="alert">{entry.error}</p>}
    </div>)}</div>}
    <button className="primary" type="button" disabled={busy || selecting || actionBusy || !entries.some(entry => entry.pending && entry.state !== "success")}
      onClick={() => void upload()}>{busy ? "正在上傳…" : "上傳／核對選取的照片"}</button>
    {viewIndex >= 0 && <PhotoViewer photos={photos} index={viewIndex} setIndex={index => setViewId(photos[index].id)} close={() => setViewId(null)} />}
    {deleting && <Modal title="刪除私人照片" close={() => { if (!actionBusy) setDeleting(null); }} error={error || undefined}>
      <p>確定要將「{deleting.name}」移入 Google Drive 垃圾桶嗎？</p>
      <div className="actions"><button type="button" className="secondary" disabled={actionBusy} onClick={() => setDeleting(null)}>取消</button>
        <button type="button" className="primary" disabled={actionBusy} onClick={() => void trashSelected()}>{actionBusy ? "正在核對並移入垃圾桶…" : "確認移入垃圾桶"}</button></div>
    </Modal>}
    {replaceDraft && <Modal title="更換私人照片" close={closeReplace} error={replaceDraft.error || undefined}>
      <div className="drive-replace-preview"><div><p>原照片：{replaceDraft.old.name}</p><PrivateImage photo={replaceDraft.old} /></div>
        <div><p>新照片：{replaceDraft.file?.name || "尚未選取"}</p>{replaceDraft.file && <LocalPreview file={replaceDraft.file} />}</div></div>
      {replaceDraft.newPhoto && <p role="status">新照片已上傳；正在核對及處理舊照片。若暫時關閉，請稍後在清單核對並處理舊照片。</p>}
      {!replaceDraft.newPhoto && <label>選取新照片（JPG、PNG、WebP；最多 10 MB）
        <input type="file" aria-label="選取更換照片" accept="image/jpeg,image/png,image/webp" disabled={actionBusy || replaceDraft.pending?.uncertain}
          onChange={event => { void selectReplacement(event.target.files?.[0]); event.target.value = ""; }} /></label>}
      {actionBusy && <progress max={100} value={replaceDraft.progress} aria-label="更換照片上傳進度" />}
      <div className="actions"><button type="button" className="secondary" disabled={actionBusy} onClick={closeReplace}>{replaceDraft.newPhoto ? "稍後處理" : "取消"}</button>
        <button type="button" className="primary" disabled={actionBusy || (!replaceDraft.pending && !replaceDraft.newPhoto)} onClick={() => void submitReplacement()}>
          {actionBusy ? "正在更換…" : replaceDraft.newPhoto ? "核對並完成更換" : "上傳新照片並更換"}</button></div>
    </Modal>}
  </div>;
}
