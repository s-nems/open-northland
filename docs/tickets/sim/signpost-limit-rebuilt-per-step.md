# Share a signpost confinement across settlers and answer it without a scan over the posts

**Area:** sim · **Focus:** signposts · **Priority:** P3

`networkLimitAt` (`systems/signposts/network.ts`) builds a settler's confinement from scratch: a `Set`
of caught groups, the `inRange` post list, a `NodeBox` per caught post, their union and an `allowsNode`
closure that tests the node against the settler's own disc and then every caught post with
`hexDistanceBetween`. `navigationLimitFor`'s memo keys on the settler's exact node, so every step of a
walker rebuilds it; the main caller is `seeksShelterEnRoute` from `releaseStaleIntent`. The per-call
cost grows with the AI seats' signpost lattices.

Measured on `krwawa_rzeka`, 12 AI seats, t100k (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`): 749
`allowsNode` calls a tick over 58 posts each, 43 000 `hexDistanceBetween` a tick (t80k: 433 calls over
46.5 posts); `allowsNode` is 2.35% of the sim inclusive and most of `hexDistanceBetween`'s 2.8% self.
`networkLimitAt` allocates 223 KB a tick, 25 KB of it promoted, since a memo entry lives until its
settler moves.

## Scope

- The caught posts and their union bounds are cached per (player, signpost network revision, caught
  group set); a settler's call reuses the cached answer when its caught groups match.
- `allowsNode` is the own-disc test or a lookup in a coverage bitmap built lazily per cached answer,
  not a loop over the posts; no closure per call.
- Hash-identical: the same nodes are allowed.

## Verify

- State hash unchanged over 2000 ticks from the reference's t100k checkpoint; the signpost tests pass.
- `allowsNode` cost and `hexDistanceBetween` calls per tick (temporary counter) and `networkLimitAt` KB
  per tick in `ON_BENCH_PROFILE=alloc`, against the numbers above.
- `npm test`, `npm run check`.
