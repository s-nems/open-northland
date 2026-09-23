# Work fields by reach from the workplace's anchor, shared between workplaces in reach

**Area:** sim, app · **Focus:** drives/farming, catalog/farming · **Priority:** P3

Sown fields carry `Crop.farm`, the drive counts and picks those fields only for that farm, and
`FarmClaims.byFarm` reserves sow slots per farm. Map-placed fields have `farm: null` and are worked by
farms in reach. Two farms whose radii overlap still keep disjoint plots for their own sown fields, and
a demolished farm's fields stand untended within another farm's reach.

The original has no owner on a field. Original behavior, in the task the farmer and
the herb guy share: a worker searches 10 map points out
from its work centre for every point of its good's growing landscape, whoever sowed it, stops counting
at 25, plants only while it counted fewer, else reaps a ripe one or waters the lowest. The cap
(`FARM_MAX_FIELDS 25` in `packages/app/src/catalog/farming.ts`) matches; the radius
(`FARM_FIELD_RADIUS 16` Manhattan nodes) approximates the 10-point hexagon; the ownership does not.

## Scope

- Drop `Crop.farm`; index fields spatially and let each worker count, sow, reap and water the fields of
  its good within reach of its workplace's anchor, whichever workplace sowed them, so workplaces in reach
  share one pool and a demolished one leaves its fields to any worker in reach. Rework `FarmClaims.byFarm`
  into an in-flight sow count per anchor, and keep `fieldReclaimSystem`'s stranded-field rule working
  from the anchor instead of `Crop.farm`.
- Non-goal: a player-movable plot anchor (the original's set-work-centre command accepts the farmer
  but not the herb guy). That is a feature for the owner's roadmap; this ticket keeps the anchor at the
  workplace's own position.

## Verify

- Two farms whose reaches overlap: a ripe field between them is reaped by whichever farmer reaches it
  first, and each farmer stops sowing once the cap of growing fields stands within its reach, the other
  farm's fields counted.
- `packages/sim/test/economy/farming.test.ts` (reclaim cases included),
  `packages/app/test/farm-pacing.test.ts` with its plot bands re-derived, and a save round-trip without
  the dropped field.
