# Calibrate herb and mushroom field-farming (the other two field goods)

**Area:** app + sim · **Origin:** real-content farm-recipe fix, 2026-07-15 · **Priority:** P3

The farm-recipe fix taught the extraction pipeline that a **field-farmed** good (one carrying all three
field atomics `plant`+`cultivate`+`harvest` — `hasFieldFarmAtomics`) is grown on the map, so
`fillBuildingRecipes` no longer synthesizes an in-house recipe for it. In `ir.json` three goods qualify:
**wheat (4), herb (13), mushroom (14)** — each carries the field atomics (extracted from
`goodtypes.ini` `atomicForPlanting/Cultivating/Harvesting`).

Only **wheat** has a clean-room `farming` growth block (`FARMING_BALANCE_BY_ID` in
`packages/app/src/catalog/farming.ts`), overlaid by `mergeRealContent`. So after the fix **herb and
mushroom lose their (previously bogus `{0 → good}`) recipe but gain no field loop** — their producing
buildings (`work_herb_hut` type 34; the mushroom producer, if any — re-check `ir.json`) now sit idle.
This is the honest state (better than minting a good from nothing), surfaced at boot by
`logRealContentGaps` as `unfarmedFieldGoods: [herb, mushroom]`.

## Scope

- Add `herb` and `mushroom` rows to `FARMING_BALANCE_BY_ID` (growth timing, field radius/count). Source
  basis: same as wheat — the growing landscape's `maximumValency` gives `stages` (DATA); the rest is
  observed calibration (no readable growth timing). Reuse the wheat constants as a starting point and
  name any divergence.
- Confirm which building actually produces mushroom in `ir.json` (grep `produces` for good 14); herb is
  `work_herb_hut` (34). Verify each is a workplace with worker slots, not a gather hut.
- Decide whether herb/mushroom belong in an acceptance scene, or whether the farm scene is enough proof
  of the shared field loop. If the mechanic diverges (e.g. herb grows in forest, not open grass), that is
  a real gameplay question — surface it, don't guess.

## Verify

- `npm test` — the merge no longer lists the calibrated good in `unfarmedFieldGoods`.
- Headless: a herb/mushroom producer field-farms end-to-end (workers bound, fields sown, good reaped into
  the store) — mirror `farm`'s scene checks.
- Browser `?scene=` — **user's eyes** on the sowing/reaping if a scene is added.
