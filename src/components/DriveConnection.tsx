import { useEffect, useSyncExternalStore } from "react";
import { driveAuth } from "../api/driveAuth";

export default function DriveConnection() {
  const snapshot = useSyncExternalStore(driveAuth.subscribe, driveAuth.getSnapshot);
  useEffect(() => { void driveAuth.prepare(); }, []);
  return <section className="drive-connection" aria-label="私人 Google Drive 連線">
    <h2>私人 Google Drive</h2>
    {snapshot.state === "unconfigured" ? <p role="status">Google Drive 尚未設定</p> : <>
      {snapshot.state === "authorized" && <p role="status">Google Drive 已授權，基本連線驗證成功</p>}
      {snapshot.state === "loading" && <p role="status">正在載入 Google 授權元件…</p>}
      {snapshot.state === "authorizing" && <p role="status">正在等待 Google 授權並驗證 Drive 連線…</p>}
      {snapshot.state === "idle" && <p>授權後可驗證私人 Drive 連線；目前尚未提供附件上傳。</p>}
      {snapshot.state === "revoked" && <p role="status">已取消 Google Drive 授權</p>}
      {snapshot.error && <p className="error-banner" role="alert">{snapshot.error}</p>}
      {snapshot.state !== "authorized" && <button className="primary" type="button"
        disabled={snapshot.state === "authorizing" || snapshot.state === "loading"}
        onClick={() => void (driveAuth.isPrepared ? driveAuth.authorize() : driveAuth.prepare())}>
        {snapshot.state === "idle" ? "連接私人 Google Drive" : driveAuth.isPrepared ? "重新授權 Google Drive" : "重試載入 Google 授權元件"}
      </button>}
      {snapshot.state === "authorized" && <button className="secondary" type="button" onClick={() => driveAuth.revoke()}>
        取消 Google Drive 授權
      </button>}
      <p className="muted small">僅請求 drive.file 權限。附件上傳、刪除與分享尚未開放；本頁不產生公開分享連結。</p>
    </>}
  </section>;
}
