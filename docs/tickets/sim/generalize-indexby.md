# Generalize `indexById` into a keyed `indexBy` and drop sim's `byKeyLast`

**Area:** data + sim · **Origin:** data+pipeline refactor-cleanup (deferred), 2026-07-13 · **Priority:** P3
(refactor / dedup — no behavior change)

## Context

`@open-northland/data`'s `indexById` (`packages/data/src/lookup.ts:2`) is hardcoded to key by
`typeId`:

```ts
export function indexById<T extends { typeId: number }>(items: readonly T[]): ReadonlyMap<number, T> {
  return new Map(items.map((i) => [i.typeId, i]));
}
```

Because it takes no key function, `packages/sim/src/core/content-index.ts:245` rolls its own generic
last-wins index-by-key and its comment says so verbatim:

```ts
/** Map `items` by `key`, last-wins — the duplicate semantics of `@open-northland/data`'s `indexById`.
 *  Kept separate from the hot read-view tables above, whose replaced `.find` scans are first-wins. */
function byKeyLast<K, T>(items: readonly T[], key: (item: T) => K): ReadonlyMap<K, T> {
  const map = new Map<K, T>();
  for (const item of items) map.set(key(item), item);
  return map;
}
```

This is a genuine second caller of one idea (build a `Map` by a key, last-wins). It was surfaced but
left out of the `data` + `pipeline` refactor-cleanup pass (2026-07-13) because the change is rooted in
`packages/sim`, outside that pass's scope.

## Scope

- Add a keyed helper to `packages/data/src/lookup.ts` — e.g.
  `indexBy<K, T>(items: readonly T[], key: (item: T) => K): ReadonlyMap<K, T>` (last-wins, matching the
  current `indexById` semantics). Re-express `indexById` in terms of it
  (`indexBy(items, (i) => i.typeId)`) or keep it as the common typed shorthand — either is fine as long
  as there is one implementation of the loop.
- Replace `byKeyLast` in `content-index.ts` with the new `indexBy`, deleting the local copy.
- Do **not** touch the first-wins `byKey`/`.find`-replacement tables in `content-index.ts` (lines
  ~230–241) — those have deliberately different (first-wins) semantics and are not this dedup.

## Verify

- `npm run build`, `npm test` (data + sim), `npm run check`. No golden hashes should move (pure
  refactor, identical last-wins semantics).
- Confirm no other package imported `byKeyLast` (it is a module-local `function`, so this should be a
  no-op, but grep to be sure).

## Source basis

Pure internal refactor — no mechanic, extraction, or visual claim. The last-wins semantics to preserve
are pinned by the existing `indexById` implementation and the `content-index.ts:243-248` comment.
