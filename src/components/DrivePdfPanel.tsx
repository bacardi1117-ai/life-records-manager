import { useEffect, useMemo, useState } from "react";
import { drivePhotos } from "../api/drivePhotos";
import type { DrivePdf, PendingPhoto, PhotoOwner } from "../api/drivePhotos";
import { Modal } from "./Forms";

interface PdfEntry {
  key: string;
  file: File;
  pending?: PendingPhoto;
  progress: number;
  state: "ready" | "uploading" | "success" | "error";
  error: string;
}
const errorText = (value: unknown) => value instanceof Error ? value.message : "Google Drive 文件操作失敗";
const sizeLabel = (size: number) => `${(size / 1024 / 1024).toFixed(2)} MB`;
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "日期未知" : date.toLocaleDateString("zh-TW");
}
function PdfPreview({ file, close, download }: { file: DrivePdf; close: () => void; download: (file: DrivePdf) => Promise<string | null> }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  useEffect(() => {
    let active = true;
    let blobUrl = "";
    setUrl(""); setError("");
    void drivePhotos.readPdf(file).then(blob => {
      blobUrl = URL.createObjectURL(blob);
      if (active) setUrl(blobUrl);
      else URL.revokeObjectURL(blobUrl);
    }).catch(cause => { if (active) setError(errorText(cause)); });
    return () => { active = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [file.id]);
  return <Modal title={`預覽 PDF：${file.name}`} close={close} error={downloadError || error || undefined}>
    {!url && !error && <p role="status">正在載入私人 PDF…</p>}
    {url && <iframe className="drive-pdf-preview" title={`PDF 預覽：${file.name}`} src={url} sandbox="allow-same-origin" />}
    <p className="muted small">若瀏覽器無法顯示 PDF，可下載原始文件查看。</p>
    <button type="button" className="secondary" onClick={() => void download(file).then(value => setDownloadError(value ?? ""))}>下載原始 PDF</button>
  </Modal>;
}
export default function DrivePdfPanel({ owner, ensureSaved }: { owner: PhotoOwner; ensureSaved?: () => Promise<void> }) {
  const [rows, setRows] = useState<DrivePdf[]>([]);
  const [confirmed, setConfirmed] = useState<DrivePdf[]>([]);
  const [entries, setEntries] = useState<PdfEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generation, setGeneration] = useState(0);
  const [preview, setPreview] = useState<DrivePdf | null>(null);
  const [deleting, setDeleting] = useState<DrivePdf | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void drivePhotos.listPdf(owner).then(files => {
      if (active) { setRows(files); setLoading(false); }
    }).catch(cause => { if (active) { setError(errorText(cause)); setLoading(false); } });
    return () => { active = false; };
  }, [owner.type, owner.id, generation]);
  const files = useMemo(() => {
    const seen = new Set(rows.map(row => row.id));
    return [...confirmed.filter(row => !seen.has(row.id)), ...rows];
  }, [rows, confirmed]);
  const patch = (key: string, value: Partial<PdfEntry>) =>
    setEntries(current => current.map(entry => entry.key === key ? { ...entry, ...value } : entry));
  async function select(selected: FileList | null) {
    if (!selected || busy || selecting) return;
    setSelecting(true); setError("");
    const next: PdfEntry[] = [];
    for (const file of Array.from(selected)) {
      const key = crypto.randomUUID();
      try {
        const pending = await drivePhotos.preparePdf(owner, file);
        if (next.some(entry => entry.pending?.key === pending.key)) continue;
        next.push({ key, file, pending, progress: 0, state: "ready", error: "" });
      } catch (cause) {
        next.push({ key, file, progress: 0, state: "error", error: errorText(cause) });
      }
    }
    setEntries(next); setSelecting(false);
  }
  async function upload() {
    if (busy || selecting) return;
    setBusy(true); setError(""); setNotice("");
    try {
      for (const entry of entries) {
        if (!entry.pending || entry.state === "success") continue;
        patch(entry.key, { state: "uploading", error: "" });
        try {
          await ensureSaved?.();
          const result = await drivePhotos.uploadPdf(owner, entry.file, entry.pending,
            progress => patch(entry.key, { progress }));
          setConfirmed(current => current.some(row => row.id === result.id) ? current : [result, ...current]);
          patch(entry.key, { state: "success", progress: 100, error: "" });
        } catch (cause) {
          const pending = await drivePhotos.preparePdf(owner, entry.file).catch(() => entry.pending);
          patch(entry.key, { state: "error", pending, error: errorText(cause) });
        }
      }
      setGeneration(value => value + 1);
    } finally { setBusy(false); }
  }
  async function download(file: DrivePdf): Promise<string | null> {
    if (downloading) return null;
    setDownloading(file.id); setError("");
    try {
      const blob = await drivePhotos.readPdf(file);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = file.name; link.style.display = "none";
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return null;
    } catch (cause) { const message = errorText(cause); setError(message); return message; }
    finally { setDownloading(null); }
  }
  async function trash() {
    if (!deleting || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await ensureSaved?.();
      await drivePhotos.trashPdf(owner, deleting);
      const latest = await drivePhotos.listPdf(owner);
      if (latest.some(file => file.id === deleting.id)) throw new Error("Drive 清單仍顯示文件，請稍後重新核對");
      setRows(latest); setConfirmed([]); setDeleting(null);
      setNotice("PDF 已移入 Google Drive 垃圾桶。");
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  return <div className="drive-pdf-panel">
    <div className="section-heading"><h3>{owner.type === "record" ? "此完成紀錄" : "此事項"}的私人 PDF 文件</h3>
      <button type="button" className="text-button" disabled={loading || busy} onClick={() => setGeneration(value => value + 1)}>重新讀取 PDF</button></div>
    {error && !deleting && <p className="error-banner" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading && <p role="status">正在讀取私人 PDF…</p>}
    {!loading && !error && !files.length && <p className="empty">尚無私人 PDF 文件。</p>}
    {!!files.length && <div className="drive-pdf-list">{files.map(file => <div className="drive-pdf-row" key={file.id}>
      <div><strong>{file.name}</strong><p className="muted small">{sizeLabel(file.size)} · 建立於 {dateLabel(file.createdTime)}</p></div>
      <div className="actions"><button type="button" className="secondary" onClick={() => setPreview(file)}>預覽</button>
        <button type="button" className="secondary" disabled={downloading === file.id} onClick={() => void download(file)}>{downloading === file.id ? "下載中…" : "下載 PDF"}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setDeleting(file)}>刪除</button></div>
    </div>)}</div>}
    <label>選取 PDF 文件（每份最多 20 MB）
      <input type="file" aria-label="選取私人 Drive PDF" accept="application/pdf,.pdf" multiple disabled={busy || selecting}
        onChange={event => { void select(event.target.files); event.target.value = ""; }} /></label>
    {selecting && <p role="status">正在檢查 PDF…</p>}
    {!!entries.length && <div className="drive-upload-list">{entries.map(entry => <div key={entry.key}>
      <span>{entry.file.name} · {entry.state === "success" ? "已上傳並核對" : entry.state === "uploading" ? `上傳中 ${entry.progress}%` :
        entry.pending?.uncertain ? "等待核對" : entry.state === "error" ? "上傳失敗" : "待上傳"}</span>
      {entry.state === "uploading" && <progress max={100} value={entry.progress} aria-label={`${entry.file.name} 上傳進度`} />}
      {entry.error && <p className="error-banner" role="alert">{entry.error}</p>}
    </div>)}</div>}
    <button type="button" className="primary" disabled={busy || selecting || !entries.some(entry => entry.pending && entry.state !== "success")}
      onClick={() => void upload()}>{busy ? "正在上傳 PDF…" : "上傳／核對選取的 PDF"}</button>
    {preview && <PdfPreview key={preview.id} file={preview} close={() => setPreview(null)} download={download} />}
    {deleting && <Modal title="刪除私人 PDF" close={() => { if (!busy) setDeleting(null); }} error={error || undefined}>
      <p>確定要將「{deleting.name}」移入 Google Drive 垃圾桶嗎？</p>
      <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={() => setDeleting(null)}>取消</button>
        <button type="button" className="primary" disabled={busy} onClick={() => void trash()}>{busy ? "正在核對並移入垃圾桶…" : "確認移入垃圾桶"}</button></div>
    </Modal>}
  </div>;
}
