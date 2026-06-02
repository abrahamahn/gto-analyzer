import {
  type Action,
  type Card,
  type Hand,
  type Position,
  type StreetActions,
  parseCard,
} from "@poker/shared";

export class ParserError extends Error {
  constructor(
    message: string,
    public readonly handBlock?: string,
  ) {
    super(message);
    this.name = "ParserError";
  }
}

const A = "[₮$\\d.,]+"; // amount fragment — strips currency in parseAmount

const HEADER_RE = new RegExp(
  `^CoinPoker Hand #(\\d+): NLH \\((${A})\\/(${A})(?:\\/(${A}))?\\) (\\d{4}\\/\\d{2}\\/\\d{2} \\d{2}:\\d{2}:\\d{2}) (\\w+)$`,
);
// BombPot uses run-it-twice (FIRST FLOP / SECOND FLOP); skipped until we model dual boards.
const UNSUPPORTED_HEADER_RE = /^CoinPoker Hand #\d+: (PLO|PLO8|FLH|MLH|NLH BombPot)/;
const TOURNEY_TABLE_RE = /^Tournament '([^']+)' '([^']+)' (\d+)-max Seat #(\d+) is the button$/;
const CASH_TABLE_RE = /^Table '([^']+)' (\d+)-max Seat #(\d+) is the button$/;
const SEAT_RE = new RegExp(`^Seat (\\d+): (\\S+) \\((${A}) in chips\\)$`);
const ANTE_RE = new RegExp(`^(\\S+): posts ante (${A})(?: ALLIN)?$`);
const SB_RE = new RegExp(`^(\\S+): posts small blind (${A})(?: ALLIN)?$`);
const BB_RE = new RegExp(`^(\\S+): posts (?:auto )?big blind (${A})(?: ALLIN)?$`);
const DEALT_HERO_RE = /^Dealt to (\S+) \[(\S\S) (\S\S)\]$/;
const DEALT_OTHER_RE = /^Dealt to (\S+)$/;
const ACTION_FOLD_RE = /^(\S+): folds$/;
const ACTION_CHECK_RE = /^(\S+): checks$/;
const ACTION_CALL_RE = new RegExp(`^(\\S+): calls (${A})$`);
const ACTION_BET_RE = new RegExp(`^(\\S+): bets (${A})$`);
const ACTION_RAISE_RE = new RegExp(`^(\\S+): raises (${A}) to (${A})$`);
const ACTION_ALLIN_RE = new RegExp(`^(\\S+): ALLIN (${A})$`);
const FLOP_RE = /^\*\*\* FLOP \*\*\* \[(\S\S) (\S\S) (\S\S)\]$/;
const TURN_RE = /^\*\*\* TURN \*\*\* \[\S\S \S\S \S\S\] \[(\S\S)\]$/;
const RIVER_RE = /^\*\*\* RIVER \*\*\* \[\S\S \S\S \S\S \S\S\] \[(\S\S)\]$/;
const COLLECTED_RE = new RegExp(`^(\\S+) collected (${A}) from pot$`);
const SUMMARY_TOTAL_RE = new RegExp(`^Total pot (${A})(?: \\| Rake (${A}))?(?: \\| .+)?$`);
const SPLASH_RE = /^(?:MEGA )?SPLASH dropped /;
const SEAT_WON_RE = new RegExp(`^Seat \\d+: (\\S+) (?:showed \\[[^\\]]+\\] and )?won \\((${A})\\)`);

const POSITION_BY_SIZE: Record<number, Position[]> = {
  2: ["BTN", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["BTN", "SB", "BB", "UTG"],
  5: ["BTN", "SB", "BB", "UTG", "CO"],
  6: ["BTN", "SB", "BB", "UTG", "HJ", "CO"],
  7: ["BTN", "SB", "BB", "UTG", "MP", "HJ", "CO"],
  8: ["BTN", "SB", "BB", "UTG", "MP", "LJ", "HJ", "CO"],
  9: ["BTN", "SB", "BB", "UTG", "MP", "MP", "LJ", "HJ", "CO"],
};

function parseAmount(s: string): number {
  return Number(s.replace(/[₮$€£,]/g, ""));
}

function detectCurrency(rawSbAmount: string): "USDT" | "USD" | "CHP" | "PLAY" {
  if (rawSbAmount.includes("₮")) return "USDT";
  if (rawSbAmount.includes("$")) return "USD";
  return "PLAY";
}

const TZ_OFFSET: Record<string, number> = {
  UTC: 0,
  GMT: 0,
  KST: 9 * 60,
  JST: 9 * 60,
  CST: -6 * 60,
  EST: -5 * 60,
  PST: -8 * 60,
  CET: 60,
  BST: 60,
};

function parseDate(dateStr: string, tz: string): string {
  const m = dateStr.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) throw new ParserError(`unparseable date "${dateStr}"`);
  const [, y, mo, d, h, mi, se] = m;
  const offsetMin = TZ_OFFSET[tz];
  if (offsetMin === undefined) throw new ParserError(`unknown timezone "${tz}"`);
  const utcMs = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +se!) - offsetMin * 60_000;
  return new Date(utcMs).toISOString();
}

