# The bench's world builder is a stale full copy of the sandbox scene

**Area:** app (bench) · **Origin:** sandbox-scene-budget branch rebase, 2026-07-17 · **Priority:** P3

The app cleanup split the live sandbox scene into `src/scenes/sandbox/` (placements + checks +
builders) but left the old `src/scenes/sandbox.ts` in place because `bench/world.ts` still imports
`buildSandboxSettlement`/`SANDBOX_SETTLEMENT_PITCH` from it — the tiling-capable builder the package
version dropped (its `buildVillage`/`buildResourceBase` lost the `ox`/`oy` offsets). The result is
two full copies of the authored settlement that can silently diverge; it already bit once — a
scene-budget edit landed in the dead copy and rebased green while the live scene kept the old value.
It also violates the bench contract in `packages/app/AGENTS.md` ("its world is built from the
acceptance scenes' builders — extend those rather than growing a second world-builder here").

Fix: re-expose an offset-taking `buildSandboxSettlement(sim, ox, oy)` (and the pitch constant) from
`src/scenes/sandbox/`, point `bench/world.ts` at it, and delete `src/scenes/sandbox.ts`. The bench's
tiled world hash will move (the package version's placements/graphics differ slightly from the stale
copy) — that is the intended one-time re-baseline, not a regression; state the new
`ON_BENCH_SETTLEMENTS=1` hash in the commit.

Verify: `npm run bench:sim` runs and its determinism case passes; `npm test` green; no importer of
`scenes/sandbox.js` remains (`grep -rn "scenes/sandbox.js"`).
