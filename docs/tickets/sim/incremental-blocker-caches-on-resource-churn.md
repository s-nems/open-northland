# Maintain the work-flag standing blocker set incrementally across resource churn

**Area:** sim · **Origin:** AI-player perf pass on magiczny_las, 2026-07-17; narrowed 2026-07-18 after
main's incremental-memo pass landed · **Priority:** P2
(perf — no behavior change; every winner must stay byte-identical)

## Context

`workFlagPlacementBlocks` (`footprint/placement/work-flag.ts`) memoizes the work-flag/signpost
standing blocker set (`blocksMemo` → `buildBlocks`) on `workFlagBlockerVersion`, which folds in the
`Resource` / `ResourceFootprint` component generations. So **every felled tree or depleted node
invalidates the memo and the next consumer pays a full ~17k-resource `eachBlockerCell` rebuild**
(~10 ms on magiczny_las). With active gatherers a removal lands every few seconds, so the hit rate
stays low exactly when the AI is playing, and these rebuilds show up as the bulk of the remaining
`aiPlayer`-decision spikes.

Main's incremental-memo pass (membership journal + per-world memos, 2026-07-18) already handled the
sibling caches this ticket originally also named: `resource-tile-cache.ts` is now maintained
incrementally on the stamp/unstamp seam, and the building walk-block overlay
(`building-blocked-cache.ts`) keys on the `Building` generation, so resource churn no longer touches
it. The work-flag standing set is the one that still throws everything away per removal.

`resourceBlockedCells` (`footprint/resource-blocked-cache.ts`) is the pattern to copy: entries
added/removed per resource on the `stampResourceFootprint`/`unstampResourceFootprint` seam with
per-cell reference counts, a registered `verifyCaches` coherence check, and a full-rebuild fallback
for direct store mutations.

## Scope

- Split the resource contribution of the work-flag standing set out of the version-keyed full
  rebuild and maintain it incrementally on the stamp/unstamp seam (per-cell reference counts),
  leaving the building/signpost contribution on its current version key.
- Keep coherence checking: extend `verifyBlocksMemo` (or add a sibling) under `verifyCaches` so a
  missed stamp trips in tests.
- Determinism: the set is membership only — no picks — so incremental maintenance cannot move a
  winner; goldens must not move.

## Done when

- Felling one tree no longer triggers a full resource-store rescan on the work-flag/signpost
  placement paths.
- `npm test` green, zero golden movement; the map profile shows the AI-decision p95 spike gone.