interface ParsedSeat {
  seat: number;
  player: string;
  stack: number;
}

function derivePositions(seats: ParsedSeat[], buttonSeat: number): Map<string, Position> {
  const sorted = [...seats].sort((a, b) => a.seat - b.seat);
  const buttonIdx = sorted.findIndex((s) => s.seat === buttonSeat);
  if (buttonIdx === -1) {
    throw new ParserError(`button seat ${buttonSeat} not occupied`);
  }
  const ordered = [...sorted.slice(buttonIdx), ...sorted.slice(0, buttonIdx)];
  const positions = POSITION_BY_SIZE[ordered.length];
  if (!positions) {
    throw new ParserError(`unsupported occupied-seat count: ${ordered.length}`);
  }
  const map = new Map<string, Position>();
  for (let i = 0; i < ordered.length; i++) {
    map.set(ordered[i]!.player, positions[i]!);
  }
  return map;
}

function splitHandBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("CoinPoker Hand #")) {
      if (current.length > 0) blocks.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0 && current.some((l) => l.startsWith("CoinPoker Hand #"))) {
    blocks.push(current.join("\n"));
  }
  return blocks;
}

interface Section {
  street: StreetActions["street"];
  board: Card[];
  actions: Action[];
}

function parseHand(block: string): Hand | null {
  const lines = block.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) throw new ParserError("empty hand block");

  if (UNSUPPORTED_HEADER_RE.test(lines[0]!)) return null;
  const header = lines[0]!.match(HEADER_RE);
  if (!header) throw new ParserError(`bad header: "${lines[0]}"`, block);
  const handId = header[1]!;
  const rawSb = header[2]!;
  const smallBlind = parseAmount(rawSb);
  const bigBlind = parseAmount(header[3]!);
  const ante = header[4] ? parseAmount(header[4]) : 0;
  const playedAt = parseDate(header[5]!, header[6]!);
  const currency = detectCurrency(rawSb);

  const tableLine = lines[1];
  if (!tableLine) throw new ParserError("missing table line", block);
  let table: string;
  let buttonSeat: number;
  const tourney = tableLine.match(TOURNEY_TABLE_RE);
  const cash = tableLine.match(CASH_TABLE_RE);
  if (tourney) {
    table = `${tourney[1]} #${tourney[2]}`;
    buttonSeat = Number(tourney[4]);
  } else if (cash) {
    table = cash[1]!;
    buttonSeat = Number(cash[3]);
  } else {
    throw new ParserError(`bad table line: "${tableLine}"`, block);
  }

  const seats: ParsedSeat[] = [];
  let i = 2;
  while (i < lines.length) {
    const m = lines[i]!.match(SEAT_RE);
    if (!m) break;
    seats.push({
      seat: Number(m[1]),
      player: m[2]!,
      stack: parseAmount(m[3]!),
    });
    i++;
  }
  if (seats.length === 0) throw new ParserError("no seats parsed", block);

  const positionMap = derivePositions(seats, buttonSeat);

  const preflopActions: Action[] = [];
  while (i < lines.length && lines[i] !== "*** HOLE CARDS ***") {
    const line = lines[i]!;
    if (SPLASH_RE.test(line)) {
      i++;
      continue;
    }
    const post = parsePostLine(line);
    if (!post) throw new ParserError(`unexpected pre-hole line: "${line}"`, block);
    preflopActions.push(post);
    i++;
  }

  if (lines[i] !== "*** HOLE CARDS ***") {
    throw new ParserError("missing *** HOLE CARDS *** marker", block);
  }
  i++;

  let heroCards: [Card, Card] | null = null;
  let hero = "Hero";
  while (i < lines.length && (lines[i]!.startsWith("Dealt to") || lines[i] === "")) {
    const line = lines[i]!;
    if (line === "") {
      i++;
      continue;
    }
    const heroMatch = line.match(DEALT_HERO_RE);
    if (heroMatch) {
      hero = heroMatch[1]!;
      heroCards = [parseCard(heroMatch[2]!), parseCard(heroMatch[3]!)];
    } else if (!DEALT_OTHER_RE.test(line)) {
      throw new ParserError(`unexpected hole-cards line: "${line}"`, block);
    }
    i++;
  }

  const sections: Section[] = [{ street: "preflop", board: [], actions: [...preflopActions] }];

  while (i < lines.length) {
    const line = lines[i]!;
    if (line === "*** SUMMARY ***") break;

    const street = parseStreetMarker(line, sections);
    if (street) {
      sections.push(street);
    } else if (line !== "*** SHOWDOWN ***") {
      const action = parseActionLine(line);
      if (action) {
        sections[sections.length - 1]!.actions.push(action);
      }
    }
    i++;
  }

  let potTotal = 0;
  let rake = 0;
  const winners: { player: string; amount: number }[] = [];

  while (i < lines.length) {
    const line = lines[i]!;
    const total = line.match(SUMMARY_TOTAL_RE);
    if (total) {
      potTotal = parseAmount(total[1]!);
      if (total[2]) rake = parseAmount(total[2]);
      i++;
      continue;
    }
    const collected = line.match(COLLECTED_RE);
    if (collected) {
      winners.push({ player: collected[1]!, amount: parseAmount(collected[2]!) });
      i++;
      continue;
    }
    const seatWon = line.match(SEAT_WON_RE);
    if (seatWon && !winners.some((w) => w.player === seatWon[1])) {
      winners.push({ player: seatWon[1]!, amount: parseAmount(seatWon[2]!) });
    }
    i++;
  }

  return {
    handId,
    site: "CoinPoker",
    table,
    playedAt,
    currency,
    smallBlind,
    bigBlind,
    ante,
    hero,
    heroCards,
    seats: seats.map((s) => ({
      seat: s.seat,
      player: s.player,
      stack: s.stack,
      position: positionMap.get(s.player),
    })),
    streets: sections,
    potTotal,
    rake,
    winners,
  };
}

