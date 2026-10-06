"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, BookOpen, ChevronRight, LockKeyhole, Play, Settings2, ShieldCheck, Trophy } from "lucide-react";
import AdminPanel from "./admin-panel";
import { QuestionCard } from "./question-card";
import { emptyProgress, restoreProgress, recordAnswer, shuffle, passesTest, completeLevel } from "./progress";
import type { ProgressState, ProgressStore } from "./progress";

import type { TrainerContent, TrainerLevel, TrainerQuestion } from "./types";

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: { name: string; title?: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }; execute: (input: unknown) => unknown | Promise<unknown> }, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
  }
}

type View = "levels" | "quiz" | "summary" | "stats";
const difficultyLabels = { beginner: "Začátečník", intermediate: "Pokročilejší", advanced: "Pokročilý", expert: "Velmi pokročilý" };

export default function TrainerApp({ initialContent }: { initialContent: TrainerContent }) {
  const content = initialContent;
  const contentReady = true;
  
  const [adminOpen, setAdminOpen] = useState(false);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [store, setStore] = useState<ProgressStore>({ selectedSystemId: content.systems[0].id, systems: {} });
  const system = content.systems.find(item => item.id === store.selectedSystemId) || content.systems[0];
  const progress = store.systems[system.id] || emptyProgress();
  const [storageWarning, setStorageWarning] = useState(false);
  const answeredRef = useRef(false);
  const storageKey = `habra-progress-pages-v2:${location.pathname}`;
  function setProgress(update: (current: ProgressState) => ProgressState) {
    setStore(current => ({ ...current, systems: { ...current.systems, [system.id]: update(current.systems[system.id] || emptyProgress()) } }));
  }
  function selectSystem(id: string) {
    setStore(current => ({ ...current, selectedSystemId: id }));
    setLevel(null); setAnswer(null); setView("levels");
  }
  const [view, setView] = useState<View>("levels");
  const [level, setLevel] = useState<TrainerLevel | null>(null);
  const [mode, setMode] = useState<"lesson" | "test" | "review">("lesson");
  const [questions, setQuestions] = useState<TrainerQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [answer, setAnswer] = useState<{ correct: boolean; selected: string } | null>(null);
  const [summary, setSummary] = useState({ percent: 0, passed: false });

  useEffect(() => {
    try { setStore(restoreProgress(localStorage.getItem(storageKey), localStorage.getItem(`habra-progress-pages-v1:${location.pathname}`), content.systems[0].id)); }
    catch { setStorageWarning(true); }
    finally { setProgressLoaded(true); }
  }, [storageKey, content]);
  useEffect(() => {
    if (!progressLoaded) return;
    try { localStorage.setItem(storageKey, JSON.stringify(store)); }
    catch { setStorageWarning(true); }
  }, [store, progressLoaded, storageKey]);

  const completed = system.levels.filter(item => progress.levels[item.id]?.testPassed).length;
  const currentQuestion = questions[questionIndex];
  const accuracy = progress.answered ? Math.round((progress.correct / progress.answered) * 100) : 0;
  const unlockedIds = useMemo(() => {
    const ids = new Set<string>();
    system.levels.forEach((item, index) => { if (index === 0 || progress.levels[system.levels[index - 1].id]?.testPassed) ids.add(item.id); });
    return ids;
  }, [progress.levels, system.levels]);

  function begin(selectedLevel: TrainerLevel, selectedMode: "lesson" | "test" | "review") {
    if (!contentReady || !selectedLevel.questions.length) return;
    if (!unlockedIds.has(selectedLevel.id) || (selectedMode === "test" && !progress.levels[selectedLevel.id]?.lessonCompleted)) return;
    const selectedQuestions = selectedMode === "review" ? selectedLevel.questions.filter(q => progress.mistakes[selectedLevel.id]?.includes(q.id)) : selectedLevel.questions;
    if (!selectedQuestions.length) return;
    setLevel(selectedLevel); setMode(selectedMode);
    setQuestions(selectedMode === "test" ? shuffle(selectedQuestions) : selectedQuestions);
    answeredRef.current = false;
    setQuestionIndex(0); setScore(0); setAnswer(null); setView("quiz");
    window.scrollTo({ top: 0 });
  }

  function choose(value: string, isCorrect: boolean) {
    if (answeredRef.current || !level || !currentQuestion) return;
    answeredRef.current = true;
    setAnswer({ selected: value, correct: isCorrect });
    if (isCorrect) setScore((current) => current + 1);
    setProgress(current => recordAnswer(current, level.id, currentQuestion.id, isCorrect));
  }

  function finish() {
    if (!level) return;
    const percent = Math.round((score / questions.length) * 100);
    const passed = mode === "lesson" || (mode === "review" ? score === questions.length : passesTest(score, questions.length, level.passingPercent));
    setProgress(current => completeLevel(current, level.id, mode, score, questions.length, level.passingPercent));
    setSummary({ percent, passed }); setView("summary");
  }

  function next() { if (questionIndex + 1 < questions.length) { setQuestionIndex((current) => current + 1); setAnswer(null); answeredRef.current = false; window.scrollTo({ top: 0 }); } else { finish(); window.scrollTo({ top: 0 }); } }

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const report = (error: unknown) => console.warn("WebMCP tool registration failed", error);
    void Promise.resolve(context.registerTool({
      name: "list_training_levels", title: "Vypsat tréninkové kapitoly",
      description: "Vrátí kapitoly aktuálně vybraného systému a stav jejich odemčení.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => system.levels.map((item, index) => ({ id: item.id, title: item.title, questionCount: item.questions.length, unlocked: index === 0 || !!progress.levels[system.levels[index - 1].id]?.testPassed })),
    }, { signal: lifecycle.signal })).catch(report);
    void Promise.resolve(context.registerTool({
      name: "start_bridge_lesson", title: "Spustit bridžovou lekci",
      description: "Otevře trénink vybrané kapitoly podle jejího ID.",
      inputSchema: { type: "object", properties: { levelId: { type: "string" } }, required: ["levelId"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => { const levelId = (input as { levelId?: string }).levelId; const selected = system.levels.find((item) => item.id === levelId); if (!selected) throw new Error("Kapitola neexistuje."); if (!unlockedIds.has(selected.id)) throw new Error("Nejprve dokonči test předchozí kapitoly."); begin(selected, "lesson"); return { started: true, levelId: selected.id, questionCount: selected.questions.length }; },
    }, { signal: lifecycle.signal })).catch(report);
    return () => lifecycle.abort();
  }, [system, progress.levels]);

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setView("levels")} aria-label="Přejít na přehled lekcí"><span className="brand-mark"><span>♣</span><span>♦</span><span>♥</span><span>♠</span></span><span><strong>HABRA</strong><small>{content.title}</small></span></button>
      <div className="top-actions"><button className="nav-button" aria-label="Výsledky" onClick={() => setView("stats")}><BarChart3 size={18}/><span>Výsledky</span></button><button className="nav-button" aria-label="Správa obsahu" onClick={() => setAdminOpen(true)}><Settings2 size={18}/><span>Správa obsahu</span></button></div>
    </header>
    <main className="main">
      {storageWarning && <p className="storage-warning" role="status">Prohlížeč neumožňuje ukládání. Můžeš trénovat, ale po zavření se postup nemusí zachovat.</p>}
      {(view === "levels" || view === "stats") && <section className="system-picker" aria-label="Výběr dražebního systému">
        <label htmlFor="training-system">Dražební systém</label>
        <select id="training-system" value={system.id} onChange={event => selectSystem(event.target.value)} disabled={!progressLoaded}>
          {content.systems.map(item => <option key={item.id} value={item.id}>{item.name}{item.difficulty ? ` · ${difficultyLabels[item.difficulty]}` : ""}</option>)}
        </select>
        <p>Postup i chyby se ukládají pro každý systém zvlášť.</p>
      </section>}
      {contentReady && view === "levels" && <>
        <section className="academy-head"><div><p className="eyebrow">Tréninkový plán</p><h1>{system.name}, krok za krokem.</h1><p>Nejdřív si projdi příklady s vysvětlením. Potom ověř systém v testu a odemkni další kapitolu.</p></div><div className="progress-orbit" aria-label={`${completed} z ${system.levels.length} úrovní dokončeno`}><strong>{completed}<span>/{system.levels.length}</span></strong><small>dokončeno</small></div></section>
        {system.difficulty && <span className="difficulty-badge">{difficultyLabels[system.difficulty]}</span>}
        {system.description && <p className="system-description">{system.description}</p>}
        {!!system.rules?.length && <details className="system-rules"><summary>Pravidla systému {system.name}</summary><ul>{system.rules.map(rule => <li key={rule}>{rule}</li>)}</ul><p>Ve sledech se střídají tvoje a partnerovy hlášky; soupeři pasují. Lekce nepokrývají celý systém.</p>{!!system.sources?.length && <><strong>Podklady</strong><ul>{system.sources.map(source => <li key={source}>{source}</li>)}</ul></>}</details>}
        <div className="system-row"><div><span className="status-dot"/> Aktivní systém</div><strong>{system.name}</strong><span>{system.levels.length} kapitoly · {system.levels.reduce((sum, item) => sum + item.questions.length, 0)} úloh</span></div>
        <section className="level-list" aria-label="Kapitoly systému">{system.levels.map((item, index) => {
          const unlocked = unlockedIds.has(item.id); const state = progress.levels[item.id] || { lessonCompleted:false, testPassed:false, bestScore:0 };
          return <article key={item.id} className={`level-card ${!unlocked ? "is-locked" : ""}`}><div className="level-number">{String(index + 1).padStart(2,"0")}</div><div className="level-copy"><div className="level-kicker">{state.testPassed ? "Zvládnuto" : state.lessonCompleted ? "Připraveno na test" : unlocked ? "Odemčeno" : "Zamčeno"}</div><h2>{item.title}</h2><p>{item.description}</p><div className="level-meta"><span><BookOpen size={15}/> {item.questions.length} úloh</span><span><ShieldCheck size={15}/> test od {item.passingPercent} %</span></div></div><div className="level-actions">{unlocked ? <><button className="button button-primary" disabled={!progressLoaded} onClick={() => begin(item,"lesson")}><Play size={16}/> {state.lessonCompleted ? "Procvičit znovu" : "Začít trénink"}</button><button className="button button-secondary" disabled={!state.lessonCompleted} onClick={() => begin(item,"test")}>Test {state.bestScore ? `· ${state.bestScore} %` : ""}<ChevronRight size={16}/></button>{item.questions.some(q => progress.mistakes[item.id]?.includes(q.id)) && <button className="button button-secondary" onClick={() => begin(item,"review")}>Procvičit chyby ({item.questions.filter(q => progress.mistakes[item.id]?.includes(q.id)).length})</button>}</> : <div className="locked-label"><LockKeyhole size={18}/> Dokonči předchozí kapitolu</div>}</div></article>;
        })}</section>
      </>}

      {view === "quiz" && currentQuestion && level && <section className="quiz-wrap">
        <div className="quiz-topline"><button className="text-button" onClick={() => setView("levels")}>← Ukončit</button><span>{mode === "lesson" ? "Trénink" : mode === "review" ? "Opakování chyb" : "Test"} · {level.title}</span><strong>{questionIndex + 1}/{questions.length}</strong></div>
        <div className="progress-track"><span style={{width:`${((questionIndex + (answer ? 1 : 0))/questions.length)*100}%`}}/></div>
        <QuestionCard key={currentQuestion.id} question={currentQuestion} answer={answer} onChoose={choose} onNext={next} nextLabel={questionIndex + 1 === questions.length ? "Zobrazit výsledek" : "Další úloha"}/>
      </section>}

      {view === "summary" && level && <section className="summary-card"><div className={`summary-icon ${summary.passed ? "pass":"fail"}`}><Trophy size={34}/></div><p className="eyebrow">{mode === "review" ? "Opakování dokončeno" : mode === "lesson" ? "Trénink dokončen" : summary.passed ? "Test splněn":"Ještě jednou"}</p><h1>{summary.percent} %</h1><p>{mode === "review" ? "Správně vyřešené úlohy byly odebrány ze seznamu chyb. Opakování nemění výsledek testu ani odemčení kapitol." : mode === "lesson" ? "Prošel jsi celou kapitolu. Teď můžeš pokračovat do testu." : summary.passed ? "Skvělá práce. Další kapitola je odemčená." : `K úspěchu potřebuješ alespoň ${level.passingPercent} %.`}</p><div><button className="button button-primary" onClick={()=>begin(level,mode)} disabled={mode === "review" && !level.questions.some(q => progress.mistakes[level.id]?.includes(q.id))}>Zkusit znovu</button><button className="button button-secondary" onClick={()=>setView("levels")}>Zpět ke kapitolám</button></div></section>}

      {view === "stats" && <section><div className="page-heading"><div><p className="eyebrow">Tvůj postup</p><h1>Výsledky · {system.name}</h1></div><button className="button button-secondary" onClick={()=>setView("levels")}>Zpět ke kapitolám</button></div><div className="stat-grid"><div><span>Vyřešené úlohy</span><strong>{progress.answered}</strong></div><div><span>Správně</span><strong>{progress.correct}</strong></div><div><span>Úspěšnost</span><strong>{accuracy} %</strong></div><div><span>Složené testy</span><strong>{completed}</strong></div></div><div className="result-list">{system.levels.map((item,index)=>{ const state=progress.levels[item.id]; return <div key={item.id}><span>{index+1}</span><div><strong>{item.title}</strong><small>{state?.lessonCompleted ? "Trénink hotov":"Trénink čeká"} · {state?.testPassed ? "test splněn":"test nesplněn"}</small></div><div><b>{state?.bestScore||0} %</b>{item.questions.some(q => progress.mistakes[item.id]?.includes(q.id)) && <button className="text-button" onClick={() => begin(item,"review")}>Procvičit chyby ({item.questions.filter(q => progress.mistakes[item.id]?.includes(q.id)).length})</button>}</div></div>; })}</div></section>}
    </main>
    <footer>{content.academyName}<span>•</span> {system.name}</footer>
    {adminOpen && <AdminPanel open={adminOpen} onOpenChange={setAdminOpen} content={content}/>}
  </div>;
}
