# Keep a marching group together instead of filing down one corridor

**Area:** sim · **Priority:** P2 · **Focus:** `systems/movement/group-routes.ts`, `group-lanes.ts`

A group order whose members start bunched walks a long route in single file. Members get distinct
destination slots, but only the lowest-id member searches; the rest borrow its route through
`GroupRoutes.borrow`. `GroupLanes.direct` needs an obstacle-free straight lane, and
`GroupLanes.translated` shifts the whole corridor by the member's start offset across the march, so
it fails as soon as any node of a long, winding route shifted sideways is closed. Everyone then joins
the shared corridor (`joinCorridor`), the friendly body nudges space them along it, and the band
becomes a column one or two nodes wide that fans out into its formation only at the destination.

The player's own orders look better only because an army usually stands spread out and walks a short
way over open ground. Scripted armies show it at its worst: `SetHumanX` spawns a whole band on one
point, and `SendHuman` then marches it across the map. Measured on Wielka Inwazja's crusade (a band of
about 30 heroes, about 400 cells from Rome's camp to the player's base): the column stays 25-37 nodes
long and 1-5 nodes wide for the whole march.

Widening the lanes alone is not enough. Lanes beside the corridor that squeeze round obstacles
measured 3-4 abreast, but their lengths differed by 3-10% over that route, so the band stretched to
about twice its single-file length and would arrive piecemeal. The outcome needs both parts:

- members walk beside each other, keeping their place across the march where the ground allows and
  narrowing through gaps;
- the group keeps one pace, so the members ahead of the group's progress along its route slow down
  rather than pulling away, and the band arrives as one body.

## Scope

- Applies to every multi-member group walk: the player's group move and attack-move, and a script's
  `SendHuman` band. Single walks and economy walks are unchanged.
- A fight takes a member out of the pace; the group must not wait forever for a member that is
  fighting, dead or cut off.
- Pacing state that outlives a tick is saved state: bump the save format and regenerate its fixture
  in the same commit.
- Per-tick cost scales with the members marching, never with member pairs or the map.
- Name the pace and lane rules as authored approximations: the original has no group pace or lanes.
  A script's `SendHuman` sends every member to one point, a player's group order gives each member
  its own nearby target, and members walk through each other.

## Verify

- A headless replay of Wielka Inwazja's crusade (`SendHuman 100 412 350` from the camp at 111,162):
  for most of the march the band stays several nodes wide and no longer than a few ranks.
- `packages/sim/test/movement/army-geometry.test.ts` and `army-routing.test.ts` keep their spread,
  distinct-slot and search-budget guarantees.
- A paced group must not cost a route search per member per tick; report the expansions of the
  1000-soldier army tests before and after.
- Browser check of a scripted wave and a player's long group march.