function parsePostLine(line: string): Action | null {
  const ante = line.match(ANTE_RE);
  if (ante) return { actor: ante[1]!, type: "post-ante", amount: parseAmount(ante[2]!) };
  const sb = line.match(SB_RE);
  if (sb) return { actor: sb[1]!, type: "post-sb", amount: parseAmount(sb[2]!) };
  const bb = line.match(BB_RE);
  if (bb) return { actor: bb[1]!, type: "post-bb", amount: parseAmount(bb[2]!) };
  return null;
}

function parseStreetMarker(line: string, sections: Section[]): Section | null {
  const flop = line.match(FLOP_RE);
  if (flop) {
    return {
      street: "flop",
      board: [parseCard(flop[1]!), parseCard(flop[2]!), parseCard(flop[3]!)],
      actions: [],
    };
  }
  const turn = line.match(TURN_RE);
  if (turn) {
    const prev = sections[sections.length - 1]!;
    return {
      street: "turn",
      board: [...prev.board.slice(0, 3), parseCard(turn[1]!)],
      actions: [],
    };
  }
  const river = line.match(RIVER_RE);
  if (river) {
    const prev = sections[sections.length - 1]!;
    return {
      street: "river",
      board: [...prev.board.slice(0, 4), parseCard(river[1]!)],
      actions: [],
    };
  }
  return null;
}

function parseActionLine(line: string): Action | null {
  const fold = line.match(ACTION_FOLD_RE);
  if (fold) return { actor: fold[1]!, type: "fold" };
  const check = line.match(ACTION_CHECK_RE);
  if (check) return { actor: check[1]!, type: "check" };
  const call = line.match(ACTION_CALL_RE);
  if (call) return { actor: call[1]!, type: "call", amount: parseAmount(call[2]!) };
  const bet = line.match(ACTION_BET_RE);
  if (bet) return { actor: bet[1]!, type: "bet", amount: parseAmount(bet[2]!) };
  const raise = line.match(ACTION_RAISE_RE);
  if (raise) return { actor: raise[1]!, type: "raise", amount: parseAmount(raise[3]!) };
  const allin = line.match(ACTION_ALLIN_RE);
  if (allin) return { actor: allin[1]!, type: "all-in", amount: parseAmount(allin[2]!) };
  return null;
}

export function parseCoinPokerHands(text: string): Hand[] {
  if (text.trim().length === 0) return [];
  const blocks = splitHandBlocks(text);
  const hands: Hand[] = [];
  const errors: ParserError[] = [];
  for (const block of blocks) {
    try {
      const hand = parseHand(block);
      if (hand) hands.push(hand);
    } catch (err) {
      if (err instanceof ParserError) errors.push(err);
      else throw err;
    }
  }
  if (errors.length > 0 && hands.length === 0) {
    throw errors[0];
  }
  return hands;
}

export function parseCoinPokerHandsStrict(text: string): Hand[] {
  if (text.trim().length === 0) return [];
  return splitHandBlocks(text)
    .map(parseHand)
    .filter((h): h is Hand => h !== null);
}
