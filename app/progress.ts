import type { TrainerLevel, TrainerQuestion, TrainerSystem } from "./types";
import { z } from "zod";

const count = z.number().int().nonnegative().max(1_000_000_000);
const progressId = z.string().min(1).max(200).refine(value => !Object.hasOwn(Object.prototype, value) && value !== "prototype");
const questionStateSchema = z.object({ attempts: count, errors: count, lastAnswered: z.number().int().min(0).max(4_102_444_800_000), lastCorrect: z.boolean(), streak: count, dueAt: z.number().int().min(0).max(4_102_444_800_000) }).refine(q => q.errors <= q.attempts);
export type QuestionState = z.infer<typeof questionStateSchema>;
const progressSchema = z.object({
  levels: z.record(progressId, z.object({ lessonCompleted: z.boolean(), testPassed: z.boolean(), bestScore: z.number().min(0).max(100), testAttempted: z.boolean().optional() })),
  answered: count,
  correct: count,
  mistakes: z.record(progressId, z.array(progressId).max(4000)).default({}),
  questionStats: z.record(progressId, z.record(progressId, questionStateSchema)).optional(),
}).refine(p => p.correct <= p.answered);
export type ProgressState = z.infer<typeof progressSchema>;
export type ProgressStore = { selectedSystemId: string; systems: Record<string, ProgressState> };
export const progressStoreSchema = z.object({ selectedSystemId: progressId, systems: z.record(progressId, progressSchema) });
const storeSchema = progressStoreSchema;
export type ProgressStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
export const emptyProgress = (): ProgressState => ({ levels: {}, answered: 0, correct: 0, mistakes: {} });

export function restoreProgress(saved: string | null, legacy: string | null, firstSystemId: string): ProgressStore {
  const initial = { selectedSystemId: firstSystemId, systems: {} };
  try {
    if (saved) return storeSchema.parse(JSON.parse(saved));
  } catch { /* Invalid storage must not prevent training. Try the legacy backup. */ }
  try {
    if (legacy) return { ...initial, systems: { [firstSystemId]: progressSchema.parse(JSON.parse(legacy)) } };
  } catch { /* Start fresh if the legacy backup is also invalid. */ }
  return initial;
}

export function readStoredProgress(storage: ProgressStorage, key: string, firstSystemId: string): { store: ProgressStore; damaged: boolean } {
  const saved = storage.getItem(key);
  let damaged = false;
  if (saved !== null) {
    try { damaged = !storeSchema.safeParse(JSON.parse(saved)).success; }
    catch { damaged = true; }
  }
  return { store: restoreProgress(saved, storage.getItem(key.replace("-v2:", "-v1:")), firstSystemId), damaged };
}

export function updateStoredProgress(storage: ProgressStorage, key: string, firstSystemId: string, update: (store: ProgressStore) => ProgressStore): ProgressStore {
  const { store, damaged } = readStoredProgress(storage, key, firstSystemId);
  if (damaged) {
    const raw = storage.getItem(key)!;
    let backupKey = `${key}:damaged`;
    // Keep earlier recovery copies too; never replace a previous backup.
    for (let suffix = 1; storage.getItem(backupKey) !== null; suffix++) backupKey = `${key}:damaged:${suffix}`;
    storage.setItem(backupKey, raw);
  }
  const next = update(store);
  storage.setItem(key, JSON.stringify(next));
  return next;
}

export function recordAnswer(progress: ProgressState, levelId: string, questionId: string, correct: boolean, time = Date.now()): ProgressState {
  const mistakes = new Set(progress.mistakes[levelId] || []);
  if (correct) mistakes.delete(questionId); else mistakes.add(questionId);
  const previous = progress.questionStats?.[levelId]?.[questionId];
  const timestamp = Math.max(time, (previous?.lastAnswered || 0) + 1);
  const streak = correct ? (previous?.streak || 0) + 1 : 0;
  const days = [0, 1, 3, 7, 14, 30][Math.min(streak, 5)];
  const state: QuestionState = { attempts: (previous?.attempts || 0) + 1, errors: (previous?.errors || 0) + Number(!correct), lastAnswered: timestamp, lastCorrect: correct, streak, dueAt: timestamp + days * 86_400_000 };
  return { ...progress, answered: progress.answered + 1, correct: progress.correct + Number(correct),
    questionStats: { ...progress.questionStats, [levelId]: { ...progress.questionStats?.[levelId], [questionId]: state } },
    mistakes: { ...progress.mistakes, [levelId]: [...mistakes] } };
}

