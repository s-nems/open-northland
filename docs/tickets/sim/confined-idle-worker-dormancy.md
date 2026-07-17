# Dormancy for confined idle workers (per-tick rescan cost under signpost confinement)

**Area:** sim (agents) · **Origin:** regression-fixes branch, 2026-07-16 · **Priority:** P2

With signpost navigation ON globally (the game fundament), a worker whose targets all sit OUTSIDE its
allowed area finds nothing, returns to idle, and re-runs its full drive ladder next tick — every
gated `nearest*` search again. Unconfined workers rarely idle (they find work and stay busy for many
ticks), so the planner's per-tick cost was effectively bounded by active work; confinement turns
whole crews idle and the sandbox scene's per-tick cost rose from ~0.7 ms to ~12 ms late-run
(measured: ~480 extra `InteractionCellIndex` scans/tick, ticks 2000–2300, 96×96, ~150 settlers).
Two point fixes already landed (`RING_MIN_BUCKETS` linear cutover for sparse indexes, construction-time
`staticCell` resolution — `cell-index.ts`); the remaining cost is the rescan-every-tick pattern itself.

Design a dormancy gate for confined idle settlers: a settler whose confined search came up empty can
skip re-planning until something it could react to changes — candidates: a coarse per-area change
counter (stockpile/resource/site generation per signpost group + local area), a per-settler backoff
(re-scan every N ticks while nothing changed, N small enough not to read as laziness), or memoizing
the failed search key. Constraints: byte-identical behavior for goldens where dormancy never elides a
non-empty scan; the `cachesCoherent` invariant must cover any new incremental cache; canonical
winners unchanged.

Verify with the sandbox scene timing (`packages/app` scene determinism test ran ~40 s under
confinement; target is back under ~15 s) and a fresh per-system profile over `dist/`.

The test budget now actually trips, so this is a red-build risk, not just slowness (observed
2026-07-17 from an unrelated render branch): a determinism case blew its `DETERMINISM_TIMEOUT_MS`
(120 s, `scenes.test.ts`) on a **cold**-cache `npm test`, while the same file alone, warm, passed in
91.6 s. CI runs cold, and a timeout there reads as a determinism regression — a false signal on the
golden rule 1 gate. Raising the budget is the wrong cure while the per-tick cost is the known cause.
