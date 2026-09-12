# Connect map scripts to playable vehicles

**Area:** sim, app · **Priority:** P2

Deferred until playable vehicle entities, movement, cargo and crews exist. Vehicle catalog data and
ship construction scaffolding do not supply this runtime. Coordinate with
[vehicle construction](vehicle-yard-construction.md); this ticket owns the map-script integration.

## Scope

- Load authored vehicle placements, mission object ids and their initial goods into the vehicle runtime.
- Implement vehicle spawning/removal, movement/docking, ownership and mission-id changes.
- Connect boarding, disembarking and goods results to the same runtime used by player commands.
- Implement vehicle goals and include vehicles in mixed human/vehicle area and ownership operations.
- Preserve crews, cargo, orders and script identity through save/load and sub-mission return.
- Update opcode support and MISSIONS.md only for implemented behavior; name fidelity approximations.

## Verify

Use synthetic scenarios for docking, cargo, crews, ownership and save/load, plus an intact loose-map
script using vehicles. Run the relevant sim/app checks and coverage report. Archive campaign extraction
is outside scope.
