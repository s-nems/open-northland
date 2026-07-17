# Maintain the blocker/tile caches incrementally across resource add/remove churn

**Area:** sim · **Origin:** AI-player perf pass on magiczny_las, 2026-07-17 · **Priority:** P2
(perf — no behavior change; every winner must stay byte-identical)

## Context

Three derived caches are keyed (directly or via `placementBlockerVersion`) on the `Resource` /
`ResourceFootprint` component generations, so **every felled tree or depleted node throws the whole
cache away** and the next consumer pays a full ~17k-resource rebuild:

- `standingFlagBlocks` (`footprint/placement/work-flag.ts`) — the work-flag/signpost standing
  blocker set (~10 ms on magiczny_las),
- the building placement grid memo (`footprint/placement/building.ts`),
- `deriveResourceTileCache` (`footprint/resource-tile-cache.ts`).

Measured with one AI seat on magiczny_las (2026-07-17, 2400 ticks): these rebuilds are the bulk of
the remaining `aiPlayer`-decision spikes (~10–15 ms each) and show up as ~1.5 s total self time in a
CPU profile. With active gatherers a removal lands every few seconds, so the memo hit rate stays low
exactly when the AI is playing.

`resourceBlockedCells` (`footprint/resource-blocked-cache.ts`) already shows the fix: entries are
added/removed per resource on the `stampResourceFootprint`/`unstampResourceFootprint` seam with
per-cell reference counts, a registered `verifyCaches` coherence check, and a full-rebuild fallback
for direct store mutations.

## Scope

- Apply the `resourceBlockedCells` pattern to the resource contribution of the three caches above:
  incremental add/remove on the stamp/unstamp seam, count-based cell removal, `verifyCaches`
  registration, full-rebuild fallback when the generation moved without a stamp event.
- Building/signpost contributions can stay rebuild-on-generation (their stores are small and churn
  rarely); split each cache into layers if that keeps it simplest.
- Determinism: caches are membership sets — no picks — so incremental maintenance cannot move a
  winner; goldens must not move.

## Done when

- Felling one tree no longer triggers any full resource-store rescan on the placement/flag paths.
- `npm test` green, zero golden movement; `bench:sim` / the map profile shows the AI-decision p95
  spike gone.
