# Make the inline test `.ini`/CIF fixtures genuinely synthetic (open-source release blocker)

**Area:** pipeline (test fixtures) · **Origin:** synthetic-ini-fixtures follow-up 2026-07-14 · **Priority:** P1

The shared `test/fixtures/ini-sources.ts` fixtures were rewritten to invented content (the
`synthetic-ini-fixtures` ticket). But several **per-spec inline fixtures** — `.ini`/CIF snippets
defined as string/`CifLine[]` constants inside the test files, not in the shared fixture — still copy
real game record names and values verbatim, the same legal problem and the same release blocker
(README / `docs/SOURCES.md` / `tools/asset-pipeline/AGENTS.md`: tests use synthetic fixtures, never
real game data).

## Confirmed verbatim copies (grepped against the owned game copy 2026-07-14)

- `test/ini-types-actors.test.ts` `ARMORTYPES_INI` — `name "woolen armor"` / `name "plate armor"`
  are real `Data/logic/armortypes.ini` record names.
- `test/ini-types-landscape.test.ts` inline `GfxLandscape` `CifLine[]` — `EditName "palm 03"`,
  `EditName "wave 02"`, and `GfxBobLibs "…ls_trees.bmd"` are real `EdytorByRemik/*.ini` records
  (the decrypted landscape-graphics twin), including the bob-lib paths and frame ids.
- `test/ini-types-landscape.test.ts` / `test/ini-types-goods.test.ts` inline goods snippets —
  `name "honey"` / `name "flour"` are real `Data/logic/goodtypes.ini` record names.

## Audit each (same class, not yet grepped line-by-line)

- `test/ini-types-actors.test.ts` `ANIMALTYPES_INI` — the bear/boar stat lines
  (`hitpoints_adult`, `angryGameTime`, herd params) look extracted from real `animaltypes.ini`.
- `test/ini-types-landscape.test.ts` inline `trianglepatterntype` `CifLine[]` — `debugname "water"`
  / `debugname "land"` + their flags mirror real `trianglepatterntypes.cif`.
- `test/ini-buildings-structure.test.ts` and `test/ini-buildings-visuals.test.ts` — the
  `GFXHOUSE_*` inline `[GfxHouse]` fixtures (`LogicType`, `LogicConstructionGoods`, `GfxFrames`,
  bob ids) mirror real `budynki12/houses/houses.ini` graphics records.
- `test/ini-integration.test.ts` — the inline cross-reference snippets author `name "wood"` /
  `name "coin"` / `"gold"` record names (real good names), and inline synthetic IR objects use real
  game vehicle identifiers as ids (`'handcart'`, `'oxcart'`, `'catapult'`, `'ship small'` — confirmed
  in `CnModMaps/*/staticobjects.inc`).

## Scope

1. For each inline fixture above, rewrite the copied record names, ids, numeric values, and comment
   text with **invented** content, preserving only the grammar shapes the spec exercises (the same
   discipline `synthetic-ini-fixtures` applied to `ini-sources.ts`). Keep cross-reference
   consistency inside each snippet so the spec still passes. Keep the `<CULTURES_CIF_BEGIN><03FD>`
   sentinel with **made-up** header hex; header sentinel + `.ini` key names are format vocabulary.
2. Update each spec's asserted literals to the new invented values.
3. Sanity sweep: grep the new fixtures' names/values against `Cultures 8th Wonder/` sources to
   confirm zero verbatim data lines remain (record-name strings and distinctive value lines must not
   match; key names and the header sentinel are fine).

## Verify

`npm test` (the asset-pipeline specs), `npm run check`. Record the step-3 grep sweep in the commit
message.

## Source basis

Legal hygiene only — no production behavior change. The `.ini`/CIF grammar shapes being preserved are
format knowledge (OpenVikings + readable mod sources); the copied *content* (record names, stat
values, bob-lib paths, frame ids) is not.
