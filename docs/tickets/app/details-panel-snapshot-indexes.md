# Stop selected-building panels from scanning the whole snapshot

**Area:** app, render · **Focus:** hud/details-panel · **Priority:** P3

The details panel derives its model on every tick while a selection exists. Two selected-building
paths still walk every snapshot entity:

- `model/building-production.ts` counts a farm's fields; crops are not part of `actorsOf`;
- `worker-sprites.ts` calls `buildSpriteScene` for at most eight selected refs without an id lookup.

Both costs grow with the map although the panel displays one building.

## Scope

- Add a per-snapshot crops-by-farm index beside the existing family indexes.
- Resolve selected worker refs through the render scene's id-keyed lookup instead of a full scene build.
- Do not add a second snapshot clone or cache presentation objects in sim state.

## Verify

- Panel tests pin the same field counts and worker sprites before and after indexing.
- A profile with a selected farm on `magiczny_las` shows no full-entity walk in either panel path.
- `npm test`, `npm run check`, and `npm run build`.
