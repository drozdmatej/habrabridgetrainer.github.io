"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { auctionState, normalizeBid, questionAuction, questionCallError, seats, seatNames } from "./auction";
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

export function QuestionCard({ question, answer, onChoose, onNext, nextLabel = "Další úloha", manageFocus = true }: {
  question: TrainerQuestion; answer: Answer | null;
  onChoose: (value: string, correct: boolean) => void; onNext: () => void; nextLabel?: string; manageFocus?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (manageFocus) heading.current?.focus({ preventScroll: true }); }, [question.id, manageFocus]);
  useEffect(() => { if (manageFocus && answer) nextButton.current?.focus(); }, [answer, manageFocus]);
  const auction = questionAuction(question);
  const state = auctionState(auction);
  const legal = (value: string) => !questionCallError(question, value);
  const chooseBid = (value: string) => { if (!answer && legal(value)) onChoose(value, !!normalizeBid(question.correctBid || "") && normalizeBid(value) === normalizeBid(question.correctBid || "")); };
  const cells = [...Array(seats.indexOf(auction.dealer)).fill(null), ...auction.calls,
    ...(!state.ended && !state.errors.length ? [{ seat: state.next!, bid: "?" }] : [])];
  while (cells.length % 4) cells.push(null);
  return <article className="question-card">
    <section className="auction" aria-label="Dražba čtyř hráčů">
      <p>Rozdává {auction.dealer} · Hraješ za {auction.player} · V manši: {({ none: "nikdo", NS: "N–S", EW: "E–W", both: "obě strany" })[auction.vulnerability]}</p>
      <table><caption>{state.errors.length ? "Neplatná dražba" : state.ended ? state.passedOut ? "Všichni pasovali – dražba skončila" : "Dražba skončila" : `Na řadě je ${state.next} (${seatNames[state.next!]})`}</caption>
        <thead><tr>{seats.map(seat => <th key={seat} scope="col">{seat}<small>{seatNames[seat]}{seat === auction.player ? " (ty)" : ""}</small><small>{seat === "N" || seat === "S" ? "N–S" : "E–W"}</small></th>)}</tr></thead>
        <tbody>{Array.from({ length: cells.length / 4 }, (_, row) => <tr key={row}>{cells.slice(row * 4, row * 4 + 4).map((call, col) => <td key={col} aria-label={call ? `${call.seat}: ${call.bid === "?" ? "na řadě" : call.bid}` : undefined} aria-current={call?.bid === "?" ? "step" : undefined}>{call ? call.bid === "?" ? <strong>Na řadě</strong> : <Bid value={call.bid}/> : "—"}</td>)}</tr>)}</tbody>
      </table>
      {!question.auction && question.sequence.length > 0 && <small>Pasy soupeřů jsou doplněny ze zkráceného zápisu.</small>}
      {state.errors.length > 0 && <p role="alert">{state.errors.join(" ")}</p>}
    </section>
    {question.hand && <div className="hand" aria-label="Karty hráče">{(["s", "h", "d", "c"] as const).map((key) => <div key={key} className="hand-row"><span className={"suit suit-" + key}>{key === "s" ? "♠" : key === "h" ? "♥" : key === "d" ? "♦" : "♣"}</span><strong>{question.hand?.[key] || "—"}</strong></div>)}</div>}
    <div className="question-copy"><span>{question.type === "choice" ? "Vyber odpověď" : "Co dražíš?"}</span><h1 ref={heading} tabIndex={-1} className="question-heading">{question.prompt || "Doplň text otázky"}</h1></div>
    {question.type === "choice" ? <div className="choices">{question.options?.map((option, index) => <button key={option.id} disabled={!!answer} className={"choice " + (answer && option.correct ? "correct" : answer?.selected === option.id ? "wrong" : "")} onClick={() => onChoose(option.id, option.correct)}><span>{String.fromCharCode(65 + index)}</span>{option.text}</button>)}</div> :
      <div className="bidding-box"><div className="bid-grid">{Array.from({ length: 7 }, (_, i) => i + 1).flatMap((level) => suits.map((suit) => <button aria-label={level + suit.symbol} key={level + suit.code} disabled={!!answer || !legal(level + suit.code)} onClick={() => chooseBid(level + suit.code)}><span>{level}</span><span className={"bid-" + suit.tone}>{suit.symbol}</span></button>))}</div><div className="special-bids">{["PASS", "X", "XX"].map((bid) => <button key={bid} disabled={!!answer || !legal(bid)} onClick={() => chooseBid(bid)}>{bid === "X" ? "KONTRA" : bid === "XX" ? "REKONTRA" : bid}</button>)}</div></div>}
    {answer && <div role="status" className={"feedback " + (answer.correct ? "is-correct" : "is-wrong")}><strong>{answer.correct ? "Správně." : <>Tentokrát ne. Správná odpověď: {question.type === "bid_box" ? <Bid value={question.correctBid || "—"}/> : question.options?.find((o) => o.correct)?.text}</>}</strong><p>{question.rationale || "Vysvětlení zatím chybí."}</p><button ref={nextButton} className="button button-primary" onClick={onNext}>{nextLabel}<ChevronRight size={16}/></button></div>}
  </article>;
}

export function QuestionPreview({ question }: { question: TrainerQuestion }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  return <QuestionCard question={question} answer={answer} manageFocus={false} onChoose={(selected, correct) => { if (!answer) setAnswer({ selected, correct }); }} onNext={() => setAnswer(null)} nextLabel="Zkusit náhled znovu"/>;
}
