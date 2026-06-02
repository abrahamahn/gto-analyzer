# sample-hands

Drop CoinPoker `.txt` hand history exports in this directory. They're gitignored so they won't be committed.

The parser test suite picks them up automatically.

## How to export from CoinPoker

(Fill in once verified against a real client — placeholder steps:)

1. CoinPoker desktop client → Settings → Hand History
2. Enable "Save hand histories to disk"
3. Note the export folder; copy the latest `.txt` into this directory

Once at least one real file is here, run:

```sh
pnpm --filter @poker/parser test
```

to validate the parser against your real data.
