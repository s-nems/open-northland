# Stop allocating a fresh layer list per pooled entity per frame

**Area:** render · **Focus:** gpu/sprite-pool · **Priority:** P2 · **Complexity:** medium

`resolveLayers` (`gpu/sprite-pool/resolve-layers.ts`) returns a new `ResolvedLayer[]` for every pooled
entity on every frame, and its per-kind resolvers (`resolveCharacterLayers`, `resolveDecorLayers`,
`resolveStockpileLayers`, `layeredLayersWithShadow`) allocate the layer records inside it. Allocation
sampling of the fortress map at tick ~48k (13 AI seats, ~1500 drawn items, speed x3, Playwright Chromium
with `HeapProfiler.startSampling` including collected objects) attributed 984 MB of 7837 MB sampled over
45 s to `resolveLayers` alone, the single largest allocation site in the whole client, ahead of the sim
tick. The heap is not leaking (post-GC growth is 3 MB per 120 s), but ~174 MB/s of churn keeps the
collector busy inside the frame budget, and the same probe showed 5% of frames missing a vsync at x3.

## Scope

- Reuse per-entity layer storage across frames: keep a mutable layer list on the `PooledEntity` and
  have the resolvers write into it, or return layer data through a reused scratch buffer that the
  binder consumes before the next entity resolves. The binder's `bind`/`bindPlainLayer` must keep
  comparing against the previous frame's layers, so whatever is retained must preserve that check.
- Keep the resolved layer order and every field byte-identical; the `?shot` captures and the sprite
  scene tests must not move.

## Verify

- Repeat the allocation sampling on the same world at x3: `resolveLayers` self allocation drops by
  an order of magnitude and total churn falls accordingly; `perf().draw` per frame does not rise.
- `npm test`, `npm run check`, `npm run build`; a `?shot` comparison of a populated view before and after.
