export type Suit = "s" | "h" | "d" | "c";

export type ChoiceOption = {
  id: string;
  text: string;
  correct: boolean;
};

export type Seat = "N" | "E" | "S" | "W";
export type AuctionCall = { seat: Seat; bid: string };
export type Auction = {
  dealer: Seat;
  player: Seat;
  vulnerability: "none" | "NS" | "EW" | "both";
  calls: AuctionCall[];
};

export type TrainerQuestion = {
  id: string;
  type: "bid_box" | "choice";
  /** Legacy partnership sequence; empty when auction is present. */
  sequence: string[];
  auction?: Auction;
  hand?: Record<Suit, string>;
  prompt: string;
  correctBid?: string;
  options?: ChoiceOption[];
  rationale: string;
};

export type TrainerLevel = {
  id: string;
  status?: "active" | "draft";
  title: string;
  description: string;
  passingPercent: number;
  questions: TrainerQuestion[];
  test?: { source: "lesson" | "separate"; questions?: TrainerQuestion[]; questionCount?: number; shuffle?: boolean; requireLesson?: boolean };

};

export type TrainerSystem = {
  id: string;
  name: string;
  status: "active" | "draft";
  description?: string;
  rules?: string[];
  difficulty?: "beginner" | "intermediate" | "advanced" | "expert";
  sources?: string[];
  access?: "public" | "restricted";
  levels: TrainerLevel[];
};

export type TrainerContent = {
  title: string;
  academyName: string;
  systems: TrainerSystem[];
  lockedSystems?: { id: string; name: string }[];
};
