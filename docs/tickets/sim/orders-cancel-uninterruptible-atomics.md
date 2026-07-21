# Preserve non-interruptible atomics across player and AI orders

**Area:** sim · **Priority:** P2

`moveUnit` (`systems/orders/movement.ts`) and `setJob` (`systems/orders/work.ts`) both call
`world.remove(e, CurrentAtomic)` unconditionally. `movement.ts` already names this as a deferred
refinement in a comment ("A non-interruptible-atomic exception is a deferred refinement").

This is a whole class of bug, not one case. The instance that surfaced: the `guideBuild` AI module
re-ordered its scout every 24-tick decision beat, and each order destroyed the scout's half-eaten
meal, so a hungry scout ate forever and never fed. That was fixed at the caller
(`ai-player/signpost-coverage.ts` and `ai-player/workforce.ts` now skip a settler with a
`CurrentAtomic`), which closes the observed symptom but not the class — any other order source can
still eat a swing. Evidence from the same run: placing ONE signpost took two full 15-tick
`viking_scout_build_guide` swings, because the AI re-ordered the scout mid-swing.

The data already carries the answer. `atomicanimations.ini` marks clips `interruptable 0/1`, it is
extracted (`AtomicAnimation.interruptible`), and `readviews/animations.ts` exposes
`isInterruptibleAtomic`. The scout's own build-guide clip is `interruptable 0`; the outdoor sleep is
`interruptable 1`.

## Scope

- Honour `isInterruptibleAtomic` in `moveUnit` and `setJob`: a non-interruptible atomic runs to
  completion instead of being discarded mid-swing.
- Retain one pending gameplay order and apply it after completion; a newer order replaces an older
  pending one. This latest-order-wins policy is a named approximation and must stay in hashed state.

**Source basis:** `DataCnmd/atomicanimations12/atomicanimations.ini` `interruptable` rows, already
decoded into the IR.

## Verify

- `npm test`; behaviour change → **goldens move intentionally**, name the mechanic in the commit.
- A headless case per order source: a settler mid-uninterruptible-atomic keeps it under `moveUnit`
  and `setJob`.
