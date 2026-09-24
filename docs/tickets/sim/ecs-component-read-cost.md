# Cut the fixed cost of every component read

**Area:** sim · **Focus:** ecs · **Priority:** P2

Every system pays a flat tax per component read, and it grows with the settlement because reads do.
On `magiczny_las_12_players` with 13 AI seats (240x190 cells), the trust-clean `npm run bench:profile`
from the 40k checkpoint (900-922 settlers, 210 buildings; profiled timings are inflated by the
sampler) puts `packages/sim/src/ecs/world.ts` at 9.3% of all self time (7.2 s of 77.5 s over 4,000
ticks). `World.storeOf` alone is 4.1% self there, next to `tryGet` 1.7%, `has` 1.3% and `get` 1.1%; the
busy-machine profiles from 30k, 50k and 60k show `storeOf` at the same 4.1-4.7% share, the second
heaviest self function at 50k and 60k. No caller owns it: walking the 40k call tree, the heaviest
caller file (`systems/settlers/targets/resources.ts`) carries 7.4% of the ECS self time and forty files
carry 0.5% or more, so holding a store reference in a few hot loops would not move it.

- `World.storeOf` resolves the store through `this.stores.get(component)`, a `Map` keyed by the
  component object, on every `get`, `tryGet`, `has`, `mut` and `tryMut`, before the entity lookup. A
  microbenchmark of the same two-level shape (130 components, 1,000-entity stores) reads in 21 ns,
  against 13 ns when the store comes from an array indexed by a per-component integer; the profile's
  near-even split between `storeOf` and the entity-level accessors matches that ratio.
- `contentIndex` (`core/content-index.ts`) probes a `WeakMap` keyed by the `ContentSet` on every
  call: 1.2% self at 40k (1.1-1.2% at every checkpoint), called per settler from read views such as
  `isHeroJob`, `isSoldierJob`, `isFood`, `isHunterJob` and `isScoutJob`, and a quarter of it from
  `technologySystem`.
- Hot component values leave V8's fast-property mode. `movementSystem` (`systems/movement/system.ts`)
  runs `delete pf.legPace` and `delete pf.departureCharged` at every waypoint, and the harvest effects
  in `systems/settlers/atomics/effects/goods/` delete optional fields of `CurrentAtomic`
  (`harvest-burst.ts`) and `Resource` (`harvest.ts`). A world restored at the 50k checkpoint has no
  dictionary-mode component value; 150 ticks later 376 of 436 `PathFollow` values and 16 of 190
  `CurrentAtomic` values are in dictionary mode (`%HasFastProperties` under
  `--allow-natives-syntax`). Each property read of such a value is a hash lookup and every reader
  sees two shapes. That share is not measured separately.

Expected gain: about 1 ms of the 18.7 ms tick at 40k (`storeOf` 0.8 ms, `contentIndex` 0.2 ms), plus
the unmeasured dictionary-mode share.

## Scope

- Resolve a component's store through a dense integer the component carries, assigned by
  `defineComponent` (already process-unique by name), indexing an array on the `World`. Registration
  order, per-store insertion order and save layout must not change: they are the query, hash and save
  contracts.
- Hand per-tick callers the content index without the `WeakMap` probe, through `SystemContext` or an
  identity check in front of the `WeakMap`.
- Keep stored component values in fast mode: clear an optional field by assigning `undefined` instead
  of `delete`, and make the state-hash and sync-digest walk (`mixValue` and `sortedKeys` in `core/`)
  and save export treat an `undefined`-valued key as absent, so no existing state hashes differently.
  Confirm first that no component stores an `undefined`-valued key today; if one does, that golden
  moves and the commit names it.
- Before switching a field, audit every reader that tells a present key from an absent one: `in`,
  `Object.keys`, `Object.entries`, `hasOwnProperty` and spread over component values, and the clone
  and snapshot paths (`clonePlain` and the clone cache in `inspect/snapshot.ts`, `save/export.ts`).
  Each must treat an `undefined`-valued key as absent, or the field keeps its `delete`.
- Pure cost work otherwise: the state hash must stay identical.

## Verify

- Unit: query order, `forEachStore` order and a save export of a populated world are unchanged; a
  record with an `undefined`-valued key hashes, digests, clones and snapshots like the same record
  without the key.
- A probe under `--allow-natives-syntax` over a restored checkpoint stepped a few hundred ticks finds
  no dictionary-mode component value.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: the tick median falls by roughly the
  `storeOf` share, with the state hash unchanged. `npm run bench:profile` from the same mark no longer
  lists `storeOf` or `contentIndex` in the top 40 by self time.
- `npm test`, `npm run check`, `npm run build`.
