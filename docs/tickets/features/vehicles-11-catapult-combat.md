# Fire catapults through the shared weapon-hit path and let vehicles take damage

**Area:** sim · **Focus:** `packages/sim/src/systems/conflict`, `systems/vehicles` · **Priority:** P2
**Blocked by:** [crew and boarding](vehicles-5-crew-and-boarding.md)

The catapult is a vehicle with one soldier or hero as commander firing weapon 21 through the same
delayed-hit path as archers; ships never attack but any vehicle can be hit
([VEHICLES.md](../../formats/VEHICLES.md#catapult)). `projectile.ts` already calibrates its speed
constant against the catapult but has no launcher that is a vehicle, and no target class for one.

## Scope

- Stances `attack | defence | hold` (init hold) with their scan ranges 0..40 / 0..40 / 8..24,
  the 60-node chase leash in defence, and seat commands for the three stances and
  `attackWithVehicle {vehicle, target: human | house | vehicle | position}` (`h`, `i`, `k`, `l`;
  `l` on enemy landscape becomes an attack-ground order).
- Targeting: enemy units inside buildings, then enemy houses, keeping the nearer of new and current;
  hostility by diplomacy; too close backs off, in range fires, too far approaches or scans a
  radius-5 flood for a firing node.
- Fire: 48-tick attack clip, event at tick 1: scatter roll against `commanderSkill + 10`, flight
  `dist * 8 / speed`, one delayed hit covering humans, animals, houses, vehicles and landscape,
  including the owner's own (`hitself`); the commander gains experience for weapon 21; only weapon 21
  demolishes landscape of main type 4 (walls: subtype `> 2` steps down, else cleared).
- Damage to vehicles from any weapon: `damage[6] * 200 / (200 - min(armour, 100))`, armour 0,
  `vehicleAttacked` message; soldiers can be ordered to attack a vehicle (`attackVehicle` ring order);
  towers and archers include vehicles in their target scan.
- Mission goal `VehiclesDied`.

## Verify

Unit tests: stance scans, back-off, scatter bounds with a seeded RNG, hitself, wall demolition,
vehicle damage and removal, archer versus catapult. Acceptance scene: a catapult batters a wall
and a hut. Determinism golden. `npm test`, `npm run check`.
