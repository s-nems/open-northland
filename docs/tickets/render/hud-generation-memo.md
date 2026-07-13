# Memoize the HUD build per snapshot generation

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-12 ·
**Blocked by:** [finish-packaging-splits](finish-packaging-splits.md) · **Priority:** P3

`data/hud.ts` `buildHud` fully rebuilds the HUD model every call — it builds two
`Map`s, spreads them to arrays, and sorts — and `layoutHud`/`placeHud` allocate row
arrays per call. It runs per frame, but the snapshot only changes per tick, so
(unlike `FogGhostStore`, which memoizes on `FogView.generation`) the HUD has no
tick/generation memo and re-does the whole aggregation every frame.

## Scope

Add a per-snapshot (or per-tick + per-selection) memo so `buildHud` reuses its last
result while the inputs are unchanged, mirroring `data/fog-ghosts.ts`
`FogGhostStore.update`'s generation-keyed cache. Key on what the HUD actually reads
(the snapshot identity + the selected/tribe inputs the caller passes). Keep it pure
and behavior-preserving — the memo returns the same model, never a stale one across
a real input change. Best done together with, or after, the `data/hud.ts`
model/layout/place split (see finish-packaging-splits.md).

## Verify

`npm run build`, `npm test` (hud + hud-layer suites — add a memo hit/miss test),
`npm run check`. HUD is visual — `npm run shot` to confirm the panel still reads
correctly; human sign-off.
