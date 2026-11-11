# Deliver to a ship site whose hull touches no walkable land

**Area:** sim · **Priority:** P2 · **Focus:** vehicle yards

The ship yard search accepts a water anchor once one cell of the house's work area lies on the worker's
shore (`waterObjection` and `shipWorkPoint` in `packages/sim/src/systems/footprint/placement/vehicle-site.ts`,
and `shipYardProbe` for placement). Material, though, is delivered only to `constructionWorkCells`
(`systems/footprint/interaction.ts`), the walkable cells bordering the site's body. A hull anchored off the
shore has none, so `fetchableMaterial` in `systems/settlers/drives/economy/site-supply.ts` fetches nothing
for it, the yard crew in `planVehicleYard` (`settlers/drives/economy/vehicle-yard.ts`) waits at its work
point for good, and `siteFor` keeps choosing the same site. The work panel shows `unknown: productionGate`.

On a three-player island save, three seats each had such a site, its stock empty and its labour 0: 8
joiners and 2 joinery carriers stood idle 69-95% of a 20000-tick run. With the sites removed, the crews
opened new ones with 3-4 bordering cells and had wood and leather delivered within 600 ticks.
`shipYardProbe` still accepts the old anchors.

## Scope

- When a ship site's body borders no walkable land, take deliveries at the work-area cells
  `shipWorkPoint` admits, where its crew already stands; keep the perimeter for every other site. Name
  this at the code as an approximation: where the original drops ship material is not confirmed.
- Keep `HeldWorkCells` (`systems/settlers/planner/work-cells.ts`) valid: its read area must cover those
  cells, or the cache verifier reports stale entries.

## Verify

- Planner test: a ship site whose hull touches no land, one work-area cell on the shore, gets its bill
  delivered and its labour rises, with the cache verifier clean.
- Existing ship yard and vehicle site tests pass; goldens unmoved.
