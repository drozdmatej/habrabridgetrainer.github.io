import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import TrainerApp from "./trainer-app";
import { loadPublishedContent } from "./content-validation";
import type { TrainerContent } from "./types";
import { AccountProvider, type AccountState } from "./account";
import "./globals.css";
import "./editor.css";

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
        const parsed = loadPublishedContent(await response.json());
        setContent(parsed);
      })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Neplatný obsah."); });
    return () => controller.abort();
  }, []);
  if (content) return <AccountProvider initial={account} enabled={backend}><TrainerApp initialContent={content} /></AccountProvider>;
  return <main className="main"><h1>HABRA</h1><p role="status">{error || "Načítám otázky…"}</p>{error && <button className="button button-primary" onClick={() => location.reload()}>Načíst znovu</button>}</main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
