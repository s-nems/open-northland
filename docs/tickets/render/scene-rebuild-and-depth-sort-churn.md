# Bound the per-tick depth sort of the scene rebuild

**Area:** render · **Focus:** data/scene · **Priority:** P3 · **Complexity:** medium

The scene build (`collectScene`, `data/scene/sprite-scene.ts`) now takes its candidates from the
snapshot's position index over the viewport, so its collection scales with the screen; the depth sort
(`items.sort((a, b) => a.depth - b.depth || a.ref - b.ref)`) still re-sorts the whole visible set on every
rebuild and allocated ~126 KB of sort scratch per rebuild (566 MB over 45 s of allocation sampling on the
fortress at tick ~48k, x3, ~1500 drawn items). The scene cache (`gpu/sprite-pool/scene-cache.ts`) keys on
snapshot identity, so the rebuild runs once per sim tick, 36 times a second at x3, even though most items
keep their depth between ticks. In the late-game `krwawa_rzeka` session
(`docs/perf/heavy-load-krwawa-rzeka-12ai.md`, t82k, speed 10) `collectSpriteScene` is 5% of the main
thread, nearly all of it the viewport query `positionedWithin`.

## Scope

- Measure first with `?debug=trace` how the rebuild splits between item assembly and the sort at ~1500
  items, and how many items actually change depth or membership between consecutive ticks.
- Bound the sort: an insertion-style or bucketed depth order that reuses the previous list when
  membership is unchanged, or a collection pass that writes into retained `MutableSpriteDrawItem`
  records instead of fresh ones. The draw order must stay identical to the current comparator,
  including the `ref` tie-break.
- The sprite pool keeps an entity's bind while its draw item is the same object
  (`gpu/sprite-pool/bind-stamp.ts`), so a retained record whose fields change must not stay the same
  object.

## Verify

- The same profile shows the sort at a fraction of its current share and the per-rebuild scratch
  allocation gone; `perf().draw` at x3 falls or holds.
- `npm test`, `npm run check`, `npm run build`; `?shot` captures of a dense settlement unchanged.