export function shuffle<T>(items: T[], random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function passesTest(score: number, total: number, passingPercent: number): boolean {
  return total > 0 && score * 100 >= total * passingPercent;
}

export function scorePercent(score: number, total: number): number {
  return total > 0 ? Math.round(score / total * 10000) / 100 : 0;
}

export function completeLevel(progress: ProgressState, levelId: string, mode: "lesson" | "test" | "review", score: number, total: number, passingPercent: number): ProgressState {
  if (mode === "review" || !total) return progress;
  const previous = progress.levels[levelId] || { lessonCompleted: false, testPassed: false, bestScore: 0 };
  return { ...progress, levels: { ...progress.levels, [levelId]: {
    lessonCompleted: previous.lessonCompleted || mode === "lesson",
    testPassed: previous.testPassed || (mode === "test" && passesTest(score, total, passingPercent)),
    testAttempted: previous.testAttempted || mode === "test",
    bestScore: mode === "test" ? Math.max(previous.bestScore, scorePercent(score, total)) : previous.bestScore,
  } } };
}

export type PracticeExample = { level: TrainerLevel; question: TrainerQuestion };
export function practicePool(system: TrainerSystem, unlockedIds?: ReadonlySet<string>): PracticeExample[] {
  if (system.status !== "active") return [];
  return system.levels.filter(level => level.status !== "draft" && (!unlockedIds || unlockedIds.has(level.id)))
    .flatMap(level => level.questions.map(question => ({ level, question })));
}
export function randomExamples(pool: PracticeExample[], count: number | "all", random = Math.random): PracticeExample[] {
  const shuffled = shuffle(pool, random);
  return count === "all" ? shuffled : shuffled.slice(0, Math.max(0, Math.floor(count)));
}


export type ProgressReplica = { deviceId: string; revision: number; store: ProgressStore };
export const replicaSchema = z.object({ deviceId: z.string().uuid(), revision: count, store: progressStoreSchema });
export function mergeLevelStates(a: ProgressState["levels"], b: ProgressState["levels"]): ProgressState["levels"] {
  const result = { ...a };
  for (const [id, state] of Object.entries(b)) {
    const old = result[id];
    result[id] = { lessonCompleted: !!old?.lessonCompleted || state.lessonCompleted, testPassed: !!old?.testPassed || state.testPassed, bestScore: Math.max(old?.bestScore || 0, state.bestScore), testAttempted: !!old?.testAttempted || !!state.testAttempted || !!old?.bestScore || !!state.bestScore || state.testPassed };
  }
  return result;
}
function questionStates(progress: ProgressState): NonNullable<ProgressState["questionStats"]> {
  const result = Object.fromEntries(Object.entries(progress.questionStats || {}).map(([level, questions]) => [level, { ...questions }]));
  for (const [level, ids] of Object.entries(progress.mistakes)) for (const id of ids) {
    result[level] ||= {};
    result[level][id] ||= { attempts: 0, errors: 0, lastAnswered: 0, lastCorrect: false, streak: 0, dueAt: 0 };
  }
  return result;
}
function mergeQuestions(a: ProgressState, b: ProgressState, sum: boolean) {
  const result = questionStates(a);
  for (const [level, questions] of Object.entries(questionStates(b))) {
    result[level] ||= {};
    for (const [id, state] of Object.entries(questions)) {
      const old = result[level][id];
      const latest = !old || state.lastAnswered >= old.lastAnswered ? state : old;
      result[level][id] = { ...latest, attempts: sum ? (old?.attempts || 0) + state.attempts : Math.max(old?.attempts || 0, state.attempts), errors: sum ? (old?.errors || 0) + state.errors : Math.max(old?.errors || 0, state.errors) };
    }
  }
  return result;
}
function mergeProgress(a: ProgressState, b: ProgressState, sum: boolean): ProgressState {
  const stats = mergeQuestions(a, b, sum);
  const mistakes: ProgressState["mistakes"] = {};
  for (const level of new Set([...Object.keys(a.mistakes), ...Object.keys(b.mistakes), ...Object.keys(stats)])) mistakes[level] = Object.entries(stats[level] || {}).filter(([, state]) => !state.lastCorrect).map(([id]) => id);
  return { levels: mergeLevelStates(a.levels, b.levels), answered: sum ? a.answered + b.answered : Math.max(a.answered, b.answered), correct: sum ? a.correct + b.correct : Math.max(a.correct, b.correct), mistakes, questionStats: stats };
}
// The same device stores cumulative counters: retries and stale uploads use max,
// while independent devices are added once, keyed by their stable replica ID.
export function mergeSameReplica(a: ProgressStore, b: ProgressStore): ProgressStore {
  const systems = { ...a.systems };
  for (const [id, progress] of Object.entries(b.systems)) systems[id] = mergeProgress(systems[id] || emptyProgress(), progress, false);
  return { selectedSystemId: b.selectedSystemId, systems };
}
export function aggregateReplicas(replicas: ProgressReplica[], selectedSystemId: string): ProgressStore {
  const unique = new Map<string, ProgressReplica>();
  for (const replica of replicas) {
    const old = unique.get(replica.deviceId);
    unique.set(replica.deviceId, old ? { deviceId: replica.deviceId, revision: Math.max(old.revision, replica.revision), store: mergeSameReplica(old.store, replica.store) } : replica);
  }
  const systems: ProgressStore["systems"] = {};
  for (const replica of [...unique.values()].sort((a, b) => a.deviceId.localeCompare(b.deviceId))) for (const [id, progress] of Object.entries(replica.store.systems)) systems[id] = mergeProgress(systems[id] || emptyProgress(), progress, true);
  return { selectedSystemId, systems };
}
export function advanceReplica(own: ProgressStore, before: ProgressStore, after: ProgressStore): ProgressStore {
  const systems = { ...own.systems };
  for (const [system, changed] of Object.entries(after.systems)) {
    const old = before.systems[system] || emptyProgress();
    const local = systems[system] || emptyProgress();
    const stats = questionStates(local);
    const mistakes = { ...local.mistakes };
    for (const [level, questions] of Object.entries(changed.questionStats || {})) for (const [id, state] of Object.entries(questions)) {
      const previous = old.questionStats?.[level]?.[id];
      const attempts = state.attempts - (previous?.attempts || 0);
      if (attempts <= 0) continue;
      stats[level] ||= {};
      const ownState = stats[level][id];
      stats[level][id] = { ...state, attempts: (ownState?.attempts || 0) + attempts, errors: (ownState?.errors || 0) + Math.max(0, state.errors - (previous?.errors || 0)) };
      const ids = new Set(mistakes[level] || []);
      if (state.lastCorrect) ids.delete(id); else ids.add(id);
      mistakes[level] = [...ids];
    }
    systems[system] = { ...local, levels: mergeLevelStates(local.levels, changed.levels), answered: local.answered + Math.max(0, changed.answered - old.answered), correct: local.correct + Math.max(0, changed.correct - old.correct), mistakes, questionStats: stats };
  }
  return { selectedSystemId: after.selectedSystemId, systems };
}
export function smartExamples(pool: PracticeExample[], progress: ProgressState, count: number | "all", time = Date.now(), random = Math.random): PracticeExample[] {
  const ranked = shuffle(pool, random).sort((a, b) => {
    const rank = ({ level, question }: PracticeExample) => {
      const state = progress.questionStats?.[level.id]?.[question.id];
      const wrong = progress.mistakes[level.id]?.includes(question.id);
      return { group: wrong ? 0 : state && state.dueAt <= time ? 1 : !state?.attempts ? 2 : 3, rate: state?.attempts ? state.errors / state.attempts : 0, time: state?.lastAnswered || 0 };
    };
    const x = rank(a), y = rank(b);
    return x.group - y.group || y.rate - x.rate || x.time - y.time;
  });
  return count === "all" ? ranked : ranked.slice(0, Math.max(0, Math.floor(count)));
}
