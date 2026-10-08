import { useEffect, useState } from "react";
import { SunMoon } from "lucide-react";

type Theme = "system" | "light" | "dark";
const themeKey = "habra-theme";
function readTheme(): Theme {
  try { const value = localStorage.getItem(themeKey); return value === "light" || value === "dark" ? value : "system"; }
  catch { return "system"; }
}
export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = theme === "dark" || (theme === "system" && media.matches) ? "dark" : "light"; };
    const sync = (event: StorageEvent) => { if (event.key === themeKey || event.key === null) setTheme(readTheme()); };
    apply(); media.addEventListener("change", apply); window.addEventListener("storage", sync);
    return () => { media.removeEventListener("change", apply); window.removeEventListener("storage", sync); };
  }, [theme]);
  return <details className="theme-control" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
    <summary className="nav-button" aria-label="Vzhled stránky" title="Vzhled stránky"><SunMoon size={18}/></summary>
    <div><label htmlFor="theme-preference">Vzhled stránky</label><select id="theme-preference" value={theme} onChange={event => {
      const next = event.target.value as Theme; setTheme(next);
      try { localStorage.setItem(themeKey, next); } catch { /* The selected theme still works for this page. */ }
    }}><option value="system">Podle zařízení</option><option value="light">Světlý</option><option value="dark">Tmavý</option></select></div>
  </details>;
}
