# Claim a field by its own node, not by the stance a farmer approaches from

**Area:** sim · **Focus:** drives/farming · **Priority:** P3

`planFarmer` keys a field claim on `interactionCell(world, ctx, terrain, c, here)`, the work-pool cell
nearest the asking farmer, and `claims.nodes.has(cell)` is what keeps a second farmer off a colleague's
field. On fixture content a field's work pool is its anchor alone, so the key is stable. On real content
the wheat harvest record's `workAreas` decode to the six cells around the field with the field's own node
excluded, so two farmers approaching from different sides resolve different cells of one ripe field and
both walk to it; the loser's swing finds no `Resource` and returns nothing. Goods stay conserved, the walks
are wasted, and the sim tests cannot see it because the fixture pool is the anchor.

## Scope

- Key crop claims on the field's own node (`nodeOfPosition` of its `Position`) while keeping the stance
  cell as the walk goal; leave sheaf and sow claims as they are.
- A coordination case that stamps a ring `ResourceFootprintData` on fixture fields and starts two farmers
  on opposite sides of one ripe field: the second must claim another field.

## Verify

- The new case and `packages/sim/test/economy/farming.test.ts`; hashes stay put on fixture content, where
  anchor and stance coincide.
