# Make the AI's dry-patch probe measure what the gatherer's pick measures

**Area:** sim · **Origin:** gatherer idle-loop soak, 2026-07-19 · **Priority:** P2

The workforce allocator decides "this collector's patch ran dry, move its flag" with `patchAlive`
(`packages/sim/src/systems/ai-player/workforce.ts`). That probe and the gatherer's own harvest scan
(`nearestHarvestableFor`, `packages/sim/src/systems/agents/targets/resources.ts`) answer different
questions, so the AI can conclude the patch is alive while the collector can find nothing to dig:

- **Different metric.** `patchAlive` uses `withinNodeRadius` — the anisotropic world-metric circle
  (34 px E/W, 19 px N/S per node). The gatherer uses `manhattan(...) > radius` — an integer diamond on
  the node lattice. At radius 24 the circle admits nodes ~42 rows away that the diamond rejects outright.
  `workforce.ts`'s own comment calls the flag area "the world-metric circle the gatherer harvests in",
  which is not what the gatherer does.
- **Different eligibility.** `patchAlive` counts any live node of the good at its *anchor*. The gatherer
  measures the resolved *work cell* and additionally rejects nodes that are building-blocked, in another
  static component, outside its signpost `NavigationLimit`, barred by the good's `needforgood` XP
  threshold, or already claimed by a colleague. Every one of those is a node `patchAlive` counts and the
  gatherer will not take.

`nearestLiveResource` (`ai-player/shared.ts`), which the relocate branch aims the flag at, has the same
gap: it ranks by anchor Manhattan with no eligibility gate.

Observed on `npm run soak:gatherers` (magiczny_las, all six seats AI, 26k ticks): collectors carried 3–25
building-blocked deposits inside their radius that `patchAlive` counts as a live patch. Those cases did
not stall anyone on this run — the collectors had plenty of eligible nodes too — so this is a latent
correctness gap, not a reproduced failure. It becomes a permanent flag pin whenever the *only* nodes
`patchAlive` sees are ones the gatherer refuses: the dry-patch branch never fires, and the periodic
`FLAG_RELOCATE_EVERY_DECISIONS` upkeep also bails, because it measures drift to the same ineligible
nearest node and finds it within `FLAG_MAX_DISTANCE_NODES`.

## Scope

- Give `patchAlive` (and the relocate target) the gatherer's own eligibility test: work-cell resolution,
  integer-Manhattan radius, and at minimum the building-blocked and static-component gates. Share one
  predicate with `nearestHarvestableFor` rather than restating the filter — the two drifting apart is the
  defect.
- Keep it O(nodes near the flag): the probe already reads the resource region index; do not turn it into
  a per-decision full scan.
- Fix the stale "world-metric circle the gatherer harvests in" comment either way.
- Decide deliberately which metric the flag work area *should* use. The project convention for
  player-visible circles is the world metric (`nav/node-metric.ts`, signposts, vision); the gatherer's
  Manhattan diamond predates it. Changing the gatherer side widens its work area and moves goldens, so it
  is a named behaviour change, not a refactor.

## Verify

- `npm test` — a golden that moves means the flag area changed shape; name the mechanic if intended.
- `packages/sim/test/systems/ai-player-modules.test.ts` — extend the dry-patch cases with a patch whose
  only remaining nodes are ineligible (building-blocked, or outside the Manhattan diamond but inside the
  circle); the flag must relocate.
- `npm run soak:gatherers` — still zero collector stalls.
