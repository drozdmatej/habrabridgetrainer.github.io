import { nextSeat, questionAuction, seatNames, seats } from "./auction";
import type { Auction, Seat, TrainerQuestion } from "./types";

export function AuctionEditor({ question, onChange }: { question: TrainerQuestion; onChange: (patch: Partial<TrainerQuestion>) => void }) {
  if (!question.auction) return <div>
    <label>Předchozí dražba <small>(hlášky partnerů, odděluj čárkou; soupeři pasují)</small><input value={question.sequence.join(",")} onChange={event => onChange({ sequence: event.target.value.trim() ? event.target.value.split(",") : [] })}/></label>
    <button type="button" className="button button-secondary" onClick={() => onChange({ auction: questionAuction(question), sequence: [] })}>Převést na plnou dražbu čtyř hráčů</button>
  </div>;
  const auction = question.auction;
  const patch = (value: Partial<Auction>) => onChange({ auction: { ...auction, ...value }, sequence: [] });
  return <fieldset className="auction-editor"><legend>Dražba čtyř hráčů</legend>
    <p>N–S a E–W jsou partnerství. Zadej všechny hlášky včetně pasů soupeřů.</p>
    <label>Rozdávající<select aria-label="Rozdávající" value={auction.dealer} onChange={event => {
      const dealer = event.target.value as Seat;
      patch({ dealer, calls: auction.calls.map((call, i) => ({ ...call, seat: seats[(seats.indexOf(dealer) + i) % 4] })) });
    }}>{seats.map(seat => <option key={seat} value={seat}>{seat} – {seatNames[seat]}</option>)}</select></label>
    <label>Odpovídající hráč<select aria-label="Odpovídající hráč" value={auction.player} onChange={event => patch({ player: event.target.value as Seat })}>{seats.map(seat => <option key={seat} value={seat}>{seat} – {seatNames[seat]}</option>)}</select></label>
    <label>Stav her<select aria-label="Stav her" value={auction.vulnerability} onChange={event => patch({ vulnerability: event.target.value as Auction["vulnerability"] })}><option value="none">Nikdo v manši</option><option value="NS">N–S v manši</option><option value="EW">E–W v manši</option><option value="both">Obě strany v manši</option></select></label>
    {auction.calls.map((call, index) => <label key={index}>Hláška {index + 1} – {call.seat} ({seatNames[call.seat]})<input aria-label={`Hláška ${index + 1} – ${call.seat}`} value={call.bid} onChange={event => patch({ calls: auction.calls.map((item, i) => i === index ? { ...item, bid: event.target.value } : item) })}/></label>)}
    <div className="auction-actions"><button type="button" disabled={auction.calls.length >= 512} onClick={() => patch({ calls: [...auction.calls, { seat: auction.calls.length ? nextSeat(auction.calls.at(-1)!.seat) : auction.dealer, bid: "PASS" }] })}>Přidat hlášku</button><button type="button" disabled={!auction.calls.length} onClick={() => patch({ calls: auction.calls.slice(0, -1) })}>Odebrat poslední hlášku</button></div>
    <small>Nová hláška je předvyplněna jako PASS. Změň ji na závazek, X nebo XX. Odpovídající hráč musí být na řadě.</small>
  </fieldset>;
}
