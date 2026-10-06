import { z } from "zod";

const count = z.number().int().nonnegative();
const progressSchema = z.object({
  levels: z.record(z.object({ lessonCompleted: z.boolean(), testPassed: z.boolean(), bestScore: z.number().min(0).max(100) })),
  answered: count,
  correct: count,
  mistakes: z.record(z.array(z.string())).default({}),
}).refine(p => p.correct <= p.answered);
export type ProgressState = z.infer<typeof progressSchema>;
export type ProgressStore = { selectedSystemId: string; systems: Record<string, ProgressState> };
const storeSchema = z.object({ selectedSystemId: z.string(), systems: z.record(progressSchema) });
export type ProgressStorage = Pick<Storage, "getItem" | "setItem">;
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

export function recordAnswer(progress: ProgressState, levelId: string, questionId: string, correct: boolean): ProgressState {
  const mistakes = new Set(progress.mistakes[levelId] || []);
  if (correct) mistakes.delete(questionId); else mistakes.add(questionId);
  return { ...progress, answered: progress.answered + 1, correct: progress.correct + Number(correct),
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
    bestScore: mode === "test" ? Math.max(previous.bestScore, scorePercent(score, total)) : previous.bestScore,
  } } };
}
