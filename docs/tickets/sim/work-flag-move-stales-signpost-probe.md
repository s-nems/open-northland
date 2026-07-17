# Invalidate the signpost placement probe when a work flag MOVES

**Area:** packages/sim · **Origin:** fix/evict-work-flag-from-footprint, 2026-07-17 · **Priority:** P3

`workFlagBlockerVersion` (packages/sim/src/systems/footprint/placement/work-flag.ts) keys on
`placementBlockerVersion(world)` plus `world.componentGeneration(DeliveryFlag)`. `componentGeneration`
bumps only on component add/remove/destroy (packages/sim/src/ecs/world.ts) — **not** on an in-place value
write, which `world.touch` logs for the snapshot clone cache only. A work flag relocating mutates its
`Position` in place on the same entity, so the version does not move.

The rule that key rests on is stated in `placement/blockers.ts` — buildings and resources never MOVE once
placed. A `DeliveryFlag` is the one blocker channel that does move, so it is exactly the case the
invariant does not cover.

The one consumer is `signpostProbe` (packages/sim/src/systems/signposts/placement.ts:80), memoized per
world and reached via `Simulation.signpostProbe`. After a flag moves, the memo keeps reporting the flag's
OLD cell as blocked and offers its NEW cell as free.

Scope-limited on purpose: this is **read-path only**. The `canPlaceSignpost` command gate re-scans fresh
(packages/sim/src/simulation.ts), so no sim decision and no state hash consults the stale set — the
symptom is a cosmetic lie in the signpost placement overlay/ghost until the next add/remove of any flag,
building, or resource bumps the version. It is pre-existing (`setWorkFlag`'s relocate branch has always
moved flags); `evictWorkFlagsFromFootprint` merely adds a second mover.

## Scope

Make a flag MOVE invalidate the probe. Two candidate approaches — pick one, do not do both:

- fold a per-world flag-move counter into `workFlagBlockerVersion` (bumped by `relocateWorkFlag` in
  packages/sim/src/systems/economy/flags.ts, the single relocate seam both movers already share), or
- key the memo on `world.mutationVersion`, which every `touch` already moves — simpler, but coarser: it
  invalidates on any entity mutation at all, so the memo would rebuild most ticks and lose most of its
  value. Measure before choosing this one.

Prefer the first unless measurement says otherwise. Do NOT reach for `componentGeneration` — it cannot
see an in-place write, which is the whole defect.

## Verify

`npm test`, `npm run check`, `npm run build`. Add a sim test that moves a flag (via `setWorkFlag` and via
a `placeBuilding` push-out) and asserts `Simulation.signpostProbe` reports the new cell blocked and the
old one free without any intervening add/remove. Goldens must not move — this is a read-path memo, so a
moved golden means the fix leaked into a sim decision.
