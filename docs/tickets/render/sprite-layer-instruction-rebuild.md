# Cut the Pixi instruction rebuild and buffer re-upload of the moving sprite layer

**Area:** render · **Focus:** world-renderer · **Priority:** P2 · **Complexity:** high

While the game runs, Pixi rebuilds the sprite render group's instruction set and re-packs and
re-uploads its vertex buffers; paused, it does neither. A moving on-screen unit rewrites `zIndex`
(`SpritePool.reconcile`), which re-sorts and re-builds the group it sits in, and the rebuild repacks
every quad of the group through `WorldBatcher.packQuadAttributes` (`gpu/world-batcher.ts`).

Measured in the live late-game session (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`, main-thread CPU, t82k,
1920x1080, speed 10): `collectRenderables` 17% and `_buildInstructions` 19% of the main thread, both
gone when paused; 590 buffer uploads and 1.9 MB of `bufferSubData` per frame at x3, none paused;
`packQuadAttributes` and its inlined callees allocate 196 MB per 10 s; about 1500 draw calls a frame
running or paused, with `bindVertexArray` and `bindTexture` 1 to 2.6% self each.

## Scope

- Measure first per candidate with a page-side wrapper around `_buildInstructions`, `sortChildren` and
  the batcher (`window.__opennorthland.renderer` exposes the layers): how often the group rebuilds per
  tick and per frame, and what share of its quads actually moved.
- Rebuild only what moved: fewer nodes under the sprite layer (each pooled entity is a `Container`
  holding its layer sprites, each tall map object a `Sprite` plus a shadow twin), a depth order that
  does not dirty the whole group when one unit steps, or static and moving content in separate groups.
- The batcher allocates nothing per quad and uploads only the ranges that changed.
- Say why a frame needs about 1500 draw calls (texture or atlas-page breaks, blend or shader changes)
  and cut the largest cause if it is in this layer.
- `PalettedSprite.place` calls `vars.update()` unconditionally, so every settler mesh re-uploads its
  placement UBO every frame; skip an unchanged one.
- Painter order and fog gating stay identical; `?shot` captures stay pixel-identical.

## Verify

- Running main-thread ms per frame at x3 over the reference's dense settlement falls toward the paused
  floor; uploads and draw calls per frame in the closing report.
- `npm test`, `npm run check`, `npm run build`, plus human review of one live session.
