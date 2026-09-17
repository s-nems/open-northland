# Sail ships on water and dock them on a shore

**Area:** sim · **Focus:** `packages/sim/src/nav`, `systems/vehicles` · **Priority:** P2
**Blocked by:** [crew and boarding](vehicles-5-crew-and-boarding.md)

`TerrainGraph` is land-only; `waterContinents` labels water nodes for fishing but no edge set
crosses water. Ships use the same graph in the original with clearance `>= 2` and continent
equality; docking scans a ring of radius `passengerVector[1]` around a clicked land point and
needs no port ([VEHICLES.md](../../formats/VEHICLES.md#ships-and-docking)).

## Scope

- Water edges: nodes whose continent is a water body become passable for movers with a water
  traversal class; the free-size class from the movement ticket applies on water, so a ship keeps
  two nodes of clearance from the shore. Land and water continents share the continent key used by
  the goto and snap rules.
- `dockVehicle {vehicle, x, y}` (`g`): commander required; a moored ship boards everyone first;
  find a node on the ship's continent within the ring of radius `passengerVector[1]` around the
  point with clearance `>= logicSize`, move there with task `docks`, store the mooring point, play
  the dock action, set moored. Arrival raises the docked message; no node raises `vehicleNoPath`.
- The door node of a moored ship is the mooring point; unload people and detach use it. Leaving the
  mooring clears the moored flag.
- A ship destroyed at sea already kills its crew (`removeVehicle`); a sunk ship's passengers must
  count as dead for goals.
- Mission results `SendVehicle` and `DockVehicle` reuse the seat commands after the radius-9 snap.

Out of scope: the sea trader (an empty stub in the original), AI use of ships.

## Verify

Unit tests on a synthetic island map: water pathing with clearance, dock ring search, mooring
point as door, unload on a far shore, refusal without a commander. Acceptance scene: a ship
carries a party across a strait and lands it. Determinism golden. `npm test`, `npm run check`.
