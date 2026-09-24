# Maintain entity indexes on the mirror and stop per-tick passes over every entity

**Area:** app, render · **Focus:** game/snapshot-base, view/projections, data/scene · **Priority:** P2
**Blocked by:** [00 Heavy-load reference](00-heavy-load-reference.md), [02 Snapshot delta and mirror](02-snapshot-delta-and-mirror.md)

Several passes still visit every entity once per tick, memoised by snapshot identity so they run
once per tick rather than once per frame: the shared actor walk `indexOf` in
`packages/app/src/game/snapshot-base.ts` behind `actorsOf` (the HUD model, minimap dots, badges and
bubbles all draw on it), `buildHud` in `packages/render/src/data/hud/model.ts`, fog ghost collection
in the renderer, `ownersOf` in unit targets, the details panel's farm field count, and the renderer's
`SpriteSpatialIndex.update` and `SceneIndex`, which rebuild from the whole entity list on every tick
under the render contract's visibility-pass allowance. On the fortress at tick ~2000 that is 26k
entities for 544 settlers, 36 times a second at speed x3, per pass.

## Scope

- The mirror maintains, from each delta's touched and removed sets alone: entities by kind
  (settlers and animals, buildings, heaps and stockpiles, resource nodes, vehicles, crops by farm),
  by owning player, and one spatial index by half-cell node for positioned entities. The existing
  identity-stable `SpriteSpatialIndex` becomes that spatial index, fed incrementally, rather than a
  second one beside it.
- `indexOf`, `buildHud`, the fog ghost collection, `ownersOf` and the details panel query the indexes.
  A projection that needs a global aggregate keeps it incrementally on the index.
- The renderer's scene cache and sprite pool take their candidate set from the spatial index over the
  culled viewport, so a tick that touched nothing on screen rebuilds nothing. The depth-sort
  allocation stays with `docs/tickets/render/scene-rebuild-and-depth-sort-churn.md`, narrowed to the
  sort in this ticket's commit.
- Remove the visibility-pass allowance from `packages/render/AGENTS.md` and the exception clause it
  backs in root `AGENTS.md` rule 6; the index is the rule.

## Verify

- No per-tick pass over `snapshot.entities` remains in `packages/app` or `packages/render` outside
  the mirror itself; the review names each removed site. Per-click walks (building picks, highlights)
  are out of scope and stay.
- Per-tick projection and scene-build cost on the 00 checkpoint before and after, at zoom 1 and at
  `MIN_ZOOM`.
- Rendered output, HUD figures and hashes unchanged: screenshots and goldens identical.
- `npm test`, `npm run check`, `npm run build`.
