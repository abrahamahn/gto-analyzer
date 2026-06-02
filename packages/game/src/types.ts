import type { Card, Street } from "@poker/shared";

/** A bot's playing strength, 0 = beginner (loose, face-up) … 1 = GTO. */
export type Difficulty = number;

export interface SeatConfig {
  name: string;
  isHuman: boolean;
  /** Bot difficulty 0–1; ignored for humans. */
  difficulty?: Difficulty;
}

export interface GameConfig {
  /** Number of occupied seats, 2–10. */
  seats: SeatConfig[];
  smallBlind: number;
  bigBlind: number;
  ante: number;
  /** Chips each seat is topped up to at the start of a cash hand. */
  startingStack: number;
  /** Fraction of a raked pot taken by the house (0 = rake-free, the trainer default). */
  rakePercent?: number;
  /** Maximum rake in chips (0 = uncapped). Only applied when a flop is seen. */
  rakeCap?: number;
}

export type PlayerStatus = "active" | "folded" | "all-in" | "out";

export interface PlayerState {
  seat: number;
  name: string;
  isHuman: boolean;
  difficulty: Difficulty;
  stack: number;
  holeCards: [Card, Card] | null;
  status: PlayerStatus;
  /** Chips put in on the current street (resets each street). */
  committedThisStreet: number;
  /** Chips put in across the whole hand (for side pots). */
  committedThisHand: number;
  /** Acted at least once on the current street (for the round-complete / BB-option check). */
  hasActedThisStreet: boolean;
}

export type GamePhase = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";

export type GameActionType = "fold" | "check" | "call" | "bet" | "raise";

export interface GameAction {
  seat: number;
  type: GameActionType;
  /** For bet/raise: the total chips committed this street after the action ("raise to"). */
  amount?: number;
}

export interface Pot {
  amount: number;
  /** Seats eligible to win this (side) pot. */
  eligible: number[];
}

export interface PotResult {
  amount: number;
  winners: number[];
  /** Best 5-card category description for the winner(s), when shown. */
  description?: string;
}

export interface HandResult {
  pots: PotResult[];
  /** Net chips won/lost this hand, by seat. */
  net: Record<number, number>;
  /** Seats whose cards were shown at showdown. */
  shown: number[];
  /** Chips taken as rake (0 in the rake-free trainer default). */
  rake: number;
}

export interface LegalAction {
  type: GameActionType;
  /** For bet/raise: minimum and maximum total committed-this-street the action may reach. */
  min?: number;
  max?: number;
}

export interface GameState {
  config: GameConfig;
  handNumber: number;
  buttonSeat: number;
  phase: GamePhase;
  board: Card[];
  /** Remaining undealt cards (top of deck = end of array). */
  deck: Card[];
  players: PlayerState[];
  /** Highest committed-this-street any player has reached. */
  currentBet: number;
  /** Size of the last full raise (the minimum legal raise increment). */
  minRaise: number;
  /** Seats that have acted since the last full bet/raise (raise-rights tracking). */
  actedSinceFullRaise: number[];
  toAct: number | null;
  lastAggressor: number | null;
  street: Street;
  actions: GameAction[];
  /** Streets in order with their board + actions, for reconstructing a shared Hand. */
  history: Array<{ street: Street; board: Card[]; actions: GameAction[] }>;
  result: HandResult | null;
  rngState: number;
}
