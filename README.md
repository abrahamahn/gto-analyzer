# poker

Personal NLHE cash and tournament study tool. Two surfaces in one local app:

1. **Hand history analyzer** — drop a CoinPoker `.txt` export in (or upload via the web UI), get every decision graded against a solver-ish solution, see a leak report, replay hands.
2. **Manual spot trainer** — review cash and tournament preflop charts now; postflop spot input will add solver frequencies, equity, and EV.

## What this is NOT

This project does **not** read live game state during a hand, does not hook into the CoinPoker client, does not auto-play, and is not a HUD. Software that watches an in-progress hand and computes solutions is RTA (Real-Time Assistance), which violates CoinPoker's ToS and constitutes cheating against other players at the table. That scope is permanently out of scope here and pull requests adding it will be rejected.

Sanctioned inputs: `.txt` hand history files **after a session ends**, manually entered spots.

## Quick start

```sh
pnpm install
pnpm dev
```

Open the web UI at the URL printed by Vite.

## Layout

```
apps/
  server/        # Fastify + better-sqlite3 — local HTTP server, hand history storage
  web/           # Vite + React + TanStack Router — UI
packages/
  shared/        # Zod domain schemas
  parser/        # CoinPoker .txt → typed Hand[]
  engine/        # equity, EV, decision grading, preflop charts
  solver/        # WASM postflop-solver wrapper (b-inary's postflop-solver)
tools/
  sample-hands/  # Drop your CoinPoker exports here for parser tests (gitignored)
```

## Licensing

This project is **AGPL-3.0-only** because it links to [`postflop-solver`](https://github.com/b-inary/postflop-solver) (AGPL-3.0). If you distribute a built binary of this project, fork it, or run a modified version as a network service, you must publish the full corresponding source under AGPL-3.0. For personal local use this has no practical effect.

If you want a non-AGPL license, the solver can be swapped (`packages/solver` is the integration boundary); without a solver you only lose the postflop deep-dive feature.
