# Drive details-panel defence visibility from live building content

**Area:** app · **Focus:** hud/details-panel · **Priority:** P3

`model/index.ts` sets `showDefense: catalog?.id === HEADQUARTERS_ID || category === 'tower'`, where
`catalog` is the committed viking fallback (`vikingBuildingByTypeId`) while the rest of the branch
reads the live def from `ctx`. On decoded content whose headquarters carries another id, or whose
typeIds do not line up with the fallback catalog, the defence section disappears with no error and
no failing test.

The live building row already carries both facts the current UI uses: stable id `headquarters` for
the headquarters and kind `tower` for defensive structures. Adding a second `hasDefence` field would
invent source data and another join without changing the current rule.

## Scope

- Set visibility from the live definition only: `def.id === 'headquarters' || def.kind === 'tower'`.
- Remove the details-model dependency on `vikingBuildingByTypeId`; do not add a new content field.
- Keep the displayed defence state as its separately named approximation until the tower-defence
  feature gives it live state.

## Verify

`npm test`, `npm run check`, `npm run build`; `npm run test:content` where local content exists.
A model unit test proves a live headquarters and tower outside the fallback typeId table show the
section, while an ordinary live storage building does not.
