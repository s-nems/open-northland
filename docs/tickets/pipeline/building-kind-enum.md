# Type `BuildingType.kind` as a closed enum

**Area:** data (+ pipeline, app consumers) · **Origin:** data schema refactor review, 2026-07-12 · **Priority:** P3

`packages/data` `schema/economy/workplaces.ts` — `BuildingType.kind` is `z.string()` with a JSDoc
that enumerates a **closed** set (`storage | home | workplace | training | tower | vehicle |
wonder`). Typing it as a free string is the "enum expressed as a string" smell flagged during the
data refactor: a typo or an unmapped `logicmaintype` flows through as an unclassified building
instead of failing at the loader boundary, and consumers can't exhaustively `switch` on it.

## Why this is deferred (not a drop-in change)

Converting the field to `z.enum([...])` of the 7 documented values was attempted and reverted: it
broke **869 tests**. The real extracted IR (`content/ir.json`) uses exactly those 7 values, but the
**app's authored slice content and test fixtures** author `BuildingType` with a WIDER set of `kind`
values (observed: `headquarters`, `house`, `building`, and others). So the closed set is not
actually 7 — the schema is shared between the pipeline's extractor output and hand-authored content
that classify buildings differently.

The change is therefore a **behavior change** (strict rejection of values outside the set) that
requires reconciling the vocabulary first, not a mechanical retype.

## Scope

1. Enumerate every `kind` value actually used, across both sources:
   - the extractor: `tools/asset-pipeline/src/decoders/ini/types/buildings.ts` `houseKind()` (maps
     `logicmaintype` → kind), and
   - authored content + fixtures under `packages/app/src/slice/`, `packages/app/src/game/`, and the
     `packages/*/test/` content builders (grep for `kind:` on building records — filter out the many
     unrelated discriminated-union `kind` fields first).
2. Decide the canonical set: either unify the authored values onto the extractor's 7 (rename
   `headquarters`/`house`/`building` → `storage`/`home`/`workplace` etc. at the authoring sites) or
   widen the enum to the true union with documented meaning for each.
3. Define `export const BuildingKind = z.enum([...])` in `workplaces.ts`, set `kind: BuildingKind`,
   and (optionally) type `houseKind()`'s return as `BuildingKind` so the extractor is checked too.

## Verify

- `npm test` green (the fixtures/authored content must parse under the enum).
- `npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content` still succeeds
  and `content/ir.json` `buildings[].kind` values are unchanged (byte-identical IR if the extractor
  output set was already within the enum).

## Source basis

Extracted `logichousetype` `logicmaintype` (the extractor's 7 kinds) vs the app's authored
vertical-slice content (the wider set). No original-behavior claim — this is an internal
type-safety/vocabulary reconciliation.
