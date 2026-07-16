# Derive a spatial search bound from the navigation limit

**Area:** sim (signposts / spatial) · **Origin:** signposts feature branch audit, 2026-07-16 · **Priority:** P2

Today `cellGateOf(plan.limit)` only FILTERS candidates — every confined search still enumerates its
full candidate space and rejects out-of-area cells one by one. The confinement never shrinks the
search, so the intended perf win (a settler only ever looks at its local + signpost area) is not
realized:

- Roaming `nearestHarvestableFor` with `area === undefined` (`targets/resources.ts`) linearly scans
  the full canonical resource list (~17k nodes on a decoded map) per roaming gatherer per tick,
  gate-filtering each cell. The flag-bound variant already takes an `area` and scans
  `resourcesNearNode(radius)` — the confined roaming case should get the same treatment.
- `InteractionCellIndex.nearest` (`targets/cell-index.ts`) expands rings to the fixed
  `NEAREST_RING_MAX_RADIUS` / bounding-box reach and falls back to a full linear scan on a ring
  miss, regardless of the limit.

## Scope

- Give `NavigationLimit` a queryable extent (e.g. a bounding box or center+maxRadius over the local
  circle plus reachable group circles — the data already exists in `navigationLimitFor`).
- Use it to bound the roaming harvest scan (reuse the existing `area` path) and to cap ring
  expansion / skip the linear fallback in `InteractionCellIndex.nearest` when a limit is present.
- Canonical winners must not change where the old search would have found an in-area target:
  same `(distance, id)` picks, goldens untouched (default-off), confined-mode results identical to
  filter-only behaviour.

## Verify

`npm test` (goldens unmoved); a before/after throwaway profile over `dist/` on a decoded map with
many roaming gatherers confined to a small area.
