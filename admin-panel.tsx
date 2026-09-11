"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { ArrowDown, ArrowUp, Download, FileUp, Plus, Save, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { contentSchema, publicationIssues, validateQuestion } from "./content-validation";
import { QuestionPreview } from "./question-card";
import { Checkbox } from "@/components/ui/checkbox";
import type { ChoiceOption, TrainerContent, TrainerLevel, TrainerQuestion } from "./types";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; content: TrainerContent; onSaved: (content: TrainerContent) => void };

const makeId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
const newLevel = (): TrainerLevel => ({ id: makeId("level"), title: "Nová kapitola", description: "", passingPercent: 80, status: "draft", questions: [] });
const newQuestion = (): TrainerQuestion => ({ id: makeId("question"), type: "bid_box", sequence: [], hand: { s: "", h: "", d: "", c: "" }, prompt: "Nová otázka", correctBid: "PASS", rationale: "" });

export default function AdminPanel({ open, onOpenChange, content, onSaved }: Props) {
  const [draft, setDraft] = useState<TrainerContent>(content);
  const [levelId, setLevelId] = useState(content.systems[0]?.levels[0]?.id || "");
  const [questionId, setQuestionId] = useState(content.systems[0]?.levels[0]?.questions[0]?.id || "");
  const [password, setPassword] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [systemId, setSystemId] = useState(content.systems[0].id);
  const [draftRevision, setDraftRevision] = useState(0);
  const [publishedRevision, setPublishedRevision] = useState(0);
  const [savedSnapshot, setSavedSnapshot] = useState(JSON.stringify(content));
  const [sourceLabel, setSourceLabel] = useState("Načti koncept trenérským kódem.");
  const busy = useRef(false);
  const dirty = JSON.stringify(draft) !== savedSnapshot;
  const issues = useMemo(() => publicationIssues(draft), [draft]);
  const [status, setStatus] = useState<{ tone: "idle" | "saving" | "success" | "error"; text: string }>({ tone: "idle", text: "" });
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const system = draft.systems.find((item) => item.id === systemId) || draft.systems[0];
  const level = system?.levels.find((item) => item.id === levelId);
  const question = level?.questions.find((item) => item.id === questionId);
  const levelIndex = system?.levels.findIndex((item) => item.id === levelId) ?? -1;
  const questionIndex = level?.questions.findIndex((item) => item.id === questionId) ?? -1;
  const totalQuestions = useMemo(() => system?.levels.reduce((sum, item) => sum + item.questions.length, 0) || 0, [system]);

  function mutateSystem(callback: (levels: TrainerLevel[]) => TrainerLevel[]) {
    setDraft((current) => ({ ...current, systems: current.systems.map((item) => item.id === system.id ? { ...item, levels: callback(item.levels) } : item) }));
  }
  function patchLevel(patch: Partial<TrainerLevel>) { mutateSystem((levels) => levels.map((item) => item.id === levelId ? { ...item, ...patch } : item)); }
  function patchQuestion(patch: Partial<TrainerQuestion>) { if (!level) return; patchLevel({ questions: level.questions.map((item) => item.id === questionId ? { ...item, ...patch } : item) }); }
  function addLevel() { const created = newLevel(); mutateSystem((levels) => [...levels, created]); setLevelId(created.id); setQuestionId(""); }
  function deleteLevel() { if (!level || !confirm(`Smazat kapitolu „${level.title}“ včetně všech úloh?`)) return; const next = system.levels.filter((item) => item.id !== level.id); mutateSystem(() => next); setLevelId(next[0]?.id || ""); setQuestionId(next[0]?.questions[0]?.id || ""); }
  function moveLevel(direction: -1 | 1) { if (!level || levelIndex < 0) return; const target = levelIndex + direction; if (target < 0 || target >= system.levels.length) return; mutateSystem((levels) => { const next = [...levels]; [next[levelIndex], next[target]] = [next[target], next[levelIndex]]; return next; }); }
  function addQuestion() { if (!level) return; const created = newQuestion(); patchLevel({ questions: [...level.questions, created] }); setQuestionId(created.id); }
  function deleteQuestion() { if (!level || !question || !confirm("Smazat tuto úlohu?")) return; const next = level.questions.filter((item) => item.id !== question.id); patchLevel({ questions: next }); setQuestionId(next[0]?.id || ""); }
  function moveQuestion(direction: -1 | 1) { if (!level || questionIndex < 0) return; const target = questionIndex + direction; if (target < 0 || target >= level.questions.length) return; const next = [...level.questions]; [next[questionIndex], next[target]] = [next[target], next[questionIndex]]; patchLevel({ questions: next }); }
  function patchOption(optionId: string, patch: Partial<ChoiceOption>) { if (!question) return; patchQuestion({ options: (question.options || []).map((item) => item.id === optionId ? { ...item, ...patch } : item) }); }
  function markCorrect(optionId: string) { if (!question) return; patchQuestion({ options: (question.options || []).map((item) => ({ ...item, correct: item.id === optionId })) }); }
  function addOption() { if (!question) return; patchQuestion({ options: [...(question.options || []), { id: makeId("option"), text: "Nová možnost", correct: !(question.options || []).some((item) => item.correct) }] }); }
  function deleteOption(optionId: string) { if (!question) return; const next = (question.options || []).filter((item) => item.id !== optionId); if (next.length && !next.some((item) => item.correct)) next[0] = { ...next[0], correct: true }; patchQuestion({ options: next }); }

  async function requestAction(action: string, values: Record<string, unknown> = {}) {
    const response = await fetch("/api/content", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password, action, ...values }) });
    const result = z.object({
      error: z.string().optional(), content: z.unknown().optional(),
      draftRevision: z.number().default(0), publishedRevision: z.number().default(0),
      source: z.string().optional(),
    }).parse(await response.json());
    if (!response.ok) throw new Error(result.error || "Operace selhala.");
    return result;
  }

  async function perform(action: "load" | "save" | "publish") {
    if (busy.current) return;
    if (!password.trim()) { setStatus({ tone: "error", text: "Zadej trenérský kód." }); return; }
    if (action === "load" && dirty && !confirm("Načtením nahradíš neuložené úpravy. Nejdřív je můžeš exportovat. Pokračovat?")) return;
    if (action === "publish" && (!loaded || dirty || !draftRevision || issues.length)) {
      setStatus({ tone: "error", text: "Nejprve oprav chyby a ulož koncept." }); return;
    }
    if (action === "publish" && !confirm("Zveřejnit uložený koncept? Hráči po načtení aplikace uvidí připravené kapitoly; rozpracované zůstanou skryté.")) return;
    busy.current = true;
    setStatus({ tone: "saving", text: action === "load" ? "Načítám koncept…" : action === "save" ? "Ukládám koncept…" : "Zveřejňuji…" });
    try {
      if (action === "load") {
        const result = await requestAction("load");
        const parsed = contentSchema.parse(result.content);
        setDraft(parsed); setSavedSnapshot(JSON.stringify(parsed));
        setSystemId(parsed.systems[0].id); setLevelId(parsed.systems[0].levels[0]?.id || "");
        setQuestionId(parsed.systems[0].levels[0]?.questions[0]?.id || "");
        setDraftRevision(result.draftRevision); setPublishedRevision(result.publishedRevision); setLoaded(true);
        setSourceLabel(result.source === "draft" ? "Načten uložený koncept" : result.source === "published" ? "Načten zveřejněný obsah jako základ konceptu" : "Načten výchozí JSON jako základ konceptu");
        setStatus({ tone: "success", text: "Obsah je připravený k úpravám." });
      } else if (action === "save") {
        const parsed = contentSchema.safeParse(draft);
        if (!parsed.success) throw new Error("Neplatná struktura: " + parsed.error.issues.map((i) => i.message).join(" "));
        const result = await requestAction("save", { content: parsed.data, draftRevision });
        setDraft(parsed.data); setSavedSnapshot(JSON.stringify(parsed.data)); setDraftRevision(result.draftRevision);
        setSourceLabel("Uložený koncept");
        setStatus({ tone: "success", text: "Koncept uložen. Obsah pro hráče se nezměnil." });
      } else {
        const result = await requestAction("publish", { draftRevision, publishedRevision });
        setPublishedRevision(result.publishedRevision);
        onSaved(contentSchema.parse(result.content));
        setStatus({ tone: "success", text: "Připravené kapitoly byly zveřejněny. Rozpracované zůstávají v konceptu." });
      }
    } catch (error) { setStatus({ tone: "error", text: error instanceof Error ? error.message : "Operace selhala. Úpravy zůstaly v editoru." }); }
    finally { busy.current = false; }
  }

  function exportJson() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "habra-koncept.json"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importJson(file?: File) {
    if (!file || !loaded || busy.current) return;
    try {
      if (file.size > 500_000) throw new Error("Soubor smí mít nejvýše 500 kB.");
      const parsed = contentSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error("Neplatná struktura JSON: " + parsed.error.issues.slice(0,3).map((i) => i.path.join(".") + ": " + i.message).join("; "));
      if (!confirm("Nahradit obsah editoru tímto JSON? Zveřejněný obsah se nezmění, dokud koncept neuložíš a nezveřejníš.")) return;
      setDraft(parsed.data); setSystemId(parsed.data.systems[0].id); setLevelId(parsed.data.systems[0].levels[0]?.id || ""); setQuestionId(parsed.data.systems[0].levels[0]?.questions[0]?.id || "");
      setStatus({ tone: "idle", text: "JSON načten do editoru. Zkontroluj chyby a ulož koncept." });
    } catch (error) { setStatus({ tone: "error", text: error instanceof Error ? error.message : "Neplatný JSON." }); }
    finally { if (fileInput.current) fileInput.current.value = ""; }
  }
  function close(next: boolean) {
    if (busy.current) return;
    if (!next && dirty && !confirm("Zahodit neuložené úpravy? Uložený koncept zůstane zachovaný.")) return;
    onOpenChange(next);
  }

  return <Dialog open={open} onOpenChange={close}><DialogContent className="admin-dialog" showCloseButton>
    <DialogHeader><DialogTitle>Správa obsahu</DialogTitle><DialogDescription>Upravuj kapitoly a úlohy bez zásahu do kódu. Koncept ulož zvlášť a zveřejni až po kontrole.</DialogDescription></DialogHeader>
    <div className="admin-summary"><span>{system?.name || "Systém"}</span><strong>{system?.levels.length || 0} kapitol · {totalQuestions} úloh</strong><div><button disabled={!loaded || status.tone === "saving"} onClick={() => fileInput.current?.click()}><FileUp size={15}/> Import JSON</button><button onClick={exportJson}><Download size={15}/> Export JSON</button><input ref={fileInput} type="file" accept="application/json" hidden onChange={(event) => importJson(event.target.files?.[0])}/></div></div>
    {!loaded ? <div className="admin-empty"><h3>Nejprve načti aktuální koncept</h3><p>Zadej trenérský kód dole a klikni na „Načíst koncept“. Koncept je oddělený od otázek pro hráče.</p></div> :
    <fieldset disabled={status.tone === "saving"} className="admin-grid">

      <aside className="admin-sidebar">
        <div className="admin-sidebar-head"><strong>Kapitoly</strong><button onClick={addLevel} aria-label="Přidat kapitolu"><Plus size={16}/></button></div>
        {draft.systems.length > 1 && <label>Systém<select value={system.id} onChange={(event) => { const selected = draft.systems.find((x) => x.id === event.target.value)!; setSystemId(selected.id); setLevelId(selected.levels[0]?.id || ""); setQuestionId(selected.levels[0]?.questions[0]?.id || ""); }}>{draft.systems.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        <div className="admin-list">{system?.levels.map((item, index) => <button key={item.id} className={item.id === levelId ? "active" : ""} onClick={() => { setLevelId(item.id); setQuestionId(item.questions[0]?.id || ""); }}><span>{String(index + 1).padStart(2,"0")}</span><div><strong>{item.title}</strong><small>{item.questions.length} úloh · {item.status === "draft" ? "rozpracováno" : "ke zveřejnění"}</small></div></button>)}</div>
      </aside>
      <div className="admin-editor">
        {level ? <>
          <section className="editor-section"><div className="editor-heading"><div><span>Kapitola {levelIndex + 1}</span><h3>Základní údaje</h3></div><div><button onClick={() => moveLevel(-1)} disabled={levelIndex === 0} aria-label="Posunout kapitolu nahoru"><ArrowUp size={16}/></button><button onClick={() => moveLevel(1)} disabled={levelIndex === system.levels.length - 1} aria-label="Posunout kapitolu dolů"><ArrowDown size={16}/></button><button className="danger" onClick={deleteLevel} aria-label="Smazat kapitolu"><Trash2 size={16}/></button></div></div>
            <label className="chapter-status"><Checkbox checked={level.status === "draft"} onCheckedChange={(checked) => patchLevel({ status: checked ? "draft" : "active" })}/> Rozpracovaná kapitola — nezveřejňovat</label>
            <label>Název<input value={level.title} onChange={(event) => patchLevel({ title: event.target.value })}/></label>
            <label>Stručný popis<textarea rows={2} value={level.description} onChange={(event) => patchLevel({ description: event.target.value })}/></label>
            <label>Hranice úspěchu v testu<input type="number" min="0" max="100" value={level.passingPercent} onChange={(event) => patchLevel({ passingPercent: Number(event.target.value) })}/></label>
          </section>
          <section className="editor-section"><div className="editor-heading"><div><span>Úlohy</span><h3>Obsah kapitoly</h3></div><button className="add-button" onClick={addQuestion}><Plus size={16}/> Přidat úlohu</button></div>
            <div className="question-tabs">{level.questions.map((item,index)=><button key={item.id} className={item.id===questionId ? "active":""} onClick={()=>setQuestionId(item.id)}>{index+1}</button>)}</div>
            {question ? <div className="question-editor">
              <div className="editor-heading compact"><strong>Úloha {questionIndex + 1}</strong><div><button onClick={()=>moveQuestion(-1)} disabled={questionIndex===0} aria-label="Posunout úlohu nahoru"><ArrowUp size={16}/></button><button onClick={()=>moveQuestion(1)} disabled={questionIndex===level.questions.length-1} aria-label="Posunout úlohu dolů"><ArrowDown size={16}/></button><button className="danger" onClick={deleteQuestion} aria-label="Smazat úlohu"><Trash2 size={16}/></button></div></div>
              <label>Typ úlohy<select value={question.type} onChange={(event)=>{ const type=event.target.value as TrainerQuestion["type"]; patchQuestion({ type, options:type==="choice" ? question.options || [{id:makeId("option"),text:"Správná možnost",correct:true},{id:makeId("option"),text:"Nesprávná možnost",correct:false}] : undefined, correctBid:type==="bid_box" ? question.correctBid || "PASS" : undefined }); }}><option value="bid_box">Dražební deska</option><option value="choice">Výběr z možností</option></select></label>
              <label>Otázka<textarea rows={2} value={question.prompt} onChange={(event)=>patchQuestion({prompt:event.target.value})}/></label>
              <label>Předchozí dražba <small>(odděluj čárkou)</small><input value={question.sequence.join(",")} onChange={(event)=>patchQuestion({sequence:event.target.value.trim() ? event.target.value.split(",") : []})}/></label>
              <label className="chapter-status"><Checkbox checked={!!question.hand} onCheckedChange={(checked) => patchQuestion({ hand: checked ? { s: "", h: "", d: "", c: "" } : undefined })}/> Zobrazit ruku hráče</label>
              {question.hand && <div className="hand-inputs"><span>Ruka hráče</span>{(["s","h","d","c"] as const).map((suit)=><label key={suit}><b className={`suit-${suit}`}>{suit==="s"?"♠":suit==="h"?"♥":suit==="d"?"♦":"♣"}</b><input value={question.hand?.[suit] || ""} onChange={(event)=>patchQuestion({hand:{s:question.hand?.s||"",h:question.hand?.h||"",d:question.hand?.d||"",c:question.hand?.c||"",[suit]:event.target.value.toUpperCase()}})}/></label>)}</div>}
              {question.type === "bid_box" ? <label>Správná hláška<input value={question.correctBid || ""} onChange={(event)=>patchQuestion({correctBid:event.target.value.toUpperCase()})}/></label> : <div className="option-editor"><div className="option-heading"><span>Možnosti odpovědí</span><button onClick={addOption}><Plus size={14}/> Přidat možnost</button></div>{(question.options||[]).map((option)=><div key={option.id} className="option-row"><input type="radio" name="correct-option" checked={option.correct} onChange={()=>markCorrect(option.id)} aria-label="Označit jako správnou"/><input value={option.text} onChange={(event)=>patchOption(option.id,{text:event.target.value})}/><button onClick={()=>deleteOption(option.id)} aria-label="Smazat možnost"><Trash2 size={15}/></button></div>)}</div>}
              <label>Vysvětlení<textarea rows={3} value={question.rationale} onChange={(event)=>patchQuestion({rationale:event.target.value})}/></label>
              <div className="question-errors" role="status">{validateQuestion(question).length ? <><strong>Ke kontrole v této úloze</strong><ul>{validateQuestion(question).map((message) => <li key={message}>{message}</li>)}</ul></> : <p>Kontrola úlohy je v pořádku.</p>}</div>
            </div> : <p className="admin-empty">V této kapitole zatím nejsou žádné úlohy.</p>}
          </section>
        </> : <div className="admin-empty">Přidej první kapitolu.</div>}
      </div>
      <aside className="admin-preview">
        <h3>Náhled pro hráče</h3><p>Kliknutí v náhledu neovlivní statistiky.</p>
        {question ? <QuestionPreview key={JSON.stringify(question)} question={question}/> : <p>Vyber úlohu.</p>}
        <div className="publication-errors"><h3>Kontrola zveřejnění ({issues.length})</h3>
          <p>Kontroluje jen kapitoly určené ke zveřejnění. Rozpracované kapitoly se vynechají.</p>
          {issues.length ? <ul>{issues.map((issue, index) => <li key={index}><button onClick={() => {
            if (issue.systemId) setSystemId(issue.systemId);
            if (issue.levelId) setLevelId(issue.levelId);
            if (issue.questionId) setQuestionId(issue.questionId);
          }}>{issue.message}</button></li>)}</ul> : <p>Všechny připravené kapitoly prošly kontrolou.</p>}
        </div>
      </aside>
    </fieldset>}
    <div className="admin-footer">
      <div><label>Trenérský kód<input type="password" value={password} disabled={status.tone === "saving"} onChange={(event)=>setPassword(event.target.value)} placeholder="Zadej trenérský kód"/></label>
        <p>{sourceLabel}{loaded && (dirty ? " · neuložené změny" : " · bez neuložených změn")}</p>
        {status.text && <p role="status" className={status.tone}>{status.text}</p>}
      </div>
      <div className="draft-actions">
        <button className="button button-secondary" disabled={status.tone === "saving"} onClick={() => perform("load")}>{loaded ? "Načíst znovu" : "Načíst koncept"}</button>
        {loaded && <><button className="button button-secondary" disabled={status.tone === "saving"} onClick={() => perform("save")}><Save size={16}/>Uložit koncept</button>
        <button className="button button-primary" disabled={status.tone === "saving" || dirty || !draftRevision || issues.length > 0} onClick={() => perform("publish")}>Zveřejnit koncept</button></>}
      </div>
    </div>
  </DialogContent></Dialog>;
}
