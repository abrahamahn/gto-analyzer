import { type PreflopChart, loadChart } from "../charts.js";

/**
 * Baseline GTO preflop solutions for 6-max NLHE, expressed in standard range
 * notation (see ../range.ts). Frequencies between 0 and 1 encode mixed
 * strategies — the signature "two-tone" cells of a solver grid.
 *
 * These are solver-consensus opening/defending ranges, not a byte-for-byte dump
 * of any one proprietary solver. They are tuned for small-stakes cash (100bb)
 * and tournament play (40bb / 20bb / 10bb push-fold).
 */

// ---------------------------------------------------------------------------
// Cash — 100bb, 6-max, 2.5bb opens.
// ---------------------------------------------------------------------------

const CASH_RFI: PreflopChart[] = [
  {
    id: "cash-100bb-RFI-UTG",
    format: "cash",
    stackBB: 100,
    position: "UTG",
    scenario: "RFI",
    description: "Under the gun open-raise, 6-max.",
    actions: [
      {
        type: "raise",
        sizeBB: 2.5,
        range: "22+, A2s+, K9s+, QTs+, J9s+, T9s, 98s, 87s, 76s, 65s:0.5, AJo+, KQo, ATo:0.5",
      },
    ],
  },
  {
    id: "cash-100bb-RFI-HJ",
    format: "cash",
    stackBB: 100,
    position: "HJ",
    scenario: "RFI",
    description: "Hijack open-raise, 6-max.",
    actions: [
      {
        type: "raise",
        sizeBB: 2.5,
        range:
          "22+, A2s+, K8s+, QTs+, J9s+, T8s+, 97s+, 87s, 76s, 65s, 54s:0.5, ATo+, KJo+, QJo, KTo:0.5",
      },
    ],
  },
  {
    id: "cash-100bb-RFI-CO",
    format: "cash",
    stackBB: 100,
    position: "CO",
    scenario: "RFI",
    description: "Cutoff open-raise, 6-max.",
    actions: [
      {
        type: "raise",
        sizeBB: 2.5,
        range:
          "22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A9o+, KTo+, QTo+, JTo, A8o:0.5, K9o:0.5, J9o:0.5",
      },
    ],
  },
  {
    id: "cash-100bb-RFI-BTN",
    format: "cash",
    stackBB: 100,
    position: "BTN",
    scenario: "RFI",
    description: "Button open-raise, 6-max — widest opening range.",
    actions: [
      {
        type: "raise",
        sizeBB: 2.5,
        range:
          "22+, A2s+, K2s+, Q4s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 53s+, A2o+, K8o+, Q9o+, J9o+, T9o, Q8o:0.5, J8o:0.5, T8o:0.5, 98o:0.5, K7o:0.5",
      },
    ],
  },
  {
    id: "cash-100bb-RFI-SB",
    format: "cash",
    stackBB: 100,
    position: "SB",
    scenario: "RFI",
    description: "Small blind raise-first-in (3bb), 6-max.",
    actions: [
      {
        type: "raise",
        sizeBB: 3,
        range:
          "22+, A2s+, K4s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o:0.5",
      },
    ],
  },
];

