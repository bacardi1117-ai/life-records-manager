import { useEffect, useRef, useState } from "react";
import { AppsScriptBridge } from "../api/appsScriptBridge";
import { connectionSettings } from "../api/connectionSettings";
import { createSheetsItemsApi } from "../api/sheetsItems";
import type { ItemChanges, SheetsItem } from "../api/sheetsItems";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "連線操作失敗";
export function useSheetsConnection() {
  const host = useRef<HTMLDivElement>(null);
  const bridge = useRef<AppsScriptBridge | null>(null);
  const generation = useRef(0);
  const running = useRef(false);
  const [url, setUrl] = useState("");
  const [items, setItems] = useState<SheetsItem[]>([]);
  const [selected, setSelected] = useState<SheetsItem | null>(null);
  const [status, setStatus] = useState<
    "disconnected" | "connecting" | "connected" | "error"
  >("disconnected");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stale, setStale] = useState(false);
  useEffect(() => {
    try {
      setUrl(connectionSettings.read());
    } catch (e) {
      setError(message(e));
    }
    return () => {
      generation.current++;
      bridge.current?.dispose();
      bridge.current = null;
    };
  }, []);
  async function connect(value: string) {
    if (running.current || !host.current) return;
    const current = ++generation.current;
    bridge.current?.dispose();
    const candidate = new AppsScriptBridge(host.current);
    bridge.current = candidate;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setStatus("connecting");
    setStale(true);
    try {
      await candidate.connect(value);
      const data = await createSheetsItemsApi(candidate).list();
      if (current !== generation.current) return;
      connectionSettings.save(value);
      setUrl(value.trim());
      setItems(data);
      setSelected(null);
      setStatus("connected");
      setStale(false);
      setNotice("已連線並載入 Google Sheets Items；本機資料未上傳。");
    } catch (e) {
      if (current !== generation.current) return;
      candidate.dispose();
      bridge.current = null;
      setStatus("error");
      setError(message(e));
    } finally {
      if (current === generation.current) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  function disconnect(removeUrl = false) {
    if (removeUrl) {
      try {
        connectionSettings.remove();
        setUrl("");
      } catch (e) {
        setError(message(e));
        return;
      }
    }
    generation.current++;
    bridge.current?.dispose();
    bridge.current = null;
    running.current = false;
    setBusy(false);
    setStatus("disconnected");
    setStale(true);
    setSelected(null);
    setError("");
    setNotice("已中斷連線，本機 Mock 紀錄保持不變。");
  }
  async function run(
    action: (
      api: ReturnType<typeof createSheetsItemsApi>,
      valid: () => boolean,
    ) => Promise<void>,
    writing = false,
  ) {
    if (
      running.current ||
      !bridge.current ||
      status !== "connected" ||
      (writing && stale)
    )
      return false;
    const current = generation.current;
    const valid = () => current === generation.current;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action(createSheetsItemsApi(bridge.current), valid);
      return valid();
    } catch (e) {
      if (valid()) {
        setError(message(e));
        setStale(true);
      }
      return false;
    } finally {
      if (valid()) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  async function refresh() {
    return run(async (api, valid) => {
      const rows = await api.list();
      if (valid()) {
        setItems(rows);
        setStale(false);
        setSelected(null);
      }
    });
  }
  async function get(itemId: string) {
    return run(async (api, valid) => {
      const item = await api.get(itemId);
      if (valid()) setSelected(item);
    });
  }
  async function write(
    action: (api: ReturnType<typeof createSheetsItemsApi>) => Promise<unknown>,
  ) {
    return run(async (api, valid) => {
      await action(api);
      if (!valid()) return;
      setSelected(null);
      setNotice("Items 寫入成功。");
      try {
        const rows = await api.list();
        if (valid()) {
          setItems(rows);
          setStale(false);
        }
      } catch {
        if (valid()) {
          setStale(true);
          setError(
            "Items 已寫入成功，但重新讀取失敗。請按「重新讀取」，不要重複新增或送出。",
          );
        }
      }
    }, true);
  }
  return {
    host,
    url,
    items,
    selected,
    status,
    busy,
    error,
    notice,
    stale,
    connect,
    disconnect,
    refresh,
    get,
    clearSelected: () => setSelected(null),
    create: (payload: ItemChanges) => write((api) => api.create(payload)),
    update: (itemId: string, payload: ItemChanges) =>
      write((api) => api.update(itemId, payload)),
    archive: (itemId: string) => write((api) => api.archive(itemId)),
    restore: (itemId: string) => write((api) => api.restore(itemId)),
  };
}
export type SheetsConnection = ReturnType<typeof useSheetsConnection>;
