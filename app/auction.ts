import type { Auction, AuctionCall, Seat, TrainerQuestion } from "./types";

export const seats: Seat[] = ["N", "E", "S", "W"];
export const seatNames: Record<Seat, string> = { N: "Sever", E: "Východ", S: "Jih", W: "Západ" };
export const nextSeat = (seat: Seat): Seat => seats[(seats.indexOf(seat) + 1) % 4];
export const sameSide = (a: Seat, b: Seat): boolean => seats.indexOf(a) % 2 === seats.indexOf(b) % 2;

// English S always means spades; Czech hearts use H or ♥.
export function normalizeBid(input: string): string {
  const value = input.trim().toUpperCase().replace(/\s+/g, "");
  const special: Record<string, string> = { PAS: "PASS", PASS: "PASS", X: "X", KONTRA: "X", XX: "XX", REKONTRA: "XX" };
  if (Object.hasOwn(special, value)) return special[value];
  const match = value.match(/^([1-7])(NT|BT|[CDHSTKP♣♦♥♠])$/);
  if (!match) return "";
  const aliases: Record<string, string> = { T: "C", K: "D", P: "S", BT: "NT", "♣": "C", "♦": "D", "♥": "H", "♠": "S" };
  return match[1] + (aliases[match[2]] || match[2]);
}

export function bidRank(value: string): number | null {
  const match = normalizeBid(value).match(/^([1-7])(C|D|H|S|NT)$/);
  return match ? (Number(match[1]) - 1) * 5 + ["C", "D", "H", "S", "NT"].indexOf(match[2]) : null;
}

export type AuctionState = {
  next: Seat | null;
  ended: boolean;
  passedOut: boolean;
  passes: number;
  contract?: { bid: string; bidder: Seat; declarer: Seat; doubling: "none" | "X" | "XX" };
  errors: string[];
};

// WBF Laws 17–19 and 22: only legal calls advance the state.
export function callError(state: AuctionState, call: AuctionCall): string | null {
  if (state.errors.length) return "Předchozí dražba je neplatná.";
  if (state.ended) return "Dražba již skončila.";
  if (call.seat !== state.next) return `Na řadě je ${state.next}, nikoli ${call.seat}.`;
  const bid = normalizeBid(call.bid);
  if (!bid) return "Neplatná hláška.";
  if (bid === "PASS") return null;
  const contract = state.contract;
  if (bid === "X") return !contract || contract.doubling !== "none" || sameSide(call.seat, contract.bidder)
    ? "Kontra lze dát pouze na poslední závazek soupeřů bez kontra či rekontra." : null;
  if (bid === "XX") return !contract || contract.doubling !== "X" || !sameSide(call.seat, contract.bidder)
    ? "Rekontra lze dát pouze na kontrovaný závazek vlastní strany." : null;
  return contract && bidRank(bid)! <= bidRank(contract.bid)! ? "Závazky musí postupovat vzestupně; další závazek musí být vyšší." : null;
}

export function auctionState(auction: Auction): AuctionState {
  const state: AuctionState = { next: auction.dealer, ended: false, passedOut: false, passes: 0, errors: [] };
  if (!seats.includes(auction.dealer) || !seats.includes(auction.player)) {
    state.errors.push("Neplatná pozice rozdávajícího nebo hráče.");
    return state;
  }
  const contracts: AuctionCall[] = [];
  for (const [index, call] of auction.calls.entries()) {
    const error = callError(state, call);
    if (error) { state.errors.push(`Hláška ${index + 1} (${call.seat}): ${error}`); break; }
    const bid = normalizeBid(call.bid);
    if (bid === "PASS") state.passes++;
    else {
      state.passes = 0;
      if (bid === "X" || bid === "XX") state.contract!.doubling = bid;
      else {
        contracts.push({ seat: call.seat, bid });
        const declarer = contracts.find(c => sameSide(c.seat, call.seat) && c.bid.slice(1) === bid.slice(1))!.seat;
        state.contract = { bid, bidder: call.seat, declarer, doubling: "none" };
      }
    }
    state.ended = state.passes === (state.contract ? 3 : 4);
    state.passedOut = state.ended && !state.contract;
    state.next = state.ended ? null : nextSeat(call.seat);
  }
  return state;
}

// Legacy sequences contain partnership calls, with opponents silently passing.
// Do not mutate stored content or progress IDs. Explicit auctions are authoritative.
export function questionAuction(question: Pick<TrainerQuestion, "sequence" | "auction">): Auction {
  if (question.auction) return question.auction;
  const calls: AuctionCall[] = [];
  let seat: Seat = "N";
  for (const bid of question.sequence) {
    calls.push({ seat, bid }, { seat: nextSeat(seat), bid: "PASS" });
    seat = nextSeat(nextSeat(seat));
  }
  return { dealer: "N", player: seat, vulnerability: "none", calls };
}

export function questionCallError(question: Pick<TrainerQuestion, "sequence" | "auction">, bid: string): string | null {
  if (question.auction && question.sequence.length) return "Nelze použít plnou a zkrácenou dražbu současně.";
  const auction = questionAuction(question);
  return callError(auctionState(auction), { seat: auction.player, bid });
}
