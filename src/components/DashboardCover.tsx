import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ClipboardList } from "lucide-react";
import { driveAuth } from "../api/driveAuth";
import { drivePhotos } from "../api/drivePhotos";
import type { DrivePhoto } from "../api/drivePhotos";

/** Only fetch private metadata after OAuth; never persist image bytes or a public URL. */
export function useDashboardCovers(enabled: boolean) {
  const auth = useSyncExternalStore(driveAuth.subscribe, driveAuth.getSnapshot);
  const [photos, setPhotos] = useState<Record<string, DrivePhoto>>({});
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const changed = () => setVersion(value => value + 1);
    window.addEventListener("life-records-covers-changed", changed);
    return () => window.removeEventListener("life-records-covers-changed", changed);
  }, []);
  useEffect(() => {
    if (!enabled || auth.state !== "authorized") { setPhotos({}); setError(""); return; }
    let active = true;
    void drivePhotos.listCovers().then(rows => {
      if (!active) return;
      const next: Record<string,DrivePhoto> = {};
      for (const row of rows.sort((a,b) => b.createdTime.localeCompare(a.createdTime)))
        if (!next[row.ownerId]) next[row.ownerId] = row;
      setPhotos(next); setError("");
    }).catch(cause => { if (active) { setPhotos({}); setError(cause instanceof Error ? cause.message : "封面讀取失敗"); } });
    return () => { active = false; };
  }, [enabled, auth.state, version]);
  return { photos, error };
}
export function DashboardCover({ photo }: { photo?: DrivePhoto }) {
  const auth = useSyncExternalStore(driveAuth.subscribe, driveAuth.getSnapshot);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!photo || auth.state !== "authorized") return;
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setVisible(true); }, { rootMargin: "250px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [photo?.id, auth.state]);
  useEffect(() => {
    setUrl("");
    if (!photo || !visible || auth.state !== "authorized") return;
    let active = true, blobUrl = "";
    void drivePhotos.readBlob(photo).then(blob => {
      blobUrl = URL.createObjectURL(blob);
      if (active) setUrl(blobUrl); else URL.revokeObjectURL(blobUrl);
    }).catch(() => { if (active) setUrl(""); });
    return () => { active = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [photo?.id, visible, auth.state]);
  return <div ref={ref} className="dashboard-cover-image">
    {url && auth.state === "authorized" ? <img src={url} alt={photo?.name ?? "事項封面"} /> :
      <div className="cover-placeholder"><ClipboardList size={64} /></div>}
  </div>;
}
