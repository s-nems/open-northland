# Confirm the base-only houses on mod maps

**Area:** pipeline · **Priority:** P3
**Needs user:** observe the base-only town in the running CulturesNation original.

The pipeline layers the base `Data/engine2d/inis/houses/houses.cif` under the mod's
`rules/buildings/houses.ini` by `EditName` (`tools/asset-pipeline/src/stages/base-houses.ts`). The 15
names only the shipped base table declares (`frank patricianhouse 01/02/03`, `byzantine home01/02/03`,
`saracen mosqe`, `saracen palace`, `saracen residence 01/03`, `saracen tent 02/03/04`,
`Egypt MainHouse`, `Egypt Residence 04`) now place on the original campaign maps, which need them, and
on mod maps: 69 of 70 previously skipped `sethouse` rows on 10 maps, most in `tutorial_007`,
`tutorial_006` and `tutorial_005`. `byzantine bakery` exists in neither table and stays skipped.

`viking pottery` also comes from the base table, on purpose: the `houses` correction removes the mod's
record so the original three-level pottery applies (owner ruling). It keeps the base layer whatever the
decision below; dropping the base layer on mod maps would take the viking pottery out of every map.

Open question: the mod may replace the base house table rather than layer on it, so the
CulturesNation original might not show these houses on mod maps.

## Investigate

Load `tutorial_007` in the running CulturesNation original and check whether the Saracen town shows its
palace, mosque, tents and residences.

## Scope

- If they appear: record the observation as the source basis in `base-houses.ts` and delete this ticket.
- If they do not: decide with the owner whether mod maps should keep them; the original campaigns need
  the base layer either way.

## Verify

- `npm run test:pipeline` keeps the fallback and precedence tests in
  `tools/asset-pipeline/test/stages/ir/base-houses.test.ts` green.
- After the decision, `npm run build:content` and a boot of `tutorial_007` show either the base-only
  houses placed or an explicit skip, matching the recorded observation.
