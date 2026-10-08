"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, BookOpen, ChevronRight, LockKeyhole, Play, Settings2, ShieldCheck, Trophy, UserRound } from "lucide-react";
import AdminPanel from "./admin-panel";
import { QuestionCard } from "./question-card";
import { emptyProgress, recordAnswer, shuffle, passesTest, completeLevel, scorePercent } from "./progress";
import type { ProgressState } from "./progress";
import { useProgress } from "./use-progress";
import { AccountPanel, useAccount } from "./account";
import { allLevelQuestions, testPool } from "./content-validation";
import { matchesSearch } from "./search";

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
  const { state: account } = useAccount();
  if (!initialContent.systems.length) return <LockedTrainer content={initialContent}/>;
  return <TrainerSession key={account.user?.id || "guest"} initialContent={initialContent}/>;
}
function LockedTrainer({ content }: { content: TrainerContent }) {
  const { state } = useAccount(); const [open, setOpen] = useState(false);
  return <main className="main"><h1>{content.title}</h1><div className="empty-state"><h2>Žádný dostupný systém</h2><p>{state.user ? "Požádej správce o přístup k systému." : "Pro přístup k uzamčeným systémům se přihlas."}</p><button className="button button-primary" onClick={() => setOpen(true)}>{state.user ? "Můj účet" : "Přihlásit se"}</button></div><LockedSystems content={content}/>{open && <AccountPanel open={open} onOpenChange={setOpen}/>}</main>;
}
function LockedSystems({ content }: { content: TrainerContent }) { return content.lockedSystems?.length ? <section className="empty-state"><h2>Uzamčené systémy</h2><p>Přístup může povolit správce aplikace.</p><ul>{content.lockedSystems.map(item => <li key={item.id}><LockKeyhole size={16}/> {item.name}</li>)}</ul></section> : null; }
function TrainerSession({ initialContent }: { initialContent: TrainerContent }) {
  const { enabled: backend, state: account } = useAccount();
  const content = initialContent;
  const [accountOpen, setAccountOpen] = useState(false);
  const canEdit = !backend || account.user?.role === "editor" || account.user?.role === "admin";
  const [adminOpen, setAdminOpen] = useState(false);
  const [chapterSearch, setChapterSearch] = useState("");
  const [chapterFilter, setChapterFilter] = useState<"all" | "available" | "unfinished" | "mistakes">("all");
  const [quizActive, setQuizActive] = useState(false);
  const storageKey = `habra-progress-pages-v2:${location.pathname}${account.user ? `:user:${account.user.id}` : ""}`;
  const { store, update: updateStore, loaded: progressLoaded, warning: storageWarning } = useProgress(content.systems[0].id, storageKey);
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const system = content.systems.find(item => item.id === (selectedSystemId ?? store.selectedSystemId)) || content.systems[0];
  const progress = store.systems[system.id] || emptyProgress();
  const answeredRef = useRef(false);
  function setProgress(update: (current: ProgressState) => ProgressState) {
    updateStore(current => ({ ...current, systems: { ...current.systems, [system.id]: update(current.systems[system.id] || emptyProgress()) } }));
  }
  function selectSystem(id: string) {
    if (quizActive && !window.confirm("Změnou systému ukončíš rozpracovaný trénink. Zaznamenané odpovědi zůstanou uložené. Pokračovat?")) return;
    setQuizActive(false);
    setChapterFilter("all");
    setChapterSearch("");
    setSelectedSystemId(id);
    updateStore(current => ({ ...current, selectedSystemId: id }));
    setLevel(null); setAnswer(null); setView("levels");
  }
  const [view, setView] = useState<View>("levels");
  const [level, setLevel] = useState<TrainerLevel | null>(null);
  const [mode, setMode] = useState<"lesson" | "test" | "review">("lesson");
  const [questions, setQuestions] = useState<TrainerQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [answer, setAnswer] = useState<{ correct: boolean; selected: string } | null>(null);
  const [summary, setSummary] = useState({ percent: 0, passed: false, correct: 0, total: 0 });

  const completed = system.levels.filter(item => progress.levels[item.id]?.testPassed).length;
  const currentQuestion = questions[questionIndex];
  const accuracy = progress.answered ? Math.round((progress.correct / progress.answered) * 100) : 0;
  const unlockedIds = useMemo(() => {
    const ids = new Set<string>();
    system.levels.forEach((item, index) => { if (index === 0 || progress.levels[system.levels[index - 1].id]?.testPassed) ids.add(item.id); });
    return ids;
  }, [progress.levels, system.levels]);

  const mistakeCount = (item: TrainerLevel) => allLevelQuestions(item).filter(q => progress.mistakes[item.id]?.includes(q.id)).length;
  const totalMistakes = system.levels.reduce((sum, item) => sum + mistakeCount(item), 0);
  const trained = system.levels.filter(item => progress.levels[item.id]?.lessonCompleted).length;
  const recommended = system.levels.find(item => unlockedIds.has(item.id) && !progress.levels[item.id]?.testPassed);
  const nextChapter = level ? system.levels[system.levels.findIndex(item => item.id === level.id) + 1] : undefined;
  const visibleLevels = system.levels.map((item, index) => ({ item, index })).filter(({ item }) =>
    matchesSearch(`${item.title} ${item.description}`, chapterSearch) &&
    (chapterFilter === "all" || (chapterFilter === "available" && unlockedIds.has(item.id)) ||
      (chapterFilter === "unfinished" && !progress.levels[item.id]?.testPassed) ||
      (chapterFilter === "mistakes" && mistakeCount(item) > 0)));

  function resume() { setView("quiz"); window.scrollTo({ top: 0 }); }

  function begin(selectedLevel: TrainerLevel, selectedMode: "lesson" | "test" | "review") {
    if (!progressLoaded || !selectedLevel.questions.length) return;
    if (!unlockedIds.has(selectedLevel.id) || (selectedMode === "test" && selectedLevel.test?.requireLesson !== false && !progress.levels[selectedLevel.id]?.lessonCompleted)) return;
    const selectedQuestions = selectedMode === "review" ? allLevelQuestions(selectedLevel).filter(q => progress.mistakes[selectedLevel.id]?.includes(q.id)) : selectedMode === "test" ? testPool(selectedLevel) : selectedLevel.questions;
    if (!selectedQuestions.length) return;
    if (quizActive) {
      if (level?.id === selectedLevel.id && mode === selectedMode) { resume(); return; }
      if (!window.confirm("Začít nový pokus a ukončit rozpracovaný trénink? Zaznamenané odpovědi zůstanou uložené.")) return;
    }
    setQuizActive(true);
    setLevel(selectedLevel); setMode(selectedMode);
    const ordered = selectedMode === "test" && selectedLevel.test?.shuffle !== false ? shuffle(selectedQuestions) : selectedQuestions;
    setQuestions(selectedMode === "test" && selectedLevel.test?.questionCount ? ordered.slice(0, selectedLevel.test.questionCount) : ordered);
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
    const percent = scorePercent(score, questions.length);
    const passed = mode === "lesson" || (mode === "review" ? score === questions.length : passesTest(score, questions.length, level.passingPercent));
    setProgress(current => completeLevel(current, level.id, mode, score, questions.length, level.passingPercent));
    setQuizActive(false);
    setSummary({ percent, passed, correct: score, total: questions.length }); setView("summary");
  }

  function next() { if (questionIndex + 1 < questions.length) { setQuestionIndex((current) => current + 1); setAnswer(null); answeredRef.current = false; window.scrollTo({ top: 0 }); } else { finish(); window.scrollTo({ top: 0 }); } }

  useEffect(() => {
    if (!quizActive) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [quizActive]);

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
  }, [system, progress.levels, progressLoaded, quizActive, level, mode]);

  return <div className="app-shell">
    <a className="skip-link" href="#training-main">Přejít k obsahu</a>
    <header className="topbar">
      <button className="brand" onClick={() => setView("levels")} aria-label="Přejít na přehled lekcí"><span className="brand-mark"><span>♣</span><span>♦</span><span>♥</span><span>♠</span></span><span><strong>HABRA</strong><small>{content.title}</small></span></button>
      <div className="top-actions"><button className="nav-button" aria-label="Výsledky" onClick={() => setView("stats")}><BarChart3 size={18}/><span>Výsledky</span></button>{canEdit && <button className="nav-button" aria-label="Správa obsahu" onClick={() => setAdminOpen(true)}><Settings2 size={18}/><span>Správa obsahu</span></button>}{backend && <button className="nav-button" aria-label={account.user ? "Můj účet" : "Přihlásit se"} onClick={() => setAccountOpen(true)}><UserRound size={18}/><span>{account.user ? "Můj účet" : "Přihlásit se"}</span></button>}{!backend && <a className="nav-button" aria-label="Přihlásit se" href="https://habra-editor.drozdmatej09.workers.dev"><UserRound size={18}/><span>Přihlásit se</span></a>}</div>
    </header>
    <main id="training-main" tabIndex={-1} className="main">
      {storageWarning && <p className="storage-warning" role="status">{storageWarning}</p>}
      {(view === "levels" || view === "stats") && <section className="system-picker" aria-label="Výběr dražebního systému">
        <label htmlFor="training-system">Dražební systém</label>
        <select id="training-system" value={system.id} onChange={event => selectSystem(event.target.value)} disabled={!progressLoaded}>
          {content.systems.map(item => <option key={item.id} value={item.id}>{item.name}{item.difficulty ? ` · ${difficultyLabels[item.difficulty]}` : ""}</option>)}
        </select>
        <p>Postup i chyby se ukládají pro každý systém zvlášť v tomto prohlížeči.</p>
      </section>}
      {view === "levels" && <>
        <section className="academy-head"><div><p className="eyebrow">Tréninkový plán</p><h1>{system.name}, krok za krokem.</h1><p>Nejdřív si projdi příklady s vysvětlením. Potom ověř systém v testu a odemkni další kapitolu.</p></div></section>
        <section className="learning-dashboard" aria-label="Přehled postupu">
          <div className="learning-progress">
            <p className="eyebrow">Tvůj postup v systému</p>
            <div className="progress-count"><strong>{completed}<span> / {system.levels.length}</span></strong><span>splněných kapitol</span></div>
            <progress className="system-progress" value={completed} max={system.levels.length} aria-label="Splněné kapitoly"/>
            <p>Kapitola je splněná po úspěšném testu.</p>
            <div className="learning-metrics"><span><BookOpen size={16}/>Hotové tréninky: {trained}</span><button className="text-button" onClick={() => setChapterFilter("mistakes")}>K zopakování: {totalMistakes} úloh</button></div>
          </div>
          <div className="next-step">
            <p className="eyebrow">{quizActive ? "Rozpracovaný pokus" : recommended ? "Doporučený další krok" : "Systém dokončen"}</p>
            <h2>{quizActive && level ? level.title : recommended?.title || "Všechny testy máš splněné"}</h2>
            <p>{quizActive ? `Úloha ${questionIndex + 1} z ${questions.length}. Pokus zůstane rozpracovaný, dokud stránku nezavřeš nebo neobnovíš.` : recommended ? progress.levels[recommended.id]?.lessonCompleted ? `Trénink je hotový. V testu potřebuješ alespoň ${recommended.passingPercent} %.` : `${recommended.questions.length} úloh s vysvětlením. Potom následuje test.` : totalMistakes ? "Vrať se k úlohám, ve kterých jsi chyboval." : "Upevni si dražbu opakováním nebo si vyber další systém."}</p>
            {quizActive ? <button className="button button-primary" onClick={resume}><Play size={16}/>Pokračovat v pokusu</button> : recommended ? <button className="button button-primary" disabled={!progressLoaded} onClick={() => begin(recommended, progress.levels[recommended.id]?.lessonCompleted ? "test" : "lesson")}><Play size={16}/>{progress.levels[recommended.id]?.lessonCompleted ? "Spustit navazující test" : progress.answered ? "Pokračovat v tréninku" : "Začít první lekci"}</button> : <button className="button button-primary" onClick={() => setChapterFilter(totalMistakes ? "mistakes" : "all")}>Prohlédnout {totalMistakes ? "chyby" : "kapitoly"}</button>}
          </div>
        </section>
        {system.difficulty && <span className="difficulty-badge">{difficultyLabels[system.difficulty]}</span>}
        {system.description && <p className="system-description">{system.description}</p>}
        {!!system.rules?.length && <details className="system-rules"><summary>Pravidla systému {system.name}</summary><ul>{system.rules.map(rule => <li key={rule}>{rule}</li>)}</ul><p>Ve sledech se střídají tvoje a partnerovy hlášky; soupeři pasují. Lekce nepokrývají celý systém.</p>{!!system.sources?.length && <>{system.difficulty !== "beginner" && <p>FB = figurové body · M = drahá · m = levná · bal = vyrovnaná ruka · F = forsing · GF = forsing do hry · INV = výzva · TRF = transfer · NF = neforsující · S/T = slemový pokus · M4 = drahý čtyřlist</p>}<strong>Podklady</strong><ul>{system.sources.map(source => <li key={source}>{source}</li>)}</ul></>}</details>}
        <div className="system-row"><div><span className="status-dot"/> Aktivní systém</div><strong>{system.name}</strong><span>Kapitoly: {system.levels.length} · Úlohy: {system.levels.reduce((sum, item) => sum + item.questions.length, 0)}</span></div>
        <div className="chapter-search"><label htmlFor="chapter-search">Hledat kapitolu<input id="chapter-search" type="search" value={chapterSearch} onChange={event => setChapterSearch(event.target.value)} placeholder="Název nebo téma kapitoly"/></label><p aria-live="polite">Zobrazeno {visibleLevels.length} z {system.levels.length} kapitol</p></div>
        <div className="chapter-filters" role="group" aria-label="Filtrovat kapitoly">{([ ["all", "Všechny"], ["available", "Odemčené"], ["unfinished", "Nedokončené"], ["mistakes", "S chybami"] ] as const).map(([value, label]) => <button key={value} aria-pressed={chapterFilter === value} onClick={() => setChapterFilter(value)}>{label}</button>)}</div>
        {!visibleLevels.length && <div className="empty-state"><h2>{chapterFilter === "mistakes" && !chapterSearch ? "Žádné chyby k procvičení" : "Žádná odpovídající kapitola"}</h2><p>{chapterFilter === "mistakes" && !chapterSearch ? "Úlohy s chybnou odpovědí se objeví tady. Správným řešením je ze seznamu odstraníš." : "Zkus jiné téma nebo zobraz všechny kapitoly."}</p><button className="text-button" onClick={() => { setChapterSearch(""); setChapterFilter("all"); }}>Vymazat hledání</button></div>}
        <section className="level-list" aria-label="Kapitoly systému">{visibleLevels.map(({ item, index }) => {
          const unlocked = unlockedIds.has(item.id); const state = progress.levels[item.id] || { lessonCompleted:false, testPassed:false, bestScore:0, testAttempted:false };
          return <article key={item.id} className={`level-card ${!unlocked ? "is-locked" : ""} ${state.testPassed ? "is-completed" : ""}`}><div className="level-number">{String(index + 1).padStart(2,"0")}</div><div className="level-copy"><div className="level-kicker">{state.testPassed ? "Zvládnuto" : state.lessonCompleted ? "Připraveno na test" : unlocked ? "Odemčeno" : "Zamčeno"}</div><h2>{item.title}</h2><p>{item.description}</p><div className="level-meta"><span><BookOpen size={15}/> {item.questions.length} úloh</span><span><ShieldCheck size={15}/> test: {item.test?.questionCount || testPool(item).length} úloh · od {item.passingPercent} %</span></div></div><div className="level-actions">{unlocked ? <><button className="button button-primary" disabled={!progressLoaded} onClick={() => begin(item,"lesson")}><Play size={16}/> {state.lessonCompleted ? "Procvičit znovu" : "Začít trénink"}</button><button className="button button-secondary" title={!state.lessonCompleted && item.test?.requireLesson !== false ? "Nejdřív projdi celý trénink této kapitoly." : undefined} disabled={!state.lessonCompleted && item.test?.requireLesson !== false} onClick={() => begin(item,"test")}>Test {(state.testAttempted || state.bestScore) ? `· ${state.bestScore} %` : ""}<ChevronRight size={16}/></button>{allLevelQuestions(item).some(q => progress.mistakes[item.id]?.includes(q.id)) && <button className="button button-secondary" onClick={() => begin(item,"review")}>Procvičit chyby ({allLevelQuestions(item).filter(q => progress.mistakes[item.id]?.includes(q.id)).length})</button>}</> : <div className="locked-label"><LockKeyhole size={18}/> Dokonči předchozí kapitolu</div>}</div></article>;
        })}</section>
        <LockedSystems content={content}/>
      </>}

      {view === "quiz" && currentQuestion && level && <section className="quiz-wrap">
        <div className="quiz-topline"><button className="text-button" onClick={() => setView("levels")}>← Pozastavit</button><span>{mode === "lesson" ? "Trénink" : mode === "review" ? "Opakování chyb" : "Test"} · {level.title}</span><strong>{questionIndex + 1}/{questions.length}</strong></div>
        <div className="progress-track" role="progressbar" aria-label="Vyřešené úlohy v pokusu" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={questionIndex + (answer ? 1 : 0)}><span style={{width:`${((questionIndex + (answer ? 1 : 0))/questions.length)*100}%`}}/></div>
        <p className="quiz-context">{mode === "test" ? `Pro splnění testu potřebuješ ${level.passingPercent} %.` : mode === "review" ? "Správnou odpovědí odstraníš úlohu ze seznamu chyb." : "Po každé odpovědi si přečti vysvětlení dražby."}</p>
        <QuestionCard key={currentQuestion.id} question={currentQuestion} answer={answer} onChoose={choose} onNext={next} nextLabel={questionIndex + 1 === questions.length ? "Zobrazit výsledek" : "Další úloha"}/>
      </section>}

      {view === "summary" && level && <section className="summary-card"><div className={`summary-icon ${summary.passed ? "pass":"fail"}`}><Trophy size={34}/></div><p className="eyebrow">{mode === "review" ? "Opakování dokončeno" : mode === "lesson" ? "Trénink dokončen" : summary.passed ? "Test splněn":"Ještě jednou"}</p><h1>{summary.percent} %</h1><p>{summary.correct} z {summary.total} správně</p><p>{mode === "review" ? "Správně vyřešené úlohy byly odebrány ze seznamu chyb. Opakování nemění výsledek testu ani odemčení kapitol." : mode === "lesson" ? "Prošel jsi celou kapitolu. Teď můžeš pokračovat do testu." : summary.passed ? nextChapter ? "Další kapitola je odemčená." : "Máš splněné všechny testy tohoto systému." : `K úspěchu potřebuješ alespoň ${level.passingPercent} %.`}</p><div>{mode === "lesson" && <button className="button button-primary" onClick={() => begin(level,"test")}>Spustit test<ChevronRight size={16}/></button>}{mode === "test" && summary.passed && nextChapter && <button className="button button-primary" onClick={() => begin(nextChapter,"lesson")}>Další kapitola<ChevronRight size={16}/></button>}{mode !== "review" && mistakeCount(level) > 0 && <button className="button button-secondary" onClick={() => begin(level,"review")}>Procvičit chyby ({mistakeCount(level)})</button>}<button className="button button-secondary" onClick={()=>begin(level,mode)} disabled={mode === "review" && !allLevelQuestions(level).some(q => progress.mistakes[level.id]?.includes(q.id))}>Zkusit znovu</button><button className="button button-secondary" onClick={()=>setView("levels")}>Zpět ke kapitolám</button></div></section>}

      {view === "stats" && <section><div className="page-heading"><div><p className="eyebrow">Tvůj postup</p><h1>Výsledky · {system.name}</h1></div><button className="button button-secondary" onClick={()=>setView("levels")}>Zpět ke kapitolám</button></div><div className="stat-grid"><div><span>Vyřešené úlohy</span><strong>{progress.answered}</strong></div><div><span>Správně</span><strong>{progress.correct}</strong></div><div><span>Úspěšnost</span><strong>{progress.answered ? `${accuracy} %` : "—"}</strong></div><div><span>Složené testy</span><strong>{completed} / {system.levels.length}</strong></div></div><p className="stats-note">Úspěšnost zahrnuje všechny odpovědi včetně opakování. U kapitol je uveden nejlepší výsledek testu. Postup je uložený v tomto prohlížeči.</p>{!progress.answered && <div className="empty-state"><h2>Tvůj první trénink teprve začíná</h2><p>Vyber kapitolu a první odpovědi se objeví v přehledu.</p><button className="button button-primary" onClick={() => setView("levels")}>Vybrat kapitolu</button></div>}<div className="result-list">{system.levels.map((item,index)=>{ const state=progress.levels[item.id]; return <div key={item.id}><span>{index+1}</span><div><strong>{item.title}</strong><small>{state?.lessonCompleted ? "Trénink hotov":"Trénink čeká"} · {state?.testPassed ? "test splněn":state?.testAttempted || state?.bestScore ? "test zatím nesplněn" : "test čeká"}</small></div><div><b>{state?.testAttempted || state?.bestScore || state?.testPassed ? `${state.bestScore} %` : "—"}</b>{allLevelQuestions(item).some(q => progress.mistakes[item.id]?.includes(q.id)) && <button className="text-button" onClick={() => begin(item,"review")}>Procvičit chyby ({allLevelQuestions(item).filter(q => progress.mistakes[item.id]?.includes(q.id)).length})</button>}</div></div>; })}</div></section>}
    </main>
    <footer>{content.academyName}<span>•</span> {system.name}</footer>
    {adminOpen && canEdit && <AdminPanel open={adminOpen} onOpenChange={setAdminOpen} content={content}/>}
    {accountOpen && <AccountPanel open={accountOpen} onOpenChange={setAccountOpen}/>}
  </div>;
}
