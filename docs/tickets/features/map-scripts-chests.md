# Complete the remaining land-vehicle chest reward

**Area:** sim, app, pipeline · **Priority:** P2

Reward chests, their interaction, persistent opened state, map-script placement/detection, paper
rewards and permanent workshop-production unlocks are implemented. The remaining known parity gap is
the catapult reward because the simulation does not yet support land vehicles.

## Scope

- Implement land vehicles and the catapult type used by chest row 91.
- Spawn the catapult for both wooden and magical row-91 chests, matching the original placement and
  ownership behavior.
- Replace the documented empty-reward approximation in the chest table and mission format notes.

## Verify

Cover catapult spawning, ownership, blocked placement, repeated interaction and save/load. Run the
vehicle, chest and mission test suites plus the full repository gates.
