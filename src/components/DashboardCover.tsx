import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ClipboardList } from "lucide-react";
import { driveAuth } from "../api/driveAuth";
import { drivePhotos } from "../api/drivePhotos";

/** Load only visible item covers through the same owner-scoped list used by the photo tab. */
export default function DashboardCover({ itemId }: { itemId: string }) {
  const auth = useSyncExternalStore(driveAuth.subscribe, driveAuth.getSnapshot);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const changed = () => setVersion(current => current + 1);
    window.addEventListener("life-records-covers-changed", changed);
    return () => window.removeEventListener("life-records-covers-changed", changed);
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: "250px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [itemId]);
  useEffect(() => {
    setUrl(""); setName(""); setError("");
    if (!visible || auth.state !== "authorized") return;
    let active = true, blobUrl = "";
    void drivePhotos.list({ type: "item", id: itemId }).then(async photos => {
      const cover = photos.find(photo => photo.isCover);
      if (!cover) return;
      const blob = await drivePhotos.readBlob(cover);
      blobUrl = URL.createObjectURL(blob);
      if (active) { setName(cover.name); setUrl(blobUrl); }
      else URL.revokeObjectURL(blobUrl);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : "封面讀取失敗");
    });
    return () => { active = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [itemId, visible, auth.state, version]);
  return <div ref={ref} className="dashboard-cover-image">
    {url && auth.state === "authorized" ? <img src={url} alt={name || "事項封面"} /> :
      <div className="cover-placeholder"><ClipboardList size={64} /></div>}
    {error && <span className="cover-read-error" role="status" title={error}>封面讀取失敗</span>}
  </div>;
}
