import type { Card } from "@poker/shared";

export const SUIT_SYMBOL: Record<string, string> = { c: "♣", d: "♦", h: "♥", s: "♠" };
export const SUIT_COLOR: Record<string, string> = {
  c: "text-neutral-200",
  s: "text-neutral-200",
  d: "text-red-400",
  h: "text-red-400",
};

export function cardLabel(card: Card): string {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

export function cardColor(card: Card): string {
  return SUIT_COLOR[card.suit] ?? "text-neutral-200";
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USDT: "₮",
  USD: "$",
  CHP: "₡",
  PLAY: "",
};

export function formatAmount(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? "";
  const fmt = amount.toLocaleString(undefined, {
    minimumFractionDigits: currency === "PLAY" ? 0 : 2,
    maximumFractionDigits: currency === "PLAY" ? 0 : 2,
  });
  return `${symbol}${fmt}`;
}

export function formatSigned(amount: number, currency: string): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${formatAmount(Math.abs(amount), currency)}`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
