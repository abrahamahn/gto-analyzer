# charts

Preflop solver outputs serialized as JSON, one per scenario × position × stack depth.

First chart pack (target for Phase 3): `100bb-6max.json`
- 6-max table, 100bb effective
- Scenarios: RFI, vs-RFI-call, vs-RFI-3bet, vs-3bet-call, vs-3bet-4bet
- Source: any reputable public GTO solution (GTOWizard free tier, MonkerSolver dump, or hand-curated)

Format matches `PreflopChart` in `../charts.ts`. Hands keyed as `"AKs"`, `"QQ"`, `"T9o"` (13×13 = 169 classes).
