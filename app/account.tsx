import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { matchesSearch } from "./search";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type AccountUser = { id: string; username: string; name: string; role: "student" | "editor" | "admin" };
export type AccountState = { user: AccountUser | null; csrfToken: string | null; loginAvailable: boolean };
export async function api<T>(path: string, csrfToken?: string | null, input?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: "same-origin", cache: "no-store", method: input === undefined ? "GET" : "POST", headers: input === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": csrfToken || "" }, body: input === undefined ? undefined : JSON.stringify(input) });
  if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("Serverové rozhraní není dostupné.");
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Požadavek selhal.");
  return value as T;
}
type AccountContextValue = { enabled: boolean; state: AccountState; setState: (state: AccountState) => void };
const AccountContext = createContext<AccountContextValue>({ enabled: false, state: { user: null, csrfToken: null, loginAvailable: false }, setState: () => {} });
export const useAccount = () => useContext(AccountContext);
export function AccountProvider({ initial, enabled, children }: { initial: AccountState; enabled: boolean; children: ReactNode }) {
  const [state, setState] = useState(initial);
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    const refresh = () => { void api<AccountState>("/me").then(next => { if (mounted) setState(next); }).catch(() => {}); };
    window.addEventListener("focus", refresh);
    if (typeof BroadcastChannel !== "undefined") { channel.current = new BroadcastChannel("habra-account"); channel.current.onmessage = refresh; }
    return () => { mounted = false; window.removeEventListener("focus", refresh); channel.current?.close(); channel.current = null; };
  }, [enabled]);
  return <AccountContext.Provider value={{ enabled, state, setState: next => { setState(next); channel.current?.postMessage("refresh"); } }}>{children}</AccountContext.Provider>;
}
const roleLabels = { student: "Student", editor: "Editor", admin: "Správce" };
function PasswordField({ label, name, autoComplete, minLength = 12 }: { label: string; name: string; autoComplete: string; minLength?: number }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return <label htmlFor={id}>{label}<div className="password-control">
    <input id={id} name={name} type={shown ? "text" : "password"} autoComplete={autoComplete} required minLength={minLength} maxLength={128}/>
    <button type="button" aria-label={`${shown ? "Skrýt" : "Zobrazit"} ${label.toLocaleLowerCase("cs")}`} aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
  </div></label>;
}
export function AccountPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { state, setState } = useAccount();
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [users, setUsers] = useState<AccountUser[] | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<AccountUser["role"] | "all">("all");
  const visibleUsers = users?.filter(user => matchesSearch(`${user.name} ${user.username}`, userSearch) && (roleFilter === "all" || roleFilter === user.role)) || [];
  async function perform(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); }
    catch (err) { setError(err instanceof Error ? err.message : "Operace selhala."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={next => { if (!busyRef.current) onOpenChange(next); }}><DialogContent className="account-dialog" aria-busy={busy}>
    <DialogHeader><DialogTitle>{state.user ? "Můj účet" : register ? "Vytvořit účet" : "Přihlášení"}</DialogTitle><DialogDescription>{state.user ? `${state.user.username} · ${roleLabels[state.user.role]}` : "Trénovat můžeš i bez účtu. Úpravy společných otázek jsou dostupné editorům a správcům."}</DialogDescription></DialogHeader>
    {state.user ? <>
      <p>Přihlášený uživatel: <strong>{state.user.name}</strong></p>
      <p>Výsledky tréninku se zatím ukládají pro tento účet v tomto prohlížeči.</p>
      <details><summary>Změnit heslo</summary><form className="account-form" onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
        void perform(async () => {
          if (data.get("newPassword") !== data.get("confirmPassword")) throw new Error("Nová hesla se neshodují. Zadej je znovu.");
          await api("/auth/password", state.csrfToken, { oldPassword: data.get("oldPassword"), newPassword: data.get("newPassword") });
          form.reset(); setNotice("Heslo změněno. Ostatní přihlášení tohoto účtu byla ukončena.");
        });
      }}><fieldset disabled={busy}>
        <PasswordField label="Současné heslo" name="oldPassword" autoComplete="current-password" minLength={1}/>
        <PasswordField label="Nové heslo" name="newPassword" autoComplete="new-password"/>
        <PasswordField label="Zopakovat nové heslo" name="confirmPassword" autoComplete="new-password"/>
        <button className="button button-secondary">Uložit nové heslo</button>
      </fieldset></form></details>
      <button className="button button-secondary" disabled={busy} onClick={() => perform(async () => {
        await api("/auth/logout", state.csrfToken, {}); setState({ user: null, csrfToken: null, loginAvailable: true }); setUsers(null); onOpenChange(false);
      })}>Odhlásit se</button>
      {state.user.role === "admin" && <section><h3>Oprávnění uživatelů</h3><p>Účet se v seznamu objeví po registraci. Editor může upravovat a zveřejňovat otázky pro všechny.</p>
        <button className="button button-secondary" disabled={busy} onClick={() => perform(async () => { setUsers(await api<AccountUser[]>("/admin/users")); })}>{users ? "Obnovit seznam" : "Načíst uživatele"}</button>
        {users && <>
          <div className="account-filters">
            <label>Hledat uživatele<input type="search" value={userSearch} onChange={event => setUserSearch(event.target.value)} placeholder="Jméno nebo uživatelské jméno"/></label>
            <label>Filtrovat podle role<select aria-label="Filtrovat podle role" value={roleFilter} onChange={event => setRoleFilter(event.target.value as typeof roleFilter)}><option value="all">Všechny role</option>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <p aria-live="polite">Zobrazeno {visibleUsers.length} z {users.length} uživatelů</p>
          </div>
          {!visibleUsers.length && <p>Žádný uživatel neodpovídá hledání.</p>}
          <ul className="account-users">{visibleUsers.map(user => <li key={user.id}><span>{user.name}<small>{user.username}</small></span><label>Role<select aria-label={`Role uživatele ${user.username}`} value={user.role} disabled={busy} onChange={event => {
            const role = event.target.value as AccountUser["role"];
            void perform(async () => {
              await api("/admin/role", state.csrfToken, { userId: user.id, role }); setUsers(await api<AccountUser[]>("/admin/users"));
              if (user.id === state.user?.id) { setState(await api<AccountState>("/me")); setUsers(null); }
              else setNotice(`Role uživatele ${user.username} změněna na ${roleLabels[role]}.`);
            });
          }}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></li>)}</ul>
        </>}
      </section>}
    </> : <form className="account-form" onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget); const form = event.currentTarget;
      void perform(async () => {
        if (register && data.get("password") !== data.get("confirmPassword")) throw new Error("Hesla se neshodují. Zadej je znovu.");
        const next = await api<AccountState>(register ? "/auth/register" : "/auth/login", null, { username: data.get("username"), password: data.get("password"), name: data.get("name") });
        form.reset(); setState(next); onOpenChange(false);
      });
    }}><fieldset disabled={busy}>
      <label>Uživatelské jméno<input name="username" autoComplete="username" required minLength={3} maxLength={32} pattern={"[a-zA-Z0-9][a-zA-Z0-9_.\\-]{2,31}"}/></label>
      {register && <label>Zobrazované jméno<input name="name" autoComplete="nickname" maxLength={80}/></label>}
      <PasswordField label="Heslo" name="password" autoComplete={register ? "new-password" : "current-password"}/>
      {register && <PasswordField label="Zopakovat heslo" name="confirmPassword" autoComplete="new-password"/>}
      <p>Jméno má 3–32 znaků bez diakritiky. Heslo musí mít alespoň 12 znaků.</p>
      <button className="button button-primary" disabled={!state.loginAvailable}>{busy ? "Zpracovávám…" : register ? "Vytvořit účet" : "Přihlásit se"}</button>
      <button type="button" className="button button-secondary" onClick={() => { setRegister(!register); setError(""); setNotice(""); }}>{register ? "Už mám účet" : "Vytvořit nový účet"}</button>
      {!state.loginAvailable && <p>Přihlášení správce ještě nenastavil.</p>}
    </fieldset></form>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </DialogContent></Dialog>;
}