// BB defending vs a 2.5bb button open: flat wide, 3bet a polar/linear mix.
const CASH_DEFENSE: PreflopChart[] = [
  {
    id: "cash-100bb-vsRFI-BB-vs-BTN",
    format: "cash",
    stackBB: 100,
    position: "BB",
    scenario: "BB vs BTN open",
    vsPosition: "BTN",
    description: "Big blind defending vs a button 2.5bb open: 3bet to 11bb or flat.",
    actions: [
      {
        type: "raise",
        sizeBB: 11,
        range: "JJ+, AJs+, A5s:0.5, A4s:0.5, KQs, KJs:0.5, AQo+, A5o:0.5, KJo:0.5, TT:0.4",
      },
      {
        type: "call",
        range:
          "22-TT, A2s-ATs, A5s:0.5, A4s:0.5, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 64s+, 53s+, 43s, A2o-AJo, K9o+, Q9o+, J9o+, T8o+, 98o, 87o, 76o",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// MTT — 40bb, 2.2bb opens (tighter offsuit than cash).
// ---------------------------------------------------------------------------

const MTT_40BB_RFI: PreflopChart[] = [
  {
    id: "mtt-40bb-RFI-UTG",
    format: "mtt",
    stackBB: 40,
    position: "UTG",
    scenario: "RFI",
    description: "40bb tournament UTG open (2.2bb).",
    actions: [
      {
        type: "raise",
        sizeBB: 2.2,
        range: "22+, A2s+, KTs+, QTs+, JTs, T9s, 98s, 87s, 76s:0.5, AJo+, KQo",
      },
    ],
  },
  {
    id: "mtt-40bb-RFI-HJ",
    format: "mtt",
    stackBB: 40,
    position: "HJ",
    scenario: "RFI",
    description: "40bb tournament hijack open (2.2bb).",
    actions: [
      {
        type: "raise",
        sizeBB: 2.2,
        range: "22+, A2s+, K9s+, QTs+, J9s+, T9s, 98s, 87s, 76s, 65s:0.5, AJo+, KQo, KJo:0.5",
      },
    ],
  },
  {
    id: "mtt-40bb-RFI-CO",
    format: "mtt",
    stackBB: 40,
    position: "CO",
    scenario: "RFI",
    description: "40bb tournament cutoff open (2.2bb).",
    actions: [
      {
        type: "raise",
        sizeBB: 2.2,
        range:
          "22+, A2s+, K7s+, Q9s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, ATo+, KTo+, QJo, A9o:0.5, KTo:0.5",
      },
    ],
  },
  {
    id: "mtt-40bb-RFI-BTN",
    format: "mtt",
    stackBB: 40,
    position: "BTN",
    scenario: "RFI",
    description: "40bb tournament button open (2.2bb).",
    actions: [
      {
        type: "raise",
        sizeBB: 2.2,
        range:
          "22+, A2s+, K3s+, Q6s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o+, K9o+, Q9o+, J9o+, T9o, 98o:0.5",
      },
    ],
  },
  {
    id: "mtt-40bb-RFI-SB",
    format: "mtt",
    stackBB: 40,
    position: "SB",
    scenario: "RFI",
    description: "40bb tournament small-blind raise-first-in (2.7bb).",
    actions: [
      {
        type: "raise",
        sizeBB: 2.7,
        range:
          "22+, A2s+, K4s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 75s+, 64s+, 54s, A2o+, K7o+, Q8o+, J8o+, T8o+, 98o, 87o:0.5",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// MTT — 20bb, 2bb opens (raise-or-fold; flatting collapses at this depth).
// ---------------------------------------------------------------------------

const MTT_20BB_RFI: PreflopChart[] = [
  {
    id: "mtt-20bb-RFI-UTG",
    format: "mtt",
    stackBB: 20,
    position: "UTG",
    scenario: "RFI",
    description: "20bb tournament UTG open (2bb).",
    actions: [
      {
        type: "raise",
        sizeBB: 2,
        range: "22+, A2s+, KTs+, QTs+, JTs, T9s, 98s, AJo+, KQo",
      },
    ],
  },
  {
    id: "mtt-20bb-RFI-HJ",
    format: "mtt",
    stackBB: 20,
    position: "HJ",
    scenario: "RFI",
    description: "20bb tournament hijack open (2bb).",
    actions: [
      {
        type: "raise",
        sizeBB: 2,
        range: "22+, A2s+, K9s+, QTs+, JTs, T9s, 98s, 87s, AJo+, KQo, KJs:0.5",
      },
    ],
  },
  {
    id: "mtt-20bb-RFI-CO",
    format: "mtt",
    stackBB: 20,
    position: "CO",
    scenario: "RFI",
    description: "20bb tournament cutoff open (2bb).",
    actions: [
      {
        type: "raise",
        sizeBB: 2,
        range: "22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, ATo+, KJo+, QJo",
      },
    ],
  },
  {
    id: "mtt-20bb-RFI-BTN",
    format: "mtt",
    stackBB: 20,
    position: "BTN",
    scenario: "RFI",
    description: "20bb tournament button open (2bb).",
    actions: [
      {
        type: "raise",
        sizeBB: 2,
        range:
          "22+, A2s+, K5s+, Q7s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, A2o+, K9o+, Q9o+, J9o+, T9o",
      },
    ],
  },
  {
    id: "mtt-20bb-RFI-SB",
    format: "mtt",
    stackBB: 20,
    position: "SB",
    scenario: "RFI",
    description: "20bb tournament small-blind raise-first-in (2.2bb).",
    actions: [
      {
        type: "raise",
        sizeBB: 2.2,
        range:
          "22+, A2s+, K3s+, Q6s+, J7s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, A2o+, K7o+, Q8o+, J8o+, T8o+, 98o",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// MTT — 10bb push/fold (jam-or-fold), Nash-consensus shoving ranges.
// ---------------------------------------------------------------------------

const MTT_PUSH_FOLD: PreflopChart[] = [
  {
    id: "mtt-10bb-push-CO",
    format: "mtt",
    stackBB: 10,
    position: "CO",
    scenario: "Push/fold (jam)",
    description: "10bb effective cutoff open-shove.",
    actions: [
      {
        type: "all-in",
        range: "22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 76s, A6o+, K9o+, Q9o+, JTo",
      },
    ],
  },
  {
    id: "mtt-10bb-push-BTN",
    format: "mtt",
    stackBB: 10,
    position: "BTN",
    scenario: "Push/fold (jam)",
    description: "10bb effective button open-shove.",
    actions: [
      {
        type: "all-in",
        range:
          "22+, A2s+, K3s+, Q6s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o+, K7o+, Q8o+, J8o+, T8o+, 98o",
      },
    ],
  },
  {
    id: "mtt-10bb-push-SB",
    format: "mtt",
    stackBB: 10,
    position: "SB",
    scenario: "Push/fold (jam)",
    description: "10bb effective small-blind open-shove vs big blind.",
    actions: [
      {
        type: "all-in",
        range:
          "22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 64s+, 53s+, 43s, A2o+, K5o+, Q7o+, J7o+, T7o+, 97o+, 87o, 76o",
      },
    ],
  },
  {
    id: "mtt-10bb-vsRFI-BB-vs-SB-jam",
    format: "mtt",
    stackBB: 10,
    position: "BB",
    scenario: "BB call vs SB jam",
    vsPosition: "SB",
    description: "Big blind calling range vs a 10bb small-blind open-shove.",
    actions: [
      {
        type: "call",
        range: "22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 87s, A4o+, K9o+, Q9o+, J9o+, T9o",
      },
    ],
  },
];

export const DEFAULT_CHARTS: readonly PreflopChart[] = [
  ...CASH_RFI,
  ...CASH_DEFENSE,
  ...MTT_40BB_RFI,
  ...MTT_20BB_RFI,
  ...MTT_PUSH_FOLD,
];

let loaded = false;

/** Register every shipped chart with the engine registry (idempotent). */
export function loadDefaultCharts(): void {
  if (loaded) return;
  for (const c of DEFAULT_CHARTS) loadChart(c);
  loaded = true;
}
