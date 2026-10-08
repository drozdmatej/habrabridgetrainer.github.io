import { useCloudProgress } from "./use-cloud-progress";
import { useCallback, useEffect, useRef, useState } from "react";
import { readStoredProgress, updateStoredProgress } from "./progress";
import type { ProgressStore } from "./progress";

const unavailable = "Prohlížeč neumožňuje ukládání. Můžeš trénovat, ale po zavření se postup nemusí zachovat.";

export function useProgress(firstSystemId: string, key: string, cloud?: { csrfToken: string | null }) {
  const remote = useCloudProgress(firstSystemId, key, !!cloud, cloud?.csrfToken || null);
  const local = useLocalProgress(firstSystemId, key, !cloud);
  return cloud ? remote : { ...local, syncStatus: null };
}
function useLocalProgress(firstSystemId: string, key: string, enabled: boolean) {
  const [store, setStore] = useState<ProgressStore>({ selectedSystemId: firstSystemId, systems: {} });
  const current = useRef(store);
  const pending = useRef(Promise.resolve());
  const mounted = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    mounted.current = true;
    try {
      const result = readStoredProgress(localStorage, key, firstSystemId);
      current.current = result.store;
      setStore(result.store);
      if (result.damaged) setWarning("Uložený postup je poškozený. Při dalším ukládání zachováme původní data v místní záloze.");
    } catch { setWarning(unavailable); }
    setLoaded(true);
    function sync(event: StorageEvent) {
      if (event.storageArea !== localStorage || (event.key !== key && event.key !== null)) return;
      try {
        const result = readStoredProgress(localStorage, key, firstSystemId);
        if (result.damaged) return; // Do not replace a working in-memory session with corrupt data.
        // Another tab's system selection must not change the current quiz's system.
        current.current = { ...result.store, selectedSystemId: current.current.selectedSystemId };
        setStore(current.current);
      } catch { setWarning(unavailable); }
    }
    window.addEventListener("storage", sync);
    return () => { mounted.current = false; window.removeEventListener("storage", sync); };
  }, [firstSystemId, key, enabled]);

  const update = useCallback((change: (store: ProgressStore) => ProgressStore) => {
    pending.current = pending.current.then(async () => {
      function commit() {
        if (!mounted.current) return;
        try {
          current.current = updateStoredProgress(localStorage, key, firstSystemId, latest => change({ ...latest, selectedSystemId: current.current.selectedSystemId }));
        } catch {
          current.current = change(current.current);
          setWarning(unavailable);
        }
        setStore(current.current);
      }
      // Serialize updates across tabs where Web Locks is available. The fallback
      // still rereads storage before each write instead of overwriting a stale snapshot.
      if (navigator.locks) await navigator.locks.request(`habra:${key}`, commit);
      else commit();
    }).catch(() => { if (mounted.current) setWarning(unavailable); });
  }, [firstSystemId, key, enabled]);

  return { store, update, loaded, warning };
}
