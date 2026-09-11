export type Suit = "s" | "h" | "d" | "c";

export type ChoiceOption = {
  id: string;
  text: string;
  correct: boolean;
};

export type TrainerQuestion = {
  id: string;
  type: "bid_box" | "choice";
  sequence: string[];
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
};

export type TrainerSystem = {
  id: string;
  name: string;
  status: "active" | "draft";
  levels: TrainerLevel[];
};

export type TrainerContent = {
  title: string;
  academyName: string;
  systems: TrainerSystem[];
};
