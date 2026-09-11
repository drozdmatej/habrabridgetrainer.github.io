"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { normalizeBid } from "./content-validation";
import type { TrainerQuestion } from "./types";

const suits = [
  { code: "C", symbol: "♣", tone: "club" }, { code: "D", symbol: "♦", tone: "diamond" },
  { code: "H", symbol: "♥", tone: "heart" }, { code: "S", symbol: "♠", tone: "spade" },
  { code: "NT", symbol: "NT", tone: "nt" },
];
export type Answer = { correct: boolean; selected: string };

function Bid({ value }: { value: string }) {
  const match = normalizeBid(value).match(/^([1-7])(C|D|H|S|NT)$/);
  if (!match) return <>{value}</>;
  const suit = suits.find((item) => item.code === match[2])!;
  return <span className={"bid bid-" + suit.tone}>{match[1]}{suit.symbol}</span>;
}

export function QuestionCard({ question, answer, onChoose, onNext, nextLabel = "Další úloha" }: {
  question: TrainerQuestion; answer: Answer | null;
  onChoose: (value: string, correct: boolean) => void; onNext: () => void; nextLabel?: string;
}) {
  const chooseBid = (value: string) => onChoose(value, !!normalizeBid(question.correctBid || "") && normalizeBid(value) === normalizeBid(question.correctBid || ""));
  return <article className="question-card">
    {question.sequence.length > 0 && <div className="sequence"><small>Předchozí dražba</small><div>{question.sequence.map((bid, index) => <span key={index}><Bid value={bid}/></span>)}</div></div>}
    {question.hand && <div className="hand" aria-label="Karty hráče">{(["s", "h", "d", "c"] as const).map((key) => <div key={key} className="hand-row"><span className={"suit suit-" + key}>{key === "s" ? "♠" : key === "h" ? "♥" : key === "d" ? "♦" : "♣"}</span><strong>{question.hand?.[key] || "—"}</strong></div>)}</div>}
    <div className="question-copy"><span>Co dražíš?</span><h1>{question.prompt || "Doplň text otázky"}</h1></div>
    {question.type === "choice" ? <div className="choices">{question.options?.map((option, index) => <button key={option.id} disabled={!!answer} className={"choice " + (answer && option.correct ? "correct" : answer?.selected === option.id ? "wrong" : "")} onClick={() => onChoose(option.id, option.correct)}><span>{String.fromCharCode(65 + index)}</span>{option.text}</button>)}</div> :
      <div className="bidding-box"><div className="bid-grid">{Array.from({ length: 7 }, (_, i) => i + 1).flatMap((level) => suits.map((suit) => <button aria-label={level + suit.symbol} key={level + suit.code} disabled={!!answer} onClick={() => chooseBid(level + suit.code)}><span>{level}</span><span className={"bid-" + suit.tone}>{suit.symbol}</span></button>))}</div><div className="special-bids">{["PASS", "X", "XX"].map((bid) => <button key={bid} disabled={!!answer} onClick={() => chooseBid(bid)}>{bid === "X" ? "KONTRA" : bid === "XX" ? "REKONTRA" : bid}</button>)}</div></div>}
    {answer && <div role="status" className={"feedback " + (answer.correct ? "is-correct" : "is-wrong")}><strong>{answer.correct ? "Správně." : <>Tentokrát ne. Správná odpověď: {question.type === "bid_box" ? <Bid value={question.correctBid || "—"}/> : question.options?.find((o) => o.correct)?.text}</>}</strong><p>{question.rationale || "Vysvětlení zatím chybí."}</p><button className="button button-primary" onClick={onNext}>{nextLabel}<ChevronRight size={16}/></button></div>}
  </article>;
}

export function QuestionPreview({ question }: { question: TrainerQuestion }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  return <QuestionCard question={question} answer={answer} onChoose={(selected, correct) => { if (!answer) setAnswer({ selected, correct }); }} onNext={() => setAnswer(null)} nextLabel="Zkusit náhled znovu"/>;
}
