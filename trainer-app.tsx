"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, BookOpen, ChevronRight, LockKeyhole, Play, Settings2, ShieldCheck, Trophy } from "lucide-react";
import AdminPanel from "./admin-panel";
import { QuestionCard } from "./question-card";
import { contentSchema } from "./content-validation";
import type { TrainerContent, TrainerLevel, TrainerQuestion } from "./types";

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: { name: string; title?: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }; execute: (input: unknown) => unknown | Promise<unknown> }, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
  }
}

type LevelState = { lessonCompleted: boolean; testPassed: boolean; bestScore: number };
type ProgressState = { levels: Record<string, LevelState>; answered: number; correct: number };
type View = "levels" | "quiz" | "summary" | "stats";

const emptyProgress: ProgressState = { levels: {}, answered: 0, correct: 0 };
export default function TrainerApp({ initialContent }: { initialContent: TrainerContent }) {
  const [content, setContent] = useState<TrainerContent>(initialContent);
  const [contentReady, setContentReady] = useState(false);
  const [contentError, setContentError] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const system = content.systems[0];
  const [view, setView] = useState<View>("levels");
  const [progress, setProgress] = useState<ProgressState>(emptyProgress);
  const [level, setLevel] = useState<TrainerLevel | null>(null);
  const [mode, setMode] = useState<"lesson" | "test">("lesson");
  const [questions, setQuestions] = useState<TrainerQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [answer, setAnswer] = useState<{ correct: boolean; selected: string } | null>(null);
  const [summary, setSummary] = useState({ percent: 0, passed: false });

  useEffect(() => { try { const saved = localStorage.getItem("habra-progress-v4"); if (saved) setProgress(JSON.parse(saved)); } catch { /* prázdný postup */ } finally { setProgressLoaded(true); } }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/content", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error("Obsah se nepodařilo načíst."); const result = await response.json() as { content: unknown }; return { content: contentSchema.parse(result.content) }; })
      .then((result) => { setContent(result.content); setContentReady(true); })
      .catch((error) => { if (!controller.signal.aborted) setContentError(error.message || "Obsah není dostupný."); });
    return () => controller.abort();
  }, []);
  useEffect(() => { if (progressLoaded) localStorage.setItem("habra-progress-v4", JSON.stringify(progress)); }, [progress, progressLoaded]);

  const completed = Object.values(progress.levels).filter((item) => item.testPassed).length;
  const currentQuestion = questions[questionIndex];
  const accuracy = progress.answered ? Math.round((progress.correct / progress.answered) * 100) : 0;
  const unlockedIds = useMemo(() => {
    const ids = new Set<string>();
    system.levels.forEach((item, index) => { if (index === 0 || progress.levels[system.levels[index - 1].id]?.testPassed) ids.add(item.id); });
    return ids;
  }, [progress.levels, system.levels]);

  function begin(selectedLevel: TrainerLevel, selectedMode: "lesson" | "test") {
    if (!contentReady || !selectedLevel.questions.length) return;
    setLevel(selectedLevel); setMode(selectedMode);
    setQuestions(selectedMode === "test" ? [...selectedLevel.questions].sort(() => Math.random() - 0.5) : selectedLevel.questions);
    setQuestionIndex(0); setScore(0); setAnswer(null); setView("quiz");
  }

  function choose(value: string, isCorrect: boolean) {
    if (answer) return;
    setAnswer({ selected: value, correct: isCorrect });
    if (isCorrect) setScore((current) => current + 1);
    setProgress((current) => ({ ...current, answered: current.answered + 1, correct: current.correct + (isCorrect ? 1 : 0) }));
  }

  function finish() {
    if (!level) return;
    const percent = Math.round((score / questions.length) * 100);
    const passed = mode === "lesson" || percent >= level.passingPercent;
    setProgress((current) => {
      const existing = current.levels[level.id] || { lessonCompleted: false, testPassed: false, bestScore: 0 };
      return { ...current, levels: { ...current.levels, [level.id]: { lessonCompleted: mode === "lesson" ? true : existing.lessonCompleted, testPassed: mode === "test" ? existing.testPassed || passed : existing.testPassed, bestScore: mode === "test" ? Math.max(existing.bestScore, percent) : existing.bestScore } } };
    });
    setSummary({ percent, passed }); setView("summary");
  }

  function next() { if (questionIndex + 1 < questions.length) { setQuestionIndex((current) => current + 1); setAnswer(null); } else finish(); }

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const report = (error: unknown) => console.warn("WebMCP tool registration failed", error);
    void Promise.resolve(context.registerTool({
      name: "list_training_levels", title: "Vypsat tréninkové kapitoly",
      description: "Vrátí aktuální kapitoly systému Lepší levná a stav jejich odemčení.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => system.levels.map((item, index) => ({ id: item.id, title: item.title, questionCount: item.questions.length, unlocked: index === 0 || !!progress.levels[system.levels[index - 1].id]?.testPassed })),
    }, { signal: lifecycle.signal })).catch(report);
    void Promise.resolve(context.registerTool({
      name: "start_bridge_lesson", title: "Spustit bridžovou lekci",
      description: "Otevře trénink vybrané kapitoly podle jejího ID.",
      inputSchema: { type: "object", properties: { levelId: { type: "string" } }, required: ["levelId"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => { const levelId = (input as { levelId?: string }).levelId; const selected = system.levels.find((item) => item.id === levelId); if (!selected) throw new Error("Kapitola neexistuje."); begin(selected, "lesson"); return { started: true, levelId: selected.id, questionCount: selected.questions.length }; },
    }, { signal: lifecycle.signal })).catch(report);
    return () => lifecycle.abort();
  }, [system, progress.levels]);

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setView("levels")} aria-label="Přejít na přehled lekcí"><span className="brand-mark"><span>♣</span><span>♦</span><span>♥</span><span>♠</span></span><span><strong>HABRA</strong><small>{content.title}</small></span></button>
      <div className="top-actions"><button className="nav-button" onClick={() => setView("stats")}><BarChart3 size={18}/><span>Výsledky</span></button><button className="nav-button" onClick={() => setAdminOpen(true)}><Settings2 size={18}/><span>Správa obsahu</span></button></div>
    </header>
    <main className="main">
      {!contentReady && <div role="status" className="content-notice">{contentError || "Načítám aktuální obsah…"}{contentError && <button className="button button-secondary" onClick={() => window.location.reload()}>Načíst znovu</button>}</div>}
      {contentReady && view === "levels" && <>
        <section className="academy-head"><div><p className="eyebrow">Tréninkový plán</p><h1>Lepší levná, krok za krokem.</h1><p>Nejdřív si projdi příklady s vysvětlením. Potom ověř systém v testu a odemkni další kapitolu.</p></div><div className="progress-orbit" aria-label={`${completed} z ${system.levels.length} úrovní dokončeno`}><strong>{completed}<span>/{system.levels.length}</span></strong><small>dokončeno</small></div></section>
        <div className="system-row"><div><span className="status-dot"/> Aktivní systém</div><strong>{system.name}</strong><span>{system.levels.length} kapitoly · {system.levels.reduce((sum, item) => sum + item.questions.length, 0)} úloh</span></div>
        <section className="level-list" aria-label="Kapitoly systému">{system.levels.map((item, index) => {
          const unlocked = unlockedIds.has(item.id); const state = progress.levels[item.id] || { lessonCompleted:false, testPassed:false, bestScore:0 };
          return <article key={item.id} className={`level-card ${!unlocked ? "is-locked" : ""}`}><div className="level-number">{String(index + 1).padStart(2,"0")}</div><div className="level-copy"><div className="level-kicker">{state.testPassed ? "Zvládnuto" : state.lessonCompleted ? "Připraveno na test" : unlocked ? "Odemčeno" : "Zamčeno"}</div><h2>{item.title}</h2><p>{item.description}</p><div className="level-meta"><span><BookOpen size={15}/> {item.questions.length} úloh</span><span><ShieldCheck size={15}/> test od {item.passingPercent} %</span></div></div><div className="level-actions">{unlocked ? <><button className="button button-primary" onClick={() => begin(item,"lesson")}><Play size={16}/> {state.lessonCompleted ? "Procvičit znovu" : "Začít trénink"}</button><button className="button button-secondary" disabled={!state.lessonCompleted} onClick={() => begin(item,"test")}>Test {state.bestScore ? `· ${state.bestScore} %` : ""}<ChevronRight size={16}/></button></> : <div className="locked-label"><LockKeyhole size={18}/> Dokonči předchozí kapitolu</div>}</div></article>;
        })}</section>
      </>}

      {view === "quiz" && currentQuestion && level && <section className="quiz-wrap">
        <div className="quiz-topline"><button className="text-button" onClick={() => setView("levels")}>← Ukončit</button><span>{mode === "lesson" ? "Trénink" : "Test"} · {level.title}</span><strong>{questionIndex + 1}/{questions.length}</strong></div>
        <div className="progress-track"><span style={{width:`${((questionIndex + (answer ? 1 : 0))/questions.length)*100}%`}}/></div>
        <QuestionCard question={currentQuestion} answer={answer} onChoose={choose} onNext={next} nextLabel={questionIndex + 1 === questions.length ? "Zobrazit výsledek" : "Další úloha"}/>
      </section>}

      {view === "summary" && level && <section className="summary-card"><div className={`summary-icon ${summary.passed ? "pass":"fail"}`}><Trophy size={34}/></div><p className="eyebrow">{mode === "lesson" ? "Trénink dokončen" : summary.passed ? "Test splněn":"Ještě jednou"}</p><h1>{summary.percent} %</h1><p>{mode === "lesson" ? "Prošel jsi celou kapitolu. Teď můžeš pokračovat do testu." : summary.passed ? "Skvělá práce. Další kapitola je odemčená." : `K úspěchu potřebuješ alespoň ${level.passingPercent} %.`}</p><div><button className="button button-primary" onClick={()=>begin(level,mode)}>Zkusit znovu</button><button className="button button-secondary" onClick={()=>setView("levels")}>Zpět ke kapitolám</button></div></section>}

      {view === "stats" && <section><div className="page-heading"><div><p className="eyebrow">Tvůj postup</p><h1>Výsledky</h1></div><button className="button button-secondary" onClick={()=>setView("levels")}>Zpět ke kapitolám</button></div><div className="stat-grid"><div><span>Vyřešené úlohy</span><strong>{progress.answered}</strong></div><div><span>Správně</span><strong>{progress.correct}</strong></div><div><span>Úspěšnost</span><strong>{accuracy} %</strong></div><div><span>Složené testy</span><strong>{completed}</strong></div></div><div className="result-list">{system.levels.map((item,index)=>{ const state=progress.levels[item.id]; return <div key={item.id}><span>{index+1}</span><div><strong>{item.title}</strong><small>{state?.lessonCompleted ? "Trénink hotov":"Trénink čeká"} · {state?.testPassed ? "test splněn":"test nesplněn"}</small></div><b>{state?.bestScore||0} %</b></div>; })}</div></section>}
    </main>
    <footer>{content.academyName}<span>•</span> Lepší levná</footer>
    {adminOpen && <AdminPanel open={adminOpen} onOpenChange={setAdminOpen} content={content} onSaved={setContent}/>}
  </div>;
}
