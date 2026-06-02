import type { Card, Street } from "@poker/shared";
import { legalActions } from "./engine.js";
import type { GamePhase, GameState, HandResult, LegalAction, PlayerStatus } from "./types.js";

/** A player as seen by one viewer — hole cards only when the viewer may see them. */
export interface PlayerView {
  seat: number;
  name: string;
  isHuman: boolean;
  difficulty: number;
  stack: number;
  status: PlayerStatus;
  committedThisStreet: number;
  committedThisHand: number;
  holeCards: [Card, Card] | null;
  isButton: boolean;
}

/** The redacted game state safe to send to a client (opponents' cards hidden). */
export interface GameView {
  handNumber: number;
  buttonSeat: number;
  phase: GamePhase;
  street: Street;
  board: Card[];
  pot: number;
  currentBet: number;
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  toAct: number | null;
  viewerSeat: number;
  players: PlayerView[];
  legal: LegalAction[];
  result: HandResult | null;
}

/** Build the view for `viewerSeat`: reveal their cards, plus any shown at showdown. */
export function viewFor(state: GameState, viewerSeat: number): GameView {
  const shown = new Set(state.result?.shown ?? []);
  const pot = state.players.reduce((s, p) => s + p.committedThisHand, 0);
  const players: PlayerView[] = state.players.map((p) => ({
    seat: p.seat,
    name: p.name,
    isHuman: p.isHuman,
    difficulty: p.difficulty,
    stack: p.stack,
    status: p.status,
    committedThisStreet: p.committedThisStreet,
    committedThisHand: p.committedThisHand,
    holeCards: p.seat === viewerSeat || shown.has(p.seat) ? p.holeCards : null,
    isButton: p.seat === state.buttonSeat,
  }));
  const legal =
    state.toAct === viewerSeat && state.phase !== "complete" ? legalActions(state, viewerSeat) : [];

  return {
    handNumber: state.handNumber,
    buttonSeat: state.buttonSeat,
    phase: state.phase,
    street: state.street,
    board: state.board,
    pot,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    smallBlind: state.config.smallBlind,
    bigBlind: state.config.bigBlind,
    toAct: state.toAct,
    viewerSeat,
    players,
    legal,
    result: state.result,
  };
}
