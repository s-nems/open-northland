# Bound the sprite-pool per-frame scans (O(pooled) → O(visible))

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-12

The render contract is "per-frame cost tracks the SCREEN, not the map". Two pool
scans are O(pooled), not O(visible), and `pool` grows to every entity ever on-screen
(it only shrinks on death), so after panning a big map these exceed the visible set:

- `gpu/sprite-pool/sprite-pool.ts` `reconcile` iterates `this.pool.values()` for the
  detach loop, plus `reconcileSprites(scene.liveRefs, this.pool.keys())` — both
  O(pooled). `collectSpriteScene` itself is the O(entities) cull `AGENTS.md` already
  flags as a known seam; the detach scan over `pool.values()` is a SEPARATE O(pooled)
  cost.
- `placePalettedFor` scans `this.pool.values()` (O(pooled)) to place O(visible) meshes
  (only while a portrait is open — bounded, but still a pooled-size scan).

The real fix is the `ScreenMap`-style spatial index `AGENTS.md` names as the future
seam (query = O(visible)): index pooled entities by cell so reconcile/detach/place
iterate only what the viewport frames. Investigate-first — study OpenRA's `ScreenMap`
(the reference this renderer is modelled on) before designing.

## Scope

Add a spatial index over the pooled entities keyed by cell/region, and drive
reconcile's detach loop + `placePalettedFor` off the visible query instead of the
whole pool. Keep `reconcileSprites`'s pure, tested bookkeeping; the index is the new
input to it. Prove `drawn ≪ pooled` scans in the perf overlay after a long pan.

## Verify

`npm run build`, `npm test` (sprite-pool, reconcile, motion, world-renderer suites).
Headless Chromium is CPU WebGL — use it only to confirm the scan count drops
(`drawn ≪ pooled`), NOT for FPS. Real-GPU frame-rate needs human sign-off.
