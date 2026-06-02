import type { Card } from "@poker/shared";
import { SUIT_COLOR, SUIT_SYMBOL } from "../lib/format.js";

interface Props {
  card: Card;
  size?: "sm" | "md" | "lg";
}

const SIZES = {
  sm: "px-1.5 py-0.5 text-xs",
  md: "px-2 py-1 text-sm",
  lg: "px-3 py-1.5 text-base",
} as const;

export function PlayingCard({ card, size = "md" }: Props) {
  return (
    <span
      className={`inline-block rounded border border-neutral-700 bg-neutral-900 font-mono ${SIZES[size]} ${SUIT_COLOR[card.suit]}`}
    >
      {card.rank}
      {SUIT_SYMBOL[card.suit]}
    </span>
  );
}
