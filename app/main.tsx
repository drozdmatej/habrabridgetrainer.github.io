import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import TrainerApp from "./trainer-app";
import { contentSchema, publishedContent } from "./content-validation";
import type { TrainerContent } from "./types";
import "./globals.css";
import "./editor.css";

function App() {
  const [content, setContent] = useState<TrainerContent | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}content/trainer.json`, { signal: controller.signal, cache: "no-cache" })
      .then(async response => {
        if (!response.ok) throw new Error("Otázky se nepodařilo načíst.");
        const parsed = publishedContent(contentSchema.parse(await response.json()));
        if (!parsed.systems.length || !parsed.systems[0].levels.length) throw new Error("Obsah nemá žádné zveřejněné kapitoly.");
        setContent(parsed);
      })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Neplatný obsah."); });
    return () => controller.abort();
  }, []);
  if (content) return <TrainerApp initialContent={content} />;
  return <main className="main"><h1>HABRA</h1><p role="status">{error || "Načítám otázky…"}</p>{error && <button className="button button-primary" onClick={() => location.reload()}>Načíst znovu</button>}</main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
