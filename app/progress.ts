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
export const emptyProgress = (): ProgressState => ({ levels: {}, answered: 0, correct: 0, mistakes: {} });

export function restoreProgress(saved: string | null, legacy: string | null, firstSystemId: string): ProgressStore {
  const initial = { selectedSystemId: firstSystemId, systems: {} };
  try {
    if (saved) return z.object({ selectedSystemId: z.string(), systems: z.record(progressSchema) }).parse(JSON.parse(saved));
  } catch { /* Invalid storage must not prevent training. Try the legacy backup. */ }
  try {
    if (legacy) return { ...initial, systems: { [firstSystemId]: progressSchema.parse(JSON.parse(legacy)) } };
  } catch { /* Start fresh if the legacy backup is also invalid. */ }
  return initial;
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

export function completeLevel(progress: ProgressState, levelId: string, mode: "lesson" | "test" | "review", score: number, total: number, passingPercent: number): ProgressState {
  if (mode === "review" || !total) return progress;
  const previous = progress.levels[levelId] || { lessonCompleted: false, testPassed: false, bestScore: 0 };
  return { ...progress, levels: { ...progress.levels, [levelId]: {
    lessonCompleted: previous.lessonCompleted || mode === "lesson",
    testPassed: previous.testPassed || (mode === "test" && passesTest(score, total, passingPercent)),
    bestScore: mode === "test" ? Math.max(previous.bestScore, Math.round(score / total * 100)) : previous.bestScore,
  } } };
}
