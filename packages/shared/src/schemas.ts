import { z } from "zod";

export enum Rank {
  Two = "2",
  Three = "3",
  Four = "4",
  Five = "5",
  Six = "6",
  Seven = "7",
  Eight = "8",
  Nine = "9",
  Ten = "T",
  Jack = "J",
  Queen = "Q",
  King = "K",
  Ace = "A",
}

export enum Suit {
  Clubs = "c",
  Diamonds = "d",
  Hearts = "h",
  Spades = "s",
}

export const CardSchema = z.object({
  rank: z.nativeEnum(Rank),
  suit: z.nativeEnum(Suit),
});
export type Card = z.infer<typeof CardSchema>;

export const PositionSchema = z.enum(["BTN", "SB", "BB", "UTG", "MP", "CO", "HJ", "LJ"]);
export type Position = z.infer<typeof PositionSchema>;

export const StreetSchema = z.enum(["preflop", "flop", "turn", "river"]);
export type Street = z.infer<typeof StreetSchema>;

export const ActionTypeSchema = z.enum([
  "fold",
  "check",
  "call",
  "bet",
  "raise",
  "all-in",
  "post-sb",
  "post-bb",
  "post-ante",
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionSchema = z.object({
  actor: z.string(),
  type: ActionTypeSchema,
  amount: z.number().nonnegative().optional(),
});
export type Action = z.infer<typeof ActionSchema>;

export const StreetActionsSchema = z.object({
  street: StreetSchema,
  board: z.array(CardSchema),
  actions: z.array(ActionSchema),
});
export type StreetActions = z.infer<typeof StreetActionsSchema>;

export const HandSchema = z.object({
  handId: z.string(),
  site: z.literal("CoinPoker"),
  table: z.string(),
  playedAt: z.string().datetime(),
  currency: z.enum(["USD", "USDT", "CHP", "PLAY"]),
  smallBlind: z.number().positive(),
  bigBlind: z.number().positive(),
  ante: z.number().nonnegative().default(0),
  hero: z.string(),
  heroCards: z.tuple([CardSchema, CardSchema]).nullable(),
  seats: z.array(
    z.object({
      seat: z.number().int().positive(),
      player: z.string(),
      stack: z.number().nonnegative(),
      position: PositionSchema.optional(),
    }),
  ),
  streets: z.array(StreetActionsSchema),
  potTotal: z.number().nonnegative(),
  rake: z.number().nonnegative().default(0),
  winners: z.array(z.object({ player: z.string(), amount: z.number() })),
});
export type Hand = z.infer<typeof HandSchema>;

export const SpotSchema = z.object({
  handId: z.string(),
  street: StreetSchema,
  actionIndex: z.number().int().nonnegative(),
  heroPosition: PositionSchema,
  effectiveStackBB: z.number().positive(),
  potBB: z.number().nonnegative(),
  toCallBB: z.number().nonnegative(),
  board: z.array(CardSchema),
  heroCards: z.tuple([CardSchema, CardSchema]),
  priorActions: z.array(ActionSchema),
});
export type Spot = z.infer<typeof SpotSchema>;

export const DecisionSchema = z.object({
  spot: SpotSchema,
  heroAction: ActionSchema,
});
export type Decision = z.infer<typeof DecisionSchema>;

export const GradeVerdictSchema = z.enum(["optimal", "minor", "suspect", "blunder", "unknown"]);
export type GradeVerdict = z.infer<typeof GradeVerdictSchema>;

/** One candidate action with its modeled EV and (where known) its strategic frequency. */
export const GradeActionSchema = z.object({
  type: ActionTypeSchema,
  sizeBB: z.number().optional(),
  evBB: z.number(),
  /** Monte Carlo standard error on evBB (absent for closed-form actions like fold). */
  stderrBB: z.number().nonnegative().optional(),
  /** Strategy probability 0–1: GTO chart frequency, or an EV-derived policy elsewhere. */
  frequency: z.number().min(0).max(1).optional(),
  /** For aggressive actions: fraction of the villain range that folds to it. */
  villainFoldPct: z.number().min(0).max(1).optional(),
  /** Marks the action hero actually took. */
  chosen: z.boolean().optional(),
});
export type GradeAction = z.infer<typeof GradeActionSchema>;

/**
 * How much to trust the numbers: `solved` (preflop chart / HU CFR equilibrium),
 * `modeled` (heads-up rollout vs a modeled range), `approximate` (multiway rollout).
 */
export const GradeConfidenceSchema = z.enum(["solved", "modeled", "approximate"]);
export type GradeConfidence = z.infer<typeof GradeConfidenceSchema>;

export const GradeSchema = z.object({
  decision: DecisionSchema,
  verdict: GradeVerdictSchema,
  /** EV in bb of hero's actual action, the best action, and the (≥0) loss between them. */
  chosenEvBB: z.number(),
  bestEvBB: z.number(),
  evLossBB: z.number().nonnegative(),
  actions: z.array(GradeActionSchema),
  confidence: GradeConfidenceSchema,
  source: z.enum(["preflop-chart", "hu-cfr", "rollout-ev", "multiway-rollout", "unknown"]),
  iterations: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});
export type Grade = z.infer<typeof GradeSchema>;
