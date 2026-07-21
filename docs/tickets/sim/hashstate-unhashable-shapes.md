# Fail loudly on unhashable value shapes in `hashState()`

**Area:** sim · **Priority:** P3

`hashValue` (`packages/sim/src/simulation.ts`) dispatches on number, string, boolean,
null/undefined, array, `Map`, then a `typeof v === 'object'` fallback that walks `Object.keys`. Value
shapes outside that set mix **nothing** into the hash — silently, exactly the hole the string branch
closed:

- A `Set` reaches the object fallback and `Object.keys(new Set([1, 2]))` is `[]` (verified), so it
  contributes nothing.
- `bigint` and `symbol` match no branch at all and fall through to a no-op.
- Typed arrays happen to survive only because they expose index keys.

Current components happen to use supported shapes, but neither the component API nor the snapshot
types enforce that restriction. Adding a `Set`- or bigint-valued component would silently make both
the determinism hash and diagnostic snapshot incomplete.

## Scope

- Add a final `else` to `hashValue` that throws (e.g. `hashState: unhashable value shape ${typeof v}`)
  so an unhashable component fails loudly on the first hashed tick instead of hashing to nothing.
  Make sure the `Set`/`bigint` cases reach it rather than the silent object fallback.
- Add a unit test that a component holding an unhashable shape throws.
- The same latent gap sits in `clonePlain` (`packages/sim/src/inspect/snapshot.ts`): a `Set` reaches
  the object branch and `Object.keys(set)` is `[]`, so a `Set`-valued component silently snapshots to
  `{}` (its `PlainOf<T>` type is equally blind — `Set` hits the `extends object` mapped branch). Guard
  it the same day: the day a `Set` component is added, both `hashState` and the snapshot need it.

## Verify

`npm test`, `npm run check`, and `npm run build`; supported current state produces identical hashes
and snapshots, so goldens do not move.
