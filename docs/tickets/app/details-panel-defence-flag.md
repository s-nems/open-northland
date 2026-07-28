# Decide the details panel's defence section from content, not the fallback catalog

**Area:** app (hud/details-panel), data · **Priority:** P3
**Needs user:** whether a defence flag is worth adding to the building row, or the section should
follow the building's `kind` alone.

`model/index.ts` sets `showDefense: catalog?.id === HEADQUARTERS_ID || category === 'tower'`, where
`catalog` is the committed viking fallback (`vikingBuildingByTypeId`) while the rest of the branch
reads the live def from `ctx`. On decoded content whose headquarters carries another id, or whose
typeIds do not line up with the fallback catalog, the defence section disappears with no error and
no failing test.

The carrier half of the original ticket is done: the transport trade is classified once, by the sim's
`isCarrierJobRow`, and the panel reads that (`model/context.ts` `isCarrierJob`).

## Scope

- Decide the source: a `hasDefence` flag on the building content row (defaulted in the committed
  catalog and emitted by the pipeline), or the live def's `kind`/category alone. The original data
  carries no explicit defence flag, so a new field is an approximation and must be named as one.
- Whichever wins, the model must read one source, not the fallback catalog for one term and `ctx`
  for the rest.

## Verify

`npm test`, `npm run check`, `npm run build`; `npm run test:content` where local content exists.
A model unit test proving the section follows the chosen source for a building whose typeId is not
in the fallback catalog.
