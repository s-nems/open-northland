# Reconcile the `BuildingType.kind` vocabulary, then close the enum

**Area:** data (+ pipeline, app, sim consumers) · **Origin:** data schema refactor review, 2026-07-12
(re-anchored 2026-07-17 after the data+pipeline refactor-cleanup pass) · **Priority:** P3

`packages/data` `schema/economy/buildings.ts` — `BuildingType.kind` is still `z.string()`. The closed
set it documents (`storage | home | workplace | training | tower | vehicle | wonder`) is now **named**
but not **enforced**: consumers still can't exhaustively `switch` on it.

**Landed 2026-07-17** (refactor-cleanup pass): `buildings.ts` exports the vocabulary as `BUILDING_KIND`
(an `as const` table) plus the `BuildingKind` type, and the extractor's `logicmaintype` → kind map
(`tools/asset-pipeline/src/decoders/ini/types/buildings.ts` `HOUSE_KIND_BY_MAIN_TYPE`) is typed against
it, so a typo in the producer now fails to compile. `packages/app/src/catalog/buildings.ts`'s
redeclared `HOME_KIND` was deleted in favour of `BUILDING_KIND.home`.

## Why closing the enum is still not a drop-in change

Converting the field to `z.enum([...])` was attempted (2026-07-12) and reverted: it broke **869
tests**. The real extracted IR uses exactly the 7 values, but the app's authored slice content and test
fixtures author `BuildingType` with a **wider** set — re-verified 2026-07-17: `headquarters` (32
sites), `building` (28), `house` (8) alongside `workplace`/`home`/`storage`. (Grep `kind: '...'` and
filter — most hits are unrelated discriminated-union `kind` fields.)

A second blocker, also real: the extractor deliberately falls back to `maintype_<n>` for an
unrecognized `logicmaintype` "so a new value never crashes a batch". A closed `z.enum` would make that
fallback throw at the loader boundary — the opposite of its purpose. Closing the enum must decide what
happens to an unknown maintype (reject the record? keep an explicit `unknown` member?).

So this stays a **behavior change** requiring a vocabulary reconciliation first, not a mechanical retype.

## Scope

1. Enumerate every `kind` value actually authored, across both sources: the extractor's
   `HOUSE_KIND_BY_MAIN_TYPE` + its `maintype_<n>` fallback, and the authored content/fixtures under
   `packages/app/src/slice/`, `packages/app/src/game/`, and the `packages/*/test/` content builders.
2. Decide the canonical set: either unify the authored values onto the extractor's 7 (rename
   `headquarters`/`house`/`building` → `storage`/`home`/`workplace` at the authoring sites) or widen
   `BUILDING_KIND` to the true union with a documented meaning for each. Settle the unknown-maintype
   policy at the same time.
3. Set `kind` to a `z.enum` derived from the existing `BUILDING_KIND` table, and drop the
   "stays `z.string()` because…" note in its doc.
4. Replace the consumers' bare literals with `BUILDING_KIND.*` — deliberately left alone by the
   cleanup pass as out-of-scope churn in another package's internals. Sites (verified 2026-07-17):
   `packages/sim/src/core/content-index.ts` (×2), `systems/stores/housing.ts` (×3),
   `systems/stores/workplace.ts`, `systems/family/households.ts`, `systems/family/food-search.ts`,
   `systems/agents/targets/food.ts`; `packages/app/src/game/sandbox/building-set.ts`,
   `view/unit-controls/orders.ts`, `view/unit-controls/house-highlight.ts`,
   `hud/details-panel/model/index.ts`. Once the field is a union type these become exhaustively checkable.

## Verify

- `npm test` green (the fixtures/authored content must parse under the enum).
- `npm run check`, `npm run build`.
- `npm run test:pipeline`, then `npm run pipeline -- --game "../Cultures 8th Wonder" --out content` —
  `content/ir.json` `buildings[].kind` values unchanged (byte-identical IR if the extractor's output
  set was already within the enum).

## Source basis

Extracted `logichousetype` `logicmaintype` (the extractor's 7 kinds) vs the app's authored
vertical-slice content (the wider set). No original-behavior claim — an internal type-safety /
vocabulary reconciliation.
