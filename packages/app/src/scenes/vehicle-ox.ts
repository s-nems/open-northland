import { cellAnchorNode, components, type Entity, playerCommand, type Simulation } from '@open-northland/sim';
import { ANIMAL_TRIBE_CATTLE } from '../catalog/animal-tribes.js';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CARRIER } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_CART_NO_OX,
  VEHICLE_OXCART,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * An ox-less cart beside the player's small cattle herd: the cart waits for its draught animal, its goto
 * is refused with the "has no animal" note, then it recruits the nearest cow past the herd's breeding
 * pair, the cow walks over and is consumed, and the cart becomes an ox cart in place (docs/formats/VEHICLES.md
 * "Lifecycle"). The carrier standing by is refused off the bare cart and seated on the ox cart. The
 * browser view is the check that the sprite changes from the bare cart to the ox cart.
 */

const MAP_W = 22;
const MAP_H = 14;
const CART = { x: 9, y: 7 } as const;
const HERD_BIRTH = { x: 15, y: 7 } as const;
/** Two cows are the pair the recruit scan keeps; the two others are candidates. */
const HERD_SIZE = 4;
/** A carrier ordered onto the cart twice: refused while it is bare, seated once it is an ox cart. */
const CARRIER_AT = { x: 8, y: 9 } as const;
/** The goto and the first attach, ordered while the cart still waits: the goto is refused with
 *  `vehicleNoAnimal`, the attach because the bare type admits no trade. */
const GOTO_TICK = 2;
const GOTO_GOAL = { x: 12, y: 10 } as const;
/** The second attach, well past the measured harness: seed 17 consumes the cow by tick 130. */
const ATTACH_TICK = 400;
const RUN_TICKS = 600;
/** Claims positions no session transport hands out for those ticks. */
const ORDER_SEQUENCE = 1_000_000;

const { DraughtAnimal, HerdMember, Settler } = components;

function build(sim: Simulation): void {
  const cart = spawnVehicleDirect(sim, VEHICLE_CART_NO_OX, CART.x, CART.y);
  const birth = cellAnchorNode(HERD_BIRTH.x, HERD_BIRTH.y);
  sim.enqueueSetup({
    kind: 'spawnAnimalHerd',
    tribe: ANIMAL_TRIBE_CATTLE,
    x: birth.hx,
    y: birth.hy,
    count: HERD_SIZE,
    owner: HUMAN_PLAYER,
  });
  const carrier = spawnSettlerDirect(sim, JOB_CARRIER, CARRIER_AT.x, CARRIER_AT.y, HUMAN_PLAYER);
  const goal = cellAnchorNode(GOTO_GOAL.x, GOTO_GOAL.y);
  const attach = playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: carrier, vehicle: cart });
  sim.enqueueAt(
    playerCommand(HUMAN_PLAYER, { kind: 'moveVehicle', vehicle: cart, x: goal.hx, y: goal.hy }),
    GOTO_TICK,
    ORDER_SEQUENCE,
  );
  sim.enqueueAt(attach, GOTO_TICK, ORDER_SEQUENCE + 1);
  sim.enqueueAt(attach, ATTACH_TICK, ORDER_SEQUENCE);
}

function cattle(sim: Simulation): Entity[] {
  const herd: Entity[] = [];
  for (const e of sim.world.query(Settler)) {
    if (sim.world.get(e, Settler).tribe === ANIMAL_TRIBE_CATTLE) herd.push(e);
  }
  return herd.sort((a, b) => a - b);
}

export const vehicleOxScene: SceneDefinition = {
  id: 'vehicle-ox',
  seed: 17,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 1.2,
  checks: [
    {
      label: 'the bare cart became a harnessed ox cart where it stood',
      predicate: (sim) => {
        const views = sim.vehiclesOf(HUMAN_PLAYER);
        const at = cellAnchorNode(CART.x, CART.y);
        return (
          views.length === 1 &&
          views.every(
            (v) =>
              v.vehicleType === VEHICLE_OXCART &&
              v.harnessed &&
              v.task === 'none' &&
              v.at?.hx === at.hx &&
              v.at?.hy === at.hy,
          ) &&
          !views.some((v) => v.vehicleType === VEHICLE_CART_NO_OX)
        );
      },
    },
    {
      label: 'one cow was consumed and the breeding pair, the herd leader and its successor, still graze',
      predicate: (sim) => {
        const herd = cattle(sim);
        const [first, second] = herd;
        if (first === undefined || second === undefined) return false;
        // The herd spawned in one command, so its ids run from the leader upward: the pair survives when
        // the two lowest survivors are the leader and the next id.
        const leader = sim.world.get(first, HerdMember).leader;
        return (
          herd.length === HERD_SIZE - 1 &&
          first === leader &&
          Number(second) === Number(leader) + 1 &&
          herd.every((e) => !sim.world.has(e, DraughtAnimal))
        );
      },
    },
    {
      label: 'the carrier, refused off the bare cart, is seated on the ox cart',
      predicate: (sim) =>
        sim.vehiclesOf(HUMAN_PLAYER).every((v) => v.passengers.length === 1 && v.commander !== null),
    },
  ],
};
