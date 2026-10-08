import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { api, ApiError } from "./account";
import { advanceReplica, aggregateReplicas, mergeSameReplica, readStoredProgress, updateStoredProgress, replicaSchema } from "./progress";
import type { ProgressReplica, ProgressStore } from "./progress";

const envelopeSchema = z.object({ own: replicaSchema, replicas: z.array(replicaSchema) });
type Envelope = z.infer<typeof envelopeSchema>;
const equal = (a: unknown, b: unknown) => JSON.stringify(a, (_, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value) === JSON.stringify(b, (_, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
async function lock<T>(name: string, work: () => T | Promise<T>): Promise<T> { return navigator.locks ? navigator.locks.request(name, work) : work(); }

export function useCloudProgress(firstSystemId: string, key: string, enabled: boolean, csrfToken: string | null) {
  const [store, setStore] = useState<ProgressStore>({ selectedSystemId: firstSystemId, systems: {} });
  const [loaded, setLoaded] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<"loading" | "syncing" | "synced" | "offline">("loading");
  const own = useRef<Envelope | null>(null);
  const selected = useRef(firstSystemId);
  const csrf = useRef(csrfToken); csrf.current = csrfToken;
  const generation = useRef(0);
  const updateWork = useRef<(change: (store: ProgressStore) => ProgressStore) => void>(() => {});
  const scheduleSync = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) return;
    const cloudKey = `${key}:cloud-v1`, marker = `${key}:cloud-migrated`, deviceKey = `${key}:cloud-device-id`;
    const id = ++generation.current;
    let active = true, running = false, again = false;
    let timer: number | undefined;
    let pending = Promise.resolve();
    const live = () => active && generation.current === id;
    const diskWarning = () => { if (live()) setWarning("Místní úložiště není dostupné. Online výsledky se ukládají k účtu, ale neodeslané odpovědi se po zavření stránky mohou ztratit."); };
    function read(): Envelope {
      let saved: Envelope | null = null;
      try {
        const raw = localStorage.getItem(cloudKey);
        if (raw) {
          const parsed = envelopeSchema.safeParse(JSON.parse(raw));
          if (parsed.success) saved = parsed.data;
          else throw new Error("damaged");
        }
      } catch {
        try {
          const raw = localStorage.getItem(cloudKey);
          if (raw) {
            let backup = cloudKey + ':damaged';
            for (let suffix = 1; localStorage.getItem(backup) !== null; suffix++) backup = cloudKey + ':damaged:' + suffix;
            localStorage.setItem(backup, raw);
          }
        } catch { /* Keep the in-memory replica if storage is unavailable. */ }
        diskWarning();
      }
      if (!saved) saved = own.current;
      if (!saved) {
        let imported: ProgressStore = { selectedSystemId: firstSystemId, systems: {} };
        try {
          // The old key becomes an aggregate cache. Import it only once, before
          // any cloud data is cached, so deleting a replica cannot duplicate it.
          if (!localStorage.getItem(marker)) {
            const old = readStoredProgress(localStorage, key, firstSystemId);
            if (!old.damaged) imported = old.store;
            else setWarning("Poškozený místní postup nebyl importován. Původní data zůstávají zachovaná.");
          }
        } catch { diskWarning(); }
        let deviceId = crypto.randomUUID();
        try {
          const oldId = localStorage.getItem(deviceKey);
          if (oldId && z.string().uuid().safeParse(oldId).success) deviceId = oldId as typeof deviceId;
          localStorage.setItem(deviceKey, deviceId);
        } catch {
          // Without a durable identity, repeatedly importing a legacy summary
          // would count it once per page load. Leave that summary untouched.
          imported = { selectedSystemId: firstSystemId, systems: {} }; diskWarning();
        }
        saved = { own: { deviceId, revision: 0, store: imported }, replicas: [] };
      } else if (own.current?.own.deviceId === saved.own.deviceId) {
        saved = { ...saved, own: { ...saved.own, store: { ...mergeSameReplica(saved.own.store, own.current.own.store), selectedSystemId: saved.own.store.selectedSystemId } } };
      }
      if (own.current) {
        const receipts = new Map(saved.replicas.map(replica => [replica.deviceId, replica]));
        for (const replica of own.current.replicas) {
          const previous = receipts.get(replica.deviceId);
          receipts.set(replica.deviceId, previous ? { ...previous, revision: Math.max(previous.revision, replica.revision), store: previous.revision >= replica.revision ? mergeSameReplica(replica.store, previous.store) : mergeSameReplica(previous.store, replica.store) } : replica);
        }
        saved = { ...saved, replicas: [...receipts.values()] };
      }
      const ownDeviceId = saved.own.deviceId;
      const self = saved.replicas.find(replica => replica.deviceId === ownDeviceId);
      if (self) saved = { ...saved, own: { ...saved.own, revision: Math.max(saved.own.revision, self.revision), store: mergeSameReplica(self.store, saved.own.store) } };
      return saved;
    }
    function save(next: Envelope) {
      own.current = next;
      const aggregate = aggregateReplicas([...next.replicas, next.own], selected.current);
      try {
        localStorage.setItem(deviceKey, next.own.deviceId);
        localStorage.setItem(cloudKey, JSON.stringify(next));
        localStorage.setItem(marker, "1");
        updateStoredProgress(localStorage, key, firstSystemId, () => aggregate);
      } catch { diskWarning(); }
      if (live()) setStore(aggregate);
    }
    async function ingest(replicas: ProgressReplica[]) {
      await lock(`habra:${key}`, () => {
        if (!live()) return;
        const latest = read(), server = replicas.find(item => item.deviceId === latest.own.deviceId);
        save({ replicas, own: { ...latest.own, revision: server?.revision || 0, store: server ? mergeSameReplica(server.store, latest.own.store) : latest.own.store } });
      });
    }
    function schedule(delay = 250) {
      if (!live()) return;
      if (running) { again = true; return; }
      window.clearTimeout(timer); timer = window.setTimeout(() => { void flush(); }, delay);
    }
    async function flush() {
      if (!live() || !own.current) return;
      if (running) { again = true; return; }
      running = true; again = false; setSyncStatus("syncing");
      try {
        await pending;
        await lock(`habra:cloud-sync:${key}`, async () => {
          if (!live()) return;
          const replicas = z.array(replicaSchema).parse(await api("/progress"));
          await ingest(replicas);
          if (!live()) return;
          const payload = own.current!.own;
          const server = replicas.find(item => item.deviceId === payload.deviceId);
          if (Object.keys(payload.store.systems).length && (!server || !equal(server.store, payload.store))) {
            const uploaded = z.array(replicaSchema).parse(await api("/progress", csrf.current, payload));
            await ingest(uploaded);
          }
          if (!live()) return;
          const latest = own.current!, acknowledged = latest.replicas.find(item => item.deviceId === latest.own.deviceId);
          const dirty = Object.keys(latest.own.store.systems).length > 0 && (!acknowledged || !equal(acknowledged.store, latest.own.store));
          setSyncStatus(dirty ? "syncing" : "synced"); again ||= dirty;
        });
      } catch (error) {
        if (live()) {
          setSyncStatus("offline");
          if (error instanceof ApiError && error.status === 409) again = true;
        }
      } finally {
        running = false;
        if (again && live()) schedule(1000);
      }
    }
    updateWork.current = change => {
      pending = pending.then(() => lock(`habra:${key}`, () => {
        if (!live()) return;
        const latest = read();
        const before = aggregateReplicas([...latest.replicas, latest.own], selected.current);
        const after = change(before); selected.current = after.selectedSystemId;
        save({ ...latest, own: { ...latest.own, store: advanceReplica(latest.own.store, before, after) } });
        setSyncStatus("syncing"); schedule();
      })).catch(() => { if (live()) { diskWarning(); setSyncStatus("offline"); } });
    };
    scheduleSync.current = () => schedule(0);
    void lock(`habra:${key}`, () => {
      if (!live()) return;
      const initial = read(); selected.current = initial.own.store.selectedSystemId;
      save(initial); setLoaded(true); schedule(0);
    });
    const refresh = () => schedule(0);
    const storage = (event: StorageEvent) => {
      if (event.key !== cloudKey && event.key !== null) return;
      void lock(`habra:${key}`, () => { if (live()) save(read()); });
    };
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh); window.addEventListener("storage", storage);
    const interval = window.setInterval(refresh, 30_000);
    return () => { active = false; window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); window.removeEventListener("storage", storage); };
  }, [enabled, firstSystemId, key]);
  useEffect(() => { if (enabled) scheduleSync.current(); }, [enabled, csrfToken]);
  const update = useCallback((change: (store: ProgressStore) => ProgressStore) => updateWork.current(change), []);
  return { store, update, loaded, warning, syncStatus };
}
