import { type Card, Rank, Suit } from "./schemas.js";

export const RANKS = [
  Rank.Two,
  Rank.Three,
  Rank.Four,
  Rank.Five,
  Rank.Six,
  Rank.Seven,
  Rank.Eight,
  Rank.Nine,
  Rank.Ten,
  Rank.Jack,
  Rank.Queen,
  Rank.King,
  Rank.Ace,
] as const;

export const SUITS = [Suit.Clubs, Suit.Diamonds, Suit.Hearts, Suit.Spades] as const;

const RANK_CHARS: Record<Rank, string> = {
  [Rank.Two]: "2",
  [Rank.Three]: "3",
  [Rank.Four]: "4",
  [Rank.Five]: "5",
  [Rank.Six]: "6",
  [Rank.Seven]: "7",
  [Rank.Eight]: "8",
  [Rank.Nine]: "9",
  [Rank.Ten]: "T",
  [Rank.Jack]: "J",
  [Rank.Queen]: "Q",
  [Rank.King]: "K",
  [Rank.Ace]: "A",
};

const SUIT_CHARS: Record<Suit, string> = {
  [Suit.Clubs]: "c",
  [Suit.Diamonds]: "d",
  [Suit.Hearts]: "h",
  [Suit.Spades]: "s",
};

const CHAR_TO_RANK = new Map<string, Rank>(
  (Object.entries(RANK_CHARS) as Array<[string, string]>).map(([rank, ch]) => [ch, rank as Rank]),
);
const CHAR_TO_SUIT = new Map<string, Suit>(
  (Object.entries(SUIT_CHARS) as Array<[string, string]>).map(([suit, ch]) => [ch, suit as Suit]),
);

export function formatCard(card: Card): string {
  return `${RANK_CHARS[card.rank]}${SUIT_CHARS[card.suit]}`;
}

export function parseCard(text: string): Card {
  if (text.length !== 2) {
    throw new Error(`Invalid card "${text}": must be 2 characters (e.g. "As", "Td")`);
  }
  const rankCh = text[0];
  const suitCh = text[1];
  if (rankCh === undefined || suitCh === undefined) {
    throw new Error(`Invalid card "${text}"`);
  }
  const rank = CHAR_TO_RANK.get(rankCh.toUpperCase());
  const suit = CHAR_TO_SUIT.get(suitCh.toLowerCase());
  if (rank === undefined) throw new Error(`Invalid rank "${rankCh}" in card "${text}"`);
  if (suit === undefined) throw new Error(`Invalid suit "${suitCh}" in card "${text}"`);
  return { rank, suit };
}
