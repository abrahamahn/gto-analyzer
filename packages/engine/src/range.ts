import { Rank } from "@poker/shared";
import { RANKS_DESC, rankValue } from "./handClass.js";

/** A range as a class → frequency (0–1) map. Absent classes are weight 0. */
export type RangeWeights = Record<string, number>;

const RANK_BY_CHAR = new Map<string, Rank>(Object.values(Rank).map((r) => [r, r]));

function parseRank(ch: string): Rank {
  const r = RANK_BY_CHAR.get(ch.toUpperCase());
  if (!r) throw new Error(`invalid rank "${ch}"`);
  return r;
}

/** Ranks strictly between `lo` and `hi` value, plus the endpoints, descending. */
function ranksFromTo(hiVal: number, loVal: number): Rank[] {
  return RANKS_DESC.filter((r) => rankValue(r) >= loVal && rankValue(r) <= hiVal);
}

/**
 * Expand one token into the classes it covers. Supported forms:
 *   "AA"            single pair
 *   "JJ+"           pairs JJ and up
 *   "99-66"         pair span
 *   "AKs" / "AKo"   single suited / offsuit combo
 *   "AK"            both AKs and AKo
 *   "ATs+"          suited, fixed high card, kicker up to one below high
 *   "A5o+"          offsuit, fixed high card
 *   "T9s-76s"       suited connector/gapper span (constant gap)
 * An optional ":0.5" frequency suffix applies to every class the token expands to.
 */
function expandToken(token: string): { classes: string[]; freq: number } {
  let freq = 1;
  const colon = token.indexOf(":");
  if (colon !== -1) {
    freq = Number(token.slice(colon + 1));
    if (!Number.isFinite(freq) || freq < 0 || freq > 1) {
      throw new Error(`invalid frequency in "${token}"`);
    }
    token = token.slice(0, colon);
  }
  token = token.trim();
  if (token.length === 0) return { classes: [], freq };

  // Span with dash, e.g. "99-66" or "T9s-76s".
  const dash = token.indexOf("-");
  if (dash !== -1) {
    return { classes: expandSpan(token.slice(0, dash), token.slice(dash + 1)), freq };
  }

  // Plus forms.
  if (token.endsWith("+")) {
    return { classes: expandPlus(token.slice(0, -1)), freq };
  }

  return { classes: expandExact(token), freq };
}

function expandExact(t: string): string[] {
  const r1 = parseRank(t[0]!);
  const r2 = parseRank(t[1]!);
  if (r1 === r2) return [`${r1}${r2}`];
  const [hi, lo] = rankValue(r1) >= rankValue(r2) ? [r1, r2] : [r2, r1];
  const suffix = t.slice(2).toLowerCase();
  if (suffix === "s") return [`${hi}${lo}s`];
  if (suffix === "o") return [`${hi}${lo}o`];
  if (suffix === "") return [`${hi}${lo}s`, `${hi}${lo}o`]; // both
  throw new Error(`invalid token "${t}"`);
}

function expandPlus(base: string): string[] {
  const r1 = parseRank(base[0]!);
  const r2 = parseRank(base[1]!);
  // Pair plus: "JJ+" → JJ..AA
  if (r1 === r2) {
    return ranksFromTo(rankValue(Rank.Ace), rankValue(r1)).map((r) => `${r}${r}`);
  }
  const [hi, lo] = rankValue(r1) >= rankValue(r2) ? [r1, r2] : [r2, r1];
  const suffix = base.slice(2).toLowerCase();
  // Kicker climbs from `lo` up to one below `hi`, high card fixed.
  const kickers = ranksFromTo(rankValue(hi) - 1, rankValue(lo));
  const make = (suit: "s" | "o") => kickers.map((k) => `${hi}${k}${suit}`);
  if (suffix === "s") return make("s");
  if (suffix === "o") return make("o");
  if (suffix === "") return [...make("s"), ...make("o")];
  throw new Error(`invalid token "${base}+"`);
}

function expandSpan(fromTok: string, toTok: string): string[] {
  // Pair span "99-66".
  if (fromTok.length === 2 && fromTok[0] === fromTok[1]) {
    const from = rankValue(parseRank(fromTok[0]!));
    const to = rankValue(parseRank(toTok[0]!));
    const [hi, lo] = from >= to ? [from, to] : [to, from];
    return ranksFromTo(hi, lo).map((r) => `${r}${r}`);
  }
  const suffix = fromTok.slice(2).toLowerCase();
  if (suffix !== "s" && suffix !== "o") throw new Error(`invalid span "${fromTok}-${toTok}"`);
  const rankByVal = (v: number) => RANKS_DESC.find((r) => rankValue(r) === v);
  const fHi = rankValue(parseRank(fromTok[0]!));
  const fLo = rankValue(parseRank(fromTok[1]!));
  const tHi = rankValue(parseRank(toTok[0]!));
  const tLo = rankValue(parseRank(toTok[1]!));
  const out: string[] = [];

  // Fixed high card, varying kicker — "A2s-ATs" → A2s..ATs.
  if (fHi === tHi) {
    const [lo, hi] = fLo <= tLo ? [fLo, tLo] : [tLo, fLo];
    const hiRank = rankByVal(fHi);
    for (let k = hi; k >= lo; k--) {
      const kRank = rankByVal(k);
      if (hiRank && kRank && k < fHi) out.push(`${hiRank}${kRank}${suffix}`);
    }
    return out;
  }

  // Constant-gap connector/gapper span — "T9s-76s".
  const gap = fHi - fLo;
  if (tHi - tLo !== gap) {
    throw new Error(`span "${fromTok}-${toTok}" must keep a constant gap`);
  }
  const [topHi, bottomHi] = fHi >= tHi ? [fHi, tHi] : [tHi, fHi];
  for (let h = topHi; h >= bottomHi; h--) {
    const hiRank = rankByVal(h);
    const loRank = rankByVal(h - gap);
    if (hiRank && loRank) out.push(`${hiRank}${loRank}${suffix}`);
  }
  return out;
}

/**
 * Compile standard range notation into a weight map. Later tokens override
 * earlier ones for the same class, so partial-frequency overrides work:
 *   "ATo+, AJo:0.5" → AJo at 0.5, ATo/AQo/AKo at 1.
 */
export function compileRange(notation: string): RangeWeights {
  const weights: RangeWeights = {};
  for (const raw of notation.split(",")) {
    const token = raw.trim();
    if (token.length === 0) continue;
    const { classes, freq } = expandToken(token);
    for (const cls of classes) weights[cls] = freq;
  }
  return weights;
}
