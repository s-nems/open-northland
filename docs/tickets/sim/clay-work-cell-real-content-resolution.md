# Buried-deposit fate depends on content: work-cell resolution diverges under real extraction

**Area:** sim (economy/footprint) · **Origin:** clay-under-building gameplay review, 2026-07-18 · **Priority:** P3

`nearestHarvestableFor` (`packages/sim/src/systems/agents/targets/resources.ts`) now skips a resource whose
resolved work cell is buried under a building, so a clay/mud deposit a house is placed over no longer strands
its digger. But WHAT then happens to the deposit depends on how `resourceWorkCell`
(`packages/sim/src/systems/footprint/interaction.ts`) resolves its work cell, and that differs between the
synthetic/sandbox content the tests use and the real extracted records:

- `resourceWorkCell` collapses `workAreas` to the FULL valency state (`fullStateBlockAreaCells`). The
  synthetic clay fixture (`packages/sim/test/footprint/resource-footprint/content.ts`) lists the `(0,0)`
  anchor in its full-state work areas, so the work cell resolves to the anchor — which the building buries —
  so the gate skips the deposit and it is left un-mined.
- Real extracted clay/mud records list the anchor only in PARTIAL states (documented at
  `interaction.ts:172-182`); their full-state work areas sit BESIDE the anchor. So `resourceWorkCell` returns
  an adjacent cell (`nearestCell(work, from)`, else `nearestFreeNeighbour`), chosen against the RESOURCE layer
  only — ignoring buildings.

Consequences under real content:
- An edge-exposed buried deposit resolves to an exposed adjacent cell (not building-blocked), so the gate does
  NOT skip it and the digger mines the clay from its open side — i.e. mines a deposit sitting under a house.
- Because `resourceWorkCell` returns the cell NEAREST the digger (not "any reachable one"), a deposit whose
  nearest work cell is buried but which has another exposed work cell is skipped though it is actually
  mineable from the open side — a false negative.

Neither is a strand (the P2 goal is met), but the un-mined-vs-side-mined behavior is a named approximation, not
a decided design.

## Scope

- Decide faithful behavior: does the original permit mining a partially-buried deposit from an exposed side, or
  should a deposit under a building be entirely un-mineable? (User knows the original — ask.)
- If side-mining should be denied, make `resourceWorkCell` filter its work cells by the building layer too (not
  just the resource layer), so it returns an exposed cell only when one exists and a fully-enclosed deposit
  resolves to a blocked cell the gate skips. Keep every interaction consumer on the same resolved node.
- Feedback gap (folded in from the same review): a digger silently ignoring buried clay gives the player no
  "resource buried / unreachable" indication. Likely matches the original's silence; decide whether any cue is
  warranted.

## Verify

- A real-content (or anchor-excluded-work-area fixture) test covering a house over a clay deposit: assert the
  chosen behavior (skipped vs side-mined) rather than the current sandbox-only anchor path.
- `npm test` — goldens byte-identical unless the resolution change intentionally moves picks (then name it).
