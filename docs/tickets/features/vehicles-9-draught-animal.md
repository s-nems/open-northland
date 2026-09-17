# Harness an ox to a cart that needs one

**Area:** sim · **Focus:** `packages/sim/src/systems/vehicles`, `systems/animals` · **Priority:** P3
**Blocked by:** [crew and boarding](vehicles-5-crew-and-boarding.md)

Type 6 (`cart_no_ox`) is what a joinery builds; it has no passenger slots and cannot move until an
animal of tribe 10 is harnessed, after which it becomes type 2 in place
([VEHICLES.md](../../formats/VEHICLES.md#lifecycle)).

## Scope

- Task `waitsForAnimal` whenever `draggingAnimalTribe` is set and the cart is not harnessed; the
  cart recruits from the owner's animals of that tribe on the door's continent that are not already
  attached, skipping the first two eligible animals and taking the nearest by hex distance.
- The animal walks to the door node; on arrival it is removed, the cart is marked harnessed,
  becomes `transformVehicleType` with the new job id, clearance and sprite.
- A goto on an unharnessed cart raises `vehicleNoAnimal`.

## Verify

Unit tests: breeding-pair skip, nearest choice, continent filter, transform in place, refusal
message. `npm test`.
