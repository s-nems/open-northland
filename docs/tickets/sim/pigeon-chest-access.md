# Let a catapult open the walled pigeon chest

**Area:** sim, map-import · **Focus:** authored encounter access · **Priority:** P2

## Problem

In `wielkie_sprzatanie_2_0`, briefing page 511 offers a one-use pigeon chest east of the camp and
says that using it first requires removing the barrier with a catapult (Polish text in
`maps/community/Wielkie Sprzatanie 2.0/text/pol/briefings/briefings.txt`, page 511). The chest is a
`chest wooden` landscape object the map's `map.dat` places at half-cell (304, 242). Mission 4
(`pidgeonchest`, goal `ChestNearPos 304 242 0` with `successfullif 3`) fires when it is opened and
brings the ally in.

The chest stands inside a ring of 21 finished `wall_01` segments the `map.dat` gives to player 1
(half-cells x 300-307, y 239-246), with no gate. Player 1 is a friend of player 0 and `player.inc`
locks that relation (`relationnotchangeable 0 1`); player 0 starts without a catapult. The authored
route is unplayable in this build: `sparedSide` in `packages/sim/src/systems/conflict/projectile.ts`
lets every shot pass over a side it is not at war with, which its comment names an approximation for
friends and neutrals, so player 0's catapult can never damage the ring.

## Scope

The real-content acceptance test
([mission-acceptance](../../../packages/app/test/real-content/missions/mission-acceptance.test.ts))
shows that the ring leaves the chest without a walking route. Confirm against the original whether a
seat's catapult strikes a friendly seat's finished wall segment, and if it does, replace the
`sparedSide` approximation with that generic rule. Do not add a map-specific movement exception,
delete the walls in content, or change the locked diplomacy.

## Verify

On the real map, obtain a catapult through ordinary play, breach the ring, open the chest and see
mission 4 fire and the ally arrive, without teleporting, deleting walls or forcing mission state.
Keep a synthetic case where friendly walls nobody attacks stay sealed.
