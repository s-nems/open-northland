# Memoize the work-flag placement blocked set per blocker version

**Area:** sim · **Origin:** split from work-flag-placement-whole-map-scan (done 2026-07-18) ·
**Priority:** P3

`workFlagPlacementBlocks` (`packages/sim/src/systems/footprint/placement/work-flag.ts`) rebuilds the
whole Resource/Building/DeliveryFlag/Signpost blocker set on every call. Its callers pay that per
command: `canPlaceWorkFlag` once per `setWorkFlag`/`placeSignpost` gate, `nearestWorkFlagPlacement`
once per employment command (the whole-map scan there is gone — the rebuild is what remains). A
50-settler box-select `setJob` still performs 50 blocker-set rebuilds in one tick.

Memoize the set per `workFlagBlockerVersion` (the pattern `memoizedPlacementGrid` establishes for the
building rule). The former blocker is gone: since 2026-07-18 the version folds in a per-world
flag-MOVE counter (`noteWorkFlagMove`, bumped by the `relocateWorkFlag` seam), so a relocation
invalidates version-keyed memos. These are command gates and sim decisions, so the memo key being
complete is load-bearing — a stale set would be a state-hash divergence, not a cosmetic lie; keep the
invalidation test coverage (`test/signposts/probe-invalidation.test.ts` pins the counter) in mind.

Note the `ignoreFlag` variant (`canPlaceWorkFlag` during a relocate) keys differently — either
memoize only the no-ignore set and keep the ignore path fresh, or fold `ignoreFlag` into the cache
key.

## Done when

- One blocked-set build per `workFlagBlockerVersion` bump across a command burst, verified by a test
  that a flag add/remove/MOVE each invalidates the memo.
- `npm test` green with zero golden movement; register the cache in `World.verifyCaches()` if it
  becomes incrementally maintained rather than rebuild-on-version-bump.
