import { z } from "zod";
import type { TrainerContent, TrainerQuestion } from "./types";

// English S always means spades. Czech hearts must be H or ♥ (not ambiguous S).
export function normalizeBid(input: string): string {
  const value = input.trim().toUpperCase().replace(/\s+/g, "");
  const special: Record<string, string> = { PAS: "PASS", PASS: "PASS", X: "X", KONTRA: "X", XX: "XX", REKONTRA: "XX" };
  if (special[value]) return special[value];
  const match = value.match(/^([1-7])(NT|BT|[CDHSTKP♣♦♥♠])$/);
  if (!match) return "";
  const aliases: Record<string, string> = { T: "C", K: "D", P: "S", BT: "NT", "♣": "C", "♦": "D", "♥": "H", "♠": "S" };
  return match[1] + (aliases[match[2]] || match[2]);
}

const id = z.string().trim().min(1).max(200);
const text = z.string().max(10000);
// Drafts may be incomplete, but must always be safe to load into the editor.
export const contentSchema = z.object({
  title: text, academyName: text,
  systems: z.array(z.object({
    id, name: text, status: z.enum(["active", "draft"]),
    levels: z.array(z.object({
      id, title: text, description: text, status: z.enum(["active", "draft"]).optional(),
      passingPercent: z.number().int().min(0).max(100),
      questions: z.array(z.object({
        id, type: z.enum(["bid_box", "choice"]), sequence: z.array(text).max(200),
        hand: z.object({ s: text, h: text, d: text, c: text }).optional(),
        prompt: text, correctBid: text.optional(), rationale: text,
        options: z.array(z.object({ id, text, correct: z.boolean() })).max(20).optional(),
      })).max(2000),
    })).max(200),
  })).min(1).max(20),
}).superRefine((content, context) => {
  function unique(items: { id: string }[], path: (string | number)[]) {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id)) context.addIssue({ code: "custom", path: [...path, index, "id"], message: "Duplicitní ID: " + item.id });
      seen.add(item.id);
    });
  }
  unique(content.systems, ["systems"]);
  content.systems.forEach((system, s) => {
    unique(system.levels, ["systems", s, "levels"]);
    system.levels.forEach((level, l) => {
      unique(level.questions, ["systems", s, "levels", l, "questions"]);
      level.questions.forEach((q, i) => unique(q.options || [], ["systems", s, "levels", l, "questions", i, "options"]));
    });
  });
});

export function validateQuestion(question: TrainerQuestion): string[] {
  const errors: string[] = [];
  if (!question.prompt.trim()) errors.push("Doplň text otázky.");
  if (!question.rationale.trim()) errors.push("Doplň vysvětlení odpovědi.");
  if (question.sequence.some((bid) => !normalizeBid(bid))) errors.push("Předchozí dražba obsahuje neplatnou hlášku.");
  if (question.type === "bid_box" && !normalizeBid(question.correctBid || "")) errors.push("Doplň platnou správnou hlášku (1♣–7NT, PASS, X nebo XX).");
  if (question.type === "choice") {
    const options = question.options || [];
    if (options.length < 2) errors.push("Doplň alespoň dvě možnosti odpovědi.");
    if (options.some((option) => !option.text.trim())) errors.push("Vyplň text všech možností.");
    if (options.filter((option) => option.correct).length !== 1) errors.push("Označ právě jednu správnou možnost.");
    if (new Set(options.map((option) => option.text.trim())).size !== options.length) errors.push("Možnosti odpovědí musí mít odlišné texty.");
  }
  if (question.hand) {
    let total = 0;
    const names = { s: "♠", h: "♥", d: "♦", c: "♣" };
    for (const suit of ["s", "h", "d", "c"] as const) {
      const cards = question.hand[suit].trim().toUpperCase().replace(/\s+/g, "");
      if (["", "-", "—"].includes(cards)) continue;
      if (!/^(10|[AKQJT2-9])+$/.test(cards)) { errors.push(`Neplatný zápis karet v barvě ${names[suit]}. Použij AKQJ, 10 nebo T a čísla 2–9.`); continue; }
      const ranks = cards.replace(/10/g, "T").split("");
      total += ranks.length;
      if (new Set(ranks).size !== ranks.length) errors.push(`Stejná karta je v barvě ${names[suit]} vícekrát.`);
    }
    if (total !== 13) errors.push(`Ruka má ${total} karet; musí jich mít 13. Pro otázku bez karet ruku vypni.`);
  }
  return errors;
}

export type ContentIssue = { systemId?: string; levelId?: string; questionId?: string; message: string };
export function publicationIssues(content: TrainerContent): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!content.title.trim() || !content.academyName.trim()) issues.push({ message: "Doplň název aplikace a akademie." });
  const systems = content.systems.filter((s) => s.status === "active");
  if (!systems.length) issues.push({ message: "Vyber alespoň jeden aktivní systém." });
  for (const system of systems) {
    if (!system.name.trim()) issues.push({ systemId: system.id, message: "Doplň název systému." });
    const levels = system.levels.filter((l) => l.status !== "draft");
    if (!levels.length) issues.push({ systemId: system.id, message: "Systém musí obsahovat alespoň jednu kapitolu připravenou ke zveřejnění." });
    for (const level of levels) {
      const at = { systemId: system.id, levelId: level.id };
      if (!level.title.trim()) issues.push({ ...at, message: "Doplň název kapitoly." });
      if (!level.questions.length) issues.push({ ...at, message: "Kapitola nemá žádné úlohy." });
      for (const question of level.questions) for (const message of validateQuestion(question)) issues.push({ ...at, questionId: question.id, message });
    }
  }
  return issues;
}

export function publishedContent(content: TrainerContent): TrainerContent {
  return { ...content, systems: content.systems.filter((s) => s.status === "active").map((s) => ({ ...s, levels: s.levels.filter((l) => l.status !== "draft") })) };
}
