# The sandbox scene test fails on main — it has outgrown its 60s budget

**Area:** app · **Origin:** review battery on refactor/render-cleanup, 2026-07-17 · **Priority:** P2

`packages/app/test/scenes.test.ts > acceptance scenes > sandbox` times out at its 60s budget. It is a
**timeout, not an assertion** ("If this is a long-running test, pass a timeout value…"), and it hits both
sandbox cases (`satisfies its mechanic checks…` and `is byte-identical from the same seed`).

**It reproduces on clean `main`.** Measured 2026-07-17 in the primary checkout at `51ab78f1`, with no
branch applied:

```
npx vitest run --root . packages/app/test/scenes.test.ts
  Tests  1 failed | 19 passed (20)
  FAIL  … > sandbox > is byte-identical from the same seed (determinism)
```

So `npm test` is red on main right now. This is not a flake to wait out: against merge-base `38a7eae3`
earlier the same day the file passed 20/20 in isolation and `sandbox` measured ~58s against the 60s
budget — main's subsequent work pushed it over. The margin was always the bug; the failure is the margin
finally closing.

Left unfixed, this trains the next agent to wave a red `npm test` through, which is exactly how a real
regression lands unnoticed.

## Scope

Find where the time goes before touching the budget — a bigger number is the wrong fix if the scene got
slow by accident, and `git log 38a7eae3..main` is a short suspect list (the A* per-node allocation
change, the hostile-presence grid, the half-cell conversion move, the event-locating change). Bisect
against the scene's runtime rather than guessing.

Profile per-system with `npm run bench:sim` (median/p95 ms per system over an RTS-scale headless world;
`ON_BENCH_SETTLEMENTS`/`ON_BENCH_FIGHTERS` scale the population, `ON_BENCH_JSON` writes the report).
Never add `performance.now` to `src` — the hygiene scan fails the build; the timer belongs in the caller
behind `Simulation.setInstrument`.

Then either cut the cost, or — if the runtime is legitimately what the scene now needs — raise the
timeout to 2–3× the measured isolated time and say in a comment why the scene is slow.

While there: `scenes.test.ts` runs every registered scene in one file, so its total grows with each new
scene and one slow scene starves the rest. Consider a file per scene.

## Verify

`npm test` green three runs in a row, including under a full parallel run. State the measured per-scene
times in the commit so the next person has a baseline.
