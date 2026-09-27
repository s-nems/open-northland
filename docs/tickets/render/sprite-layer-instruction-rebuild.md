# Cut the per-tick instruction rebuild of the sprite layer

**Area:** render · **Focus:** world-renderer · **Priority:** P2 · **Complexity:** high

While the game runs, Pixi rebuilds the sprite render group's instruction set on every tick and
re-uploads its whole vertex buffer; paused, it does neither. A moving unit rewrites its `zIndex`
(`SpritePool.presentPooled`), which flags the group's structure dirty, so the next render sorts,
re-collects and re-packs every node in it.

Measured over the late-game reference's dense settlement (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`,
the t80k checkpoint, 1920x1080, x3, Apple M2 Pro): one rebuild per delivered tick, 0.45 to 0.65 a
frame, at about 3 ms each (1.5 to 2 ms a frame, 11% of main-thread samples). The layer holds about 1870
entity containers and 4170 drawn sprites. About half of a rebuild is Pixi's `collectRenderables` walk,
a third the batcher's `break` and pack, and about 1 MB of vertex data goes up per rebuild. Across runs
the drawn order held in 18 to 45% of rebuilds (30 to 60 `zIndex` writes a frame); a rebuild with the
same order and no added, removed or hidden node is avoidable outright.

## Scope

- Skip a rebuild whose drawn order held. Pixi's `zIndex` setter flags the structure dirty on any
  change, and map objects, marks and the placement ghost order themselves through it too.
- Rebuild only what moved: re-sort and re-pack the elements whose rank changed, and upload that range,
  instead of Pixi's whole-group rebuild. Mostly static content (buildings, piles, trees) dominates the
  node count, so a split that keeps it out of the per-tick walk is the other lever.
- Painter order and fog gating stay identical; `?shot` captures and a paused checkpoint frame with
  enhanced sampling off stay byte-identical.

## Verify

- A page-side wrapper around `_buildInstructions` and the GL buffer calls, at x3 over the same frame:
  rebuild ms and uploaded bytes per frame fall toward the paused floor (render 1.3 ms, update 1.8 ms a
  frame).
- `npm test`, `npm run check`, `npm run build`, plus human review of one live session.
