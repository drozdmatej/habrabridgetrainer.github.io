import { useEffect, useRef, useState } from "react";
import { api, PasswordField } from "./account";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function PasswordRecovery() {
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get("reset") || "");
  const [open, setOpen] = useState(!!token);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    // Fragments never reach the server. Remove the capability from the address
    // bar after opening so subsequent navigation cannot carry it elsewhere.
    if (token) history.replaceState(history.state, "", location.pathname + location.search);
  }, [token]);
  return <Dialog open={open} onOpenChange={next => { if (!busyRef.current) setOpen(next); }}><DialogContent className="account-dialog" aria-busy={busy}>
    <DialogHeader><DialogTitle>Obnova hesla</DialogTitle><DialogDescription>Nastav si nové heslo. Odkaz je jednorázový a platí jednu hodinu od vytvoření.</DialogDescription></DialogHeader>
    {done ? <><p role="status">Heslo bylo změněno. Stará přihlášení jsou ukončená; postup a oprávnění zůstávají zachované.</p><button className="button button-primary" onClick={() => location.reload()}>Pokračovat k přihlášení</button></> : <form className="account-form" onSubmit={event => {
      event.preventDefault(); if (busyRef.current) return;
      const form = event.currentTarget, data = new FormData(form);
      if (data.get("newPassword") !== data.get("confirmPassword")) { setError("Hesla se neshodují. Zadej je znovu."); return; }
      busyRef.current = true; setBusy(true); setError("");
      void api("/auth/reset-password", null, { token, newPassword: data.get("newPassword") }).then(() => {
        form.reset(); setDone(true); window.dispatchEvent(new Event("focus"));
      }).catch(err => setError(err instanceof Error ? err.message : "Heslo se nepodařilo změnit.")).finally(() => { busyRef.current = false; setBusy(false); });
    }}><fieldset disabled={busy}><PasswordField label="Nové heslo" name="newPassword" autoComplete="new-password"/><PasswordField label="Zopakovat nové heslo" name="confirmPassword" autoComplete="new-password"/><p>Heslo musí mít alespoň 12 znaků.</p><button className="button button-primary">{busy ? "Ukládám…" : "Nastavit nové heslo"}</button></fieldset></form>}
    {error && <p role="alert">{error}</p>}
  </DialogContent></Dialog>;
}
