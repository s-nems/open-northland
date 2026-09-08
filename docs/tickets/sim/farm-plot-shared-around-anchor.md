# Work fields by reach from the farm's anchor, shared between farms in reach

**Area:** sim, app · **Focus:** drives/farming, catalog/farming · **Priority:** P3
**Needs user:** one observation in the running original.

Every field carries `Crop.farm`, the drive counts and picks only `targets.cropsByFarm.get(farm)`, and
`FarmClaims.byFarm` reserves sow slots per farm. A field is thereby owned: two farms whose radii overlap
keep two disjoint plots on the same ground, and a demolished farm's fields stand untended within another
farm's reach. The readable data has no owner on a field - `wheat (growing)` is a landscape point like any
other. The cap (`FARM_MAX_FIELDS 24` in `packages/app/src/catalog/farming.ts`) is an observed standing-plant
count and the radius (`FARM_FIELD_RADIUS 16`) an authored value.

## Scope

- Observe first (Needs user): two farms in the original whose plots overlap - does a farmer tend the
  other farm's plants, and how far from its farm does a farmer sow.
- If a farmer tends the other farm's plants: drop `Crop.farm`; index fields spatially and let each farmer
  count, sow, reap and water the fields within reach of its farm's anchor, whichever farm sowed them, so
  farms in reach share one pool and a demolished farm leaves its fields to any farmer in reach. Rework
  `FarmClaims.byFarm` into an in-flight sow count per anchor, and keep `fieldReclaimSystem`'s
  stranded-field rule working from the anchor instead of `Crop.farm`. If not, keep the owner and close
  this ticket with the observation recorded.
- Set the radius from the observation and re-check the cap against the standing-plant count seen there;
  until then the shipped values stay.
- Non-goal: a player-movable plot anchor. That is a feature for the owner's roadmap; this ticket keeps
  the anchor at the farm's own position.

## Verify

- Two farms whose reaches overlap: a ripe field between them is reaped by whichever farmer reaches it
  first, and each farmer stops sowing once the cap of growing fields stands within its reach, the other
  farm's fields counted.
- `packages/sim/test/economy/farming.test.ts` (reclaim cases included),
  `packages/app/test/farm-pacing.test.ts` with its plot bands re-derived, and a save round-trip without
  the dropped field.
