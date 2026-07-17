# Give TextureCache's one-frame-one-source invariant teeth

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-17 · **Priority:** P3

`gpu/texture-cache.ts` keys its caches by the `AtlasFrame` object alone and states the invariant that
makes that sound: "Each frame belongs to exactly one atlas→source, so keying the cache by the frame
object is 1:1." `get(source, frame)` **ignores `source` on a cache hit**, so the invariant is the only
thing keeping the lookup correct.

It is load-bearing: `gpu/map-objects/tall-blocks.ts` legitimately pushes two different sources (the bob
atlas and its shadow twin) through the same cache in one call site, and relies on the frames being
distinct objects.

It is also violable by an existing API. `gpu/synthetic-atlas.ts` `syntheticAtlasFrames()` hands out the
**same module-level frame objects** on every call, while `createSyntheticAtlasSource()` mints a **new
CanvasSource** each call. Two synthetic sheets in one page would share frame keys across two distinct
sources, and the cache would serve page A's texture for page B with no error anywhere. No caller does
this today (`app/src/content/sprite-sheet/resolve.ts` builds one per entry), so it is latent.

Prose is doing a guard's job.

## Scope

Pick one — do not do both:

- **(a, preferred)** Store the minting source beside the cached texture and assert it matches on a hit.
  Cheap, keeps the 1:1 key, and turns the documented invariant into a caught error.
- **(b)** Key the caches by `(source, frame)` nested. Removes the invariant entirely but costs an extra
  Map lookup on the per-frame texture path (5 callers) — needs a perf eye before taking it.

Either way the comment shrinks to the fact it is stating.

## Verify

`npm test` (texture-cache, sprite-pool, map-object suites), `npm run check`, `npm run build`. Behaviour-
preserving for every current caller — if a test trips the new assertion, that is a real 1:1 violation
worth reporting, not silencing.
