# Fail loudly on unhashable value shapes in `hashState()`

**Area:** sim · **Origin:** review of fix/hashstate-string-values, 2026-07-17 · **Priority:** P2

`hashValue` (`packages/sim/src/simulation.ts`) dispatches on number, string, boolean,
null/undefined, array, `Map`, then a `typeof v === 'object'` fallback that walks `Object.keys`. Value
shapes outside that set mix **nothing** into the hash — silently, exactly the hole the string branch
closed:

- A `Set` reaches the object fallback and `Object.keys(new Set([1, 2]))` is `[]` (verified), so it
  contributes nothing.
- `bigint` and `symbol` match no branch at all and fall through to a no-op.
- Typed arrays happen to survive only because they expose index keys.

**Not reachable today.** Every `defineComponent<…>` in `packages/sim/src/components/` resolves to
number (incl. the `Fixed`/`Entity`/`NodeId` brands), boolean, null/undefined, array,
`Map<number, number>` (`Settler.experience`, `Stockpile.amounts`), or plain nested objects. The
package's many `Set`s are transient system scratch, and the fog `Uint8Array` masks are mixed
explicitly outside `hashValue`. The bug arms itself the day someone adds a `Set`-valued (or
bigint-valued) component: two diverging runs hash identically again and the determinism tripwire
reopens with no test failing.

## Scope

- Add a final `else` to `hashValue` that throws (e.g. `hashState: unhashable value shape ${typeof v}`)
  so an unhashable component fails loudly on the first hashed tick instead of hashing to nothing.
  Make sure the `Set`/`bigint` cases reach it rather than the silent object fallback.
- Add a unit test that a component holding an unhashable shape throws.
- The same latent gap sits in `clonePlain` (`packages/sim/src/inspect/snapshot.ts`): a `Set` reaches
  the object branch and `Object.keys(set)` is `[]`, so a `Set`-valued component silently snapshots to
  `{}` (its `PlainOf<T>` type is equally blind — `Set` hits the `extends object` mapped branch). Guard
  it the same day: the day a `Set` component is added, both `hashState` and the snapshot need it.
- Optional, same function, do it here only because it moves goldens once: the `Map` branch mixes no
  size, unlike the array branch's `mix(v.length)` framing. No collision has been demonstrated (every
  `hashValue` call mixes at least one word, and object keys are length-framed), so this is symmetry,
  not a known defect. `mix(v.size)` before the entry loop would move every golden containing a
  `Stockpile`.

## Verify

`npm test` (goldens move only if the optional `Map` size framing is taken — name it in the commit),
`npm run check`, `npm run build`.
