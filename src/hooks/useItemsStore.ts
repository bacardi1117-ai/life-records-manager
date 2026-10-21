import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ItemsStore } from "../api/itemsStore";
export function useItemsStore() {
  const host = useRef<HTMLDivElement>(null);
  const [store] = useState(() => new ItemsStore(() => host.current));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.start();
    return () => store.dispose();
  }, [store]);
  return { store, state, host };
}
