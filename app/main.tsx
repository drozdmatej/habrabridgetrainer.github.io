import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PasswordRecovery } from "./password-recovery";
import TrainerApp from "./trainer-app";
import { loadPublishedContent } from "./content-validation";
import type { TrainerContent } from "./types";
import { AccountProvider, useAccount, api, type AccountState } from "./account";
import "./globals.css";
import "./editor.css";
import "./appearance.css";

function App() {
  const [content, setContent] = useState<TrainerContent | null>(null);
  const [error, setError] = useState("");
  const [account, setAccount] = useState<AccountState>({ user: null, csrfToken: null, loginAvailable: false });
  const [backend, setBackend] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const me = await fetch("/api/me", { signal: controller.signal, cache: "no-store" });
      const available = me.ok && !!me.headers.get("Content-Type")?.includes("application/json");
      if (!me.ok && me.status !== 404) throw new Error("Přihlášení se nepodařilo načíst. Zkus to později.");
      if (available) setAccount(await me.json());
      setBackend(available);
      return fetch(available ? "/api/content" : `${import.meta.env.BASE_URL}content/trainer.json`, { signal: controller.signal, cache: "no-store" });
    })()
      .then(async response => {
        if (!response.ok) throw new Error("Otázky se nepodařilo načíst.");
        const parsed = loadPublishedContent(await response.json(), true);
        setContent(parsed);
      })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Neplatný obsah."); });
    return () => controller.abort();
  }, []);
  if (content) return <AccountProvider initial={account} enabled={backend}><AccessibleTrainer initialContent={content} backend={backend}/></AccountProvider>;
  return <main className="main"><h1>HABRA</h1><p role="status">{error || "Načítám otázky…"}</p>{error && <button className="button button-primary" onClick={() => location.reload()}>Načíst znovu</button>}</main>;
}
function AccessibleTrainer({ initialContent, backend }: { initialContent: TrainerContent; backend: boolean }) {
  const { state } = useAccount();
  const identity = `${state.user?.id || "guest"}:${state.user?.role || "guest"}`;
  const [snapshot, setSnapshot] = useState({ identity, content: initialContent });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!backend) return;
    const controller = new AbortController();
    let requestId = 0;
    const refresh = async () => {
      const current = ++requestId;
      try {
        const content = loadPublishedContent(await api("/content"), true);
        if (controller.signal.aborted || current !== requestId) return;
        setSnapshot(previous => previous.identity === identity && JSON.stringify(previous.content) === JSON.stringify(content) ? previous : { identity, content }); setError("");
      } catch { if (!controller.signal.aborted && current === requestId) setError("Dostupné systémy se nepodařilo načíst. Obnov stránku."); }
    };
    void refresh();
    // Staff edit a versioned draft; background content updates must not discard it.
    if (state.user && state.user.role !== "student") return () => controller.abort();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, [identity, backend]);
  if (snapshot.identity !== identity) return <main className="main"><p role="status">{error || "Načítám dostupné systémy…"}</p>{error && <button onClick={() => location.reload()}>Načíst znovu</button>}</main>;
  return <TrainerApp key={JSON.stringify(snapshot.content)} initialContent={snapshot.content}/>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><PasswordRecovery/><App /></StrictMode>);
