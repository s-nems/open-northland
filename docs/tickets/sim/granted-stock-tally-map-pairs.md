# Stop the assistant grant tally allocating a pair per store, player and good

**Area:** sim · **Focus:** settlers/planner · **Priority:** P2

`collectGrantedStock` walks `stores × players × goods` with `for (const [k, v] of map)` on both inner
levels. Destructuring Map entries mints a fresh `[key, value]` array per step, so the walk allocates on
the order of its whole iteration count each time it runs. It reads `held` only to write `held + units`
straight back, so the pair buys nothing.

Evidence: GC-inclusive heap sampling (both `includeObjectsCollectedBy*GC` flags on) of a headless
1500-tick window of the magiczny_las 6-AI session at tick ~28k attributes 7.1% of all sampled bytes to
this one function, ~819 MB. Once the ring-search allocation landed it became the largest site outside
the per-tick spatial index builds.

## Scope

- Walk something that yields no pair per step: a flat array of the granted goods built once per pass is
  the only shape guaranteed to drop both the pair and its iterator result, since a `keys()` walk still
  goes through a Map iterator. Keep the tally result and its player/good order identical.
- Non-goals: changing what the tally counts, its reserve rule, or the dispatch that reads it.

## Verify

- Repeat the same GC-inclusive heap sampling on one box: the `collectGrantedStock` row drops to noise.
- Goldens byte-identical; `npm test`, `npm run check`, `npm run build`.
