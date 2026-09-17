import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { components, type Entity, nodeOfPosition, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { contentDir, hasRealIr } from './helpers.js';
import { realMapWorld } from './real-map-world.js';

const {
  MissionObjectId,
  Position,
  Rider,
  Settler,
  Vehicle,
  VehicleStock,
  vehicleCommander,
  vehiclePassengers,
} = components;

/**
 * The decoded `setvehicle` rows and the `attachtovehicle` / `moveintovehicle` seats of two real maps,
 * through the map entry's own world build: a scripted crew that boards a ship before the first tick,
 * and carts whose authored cargo is stowed, booked and asked for with a carrier seated on each.
 */

/** Five heroes board the player's small ship, the first line's soldier as its commander. */
const SHIP_MAP = 'wybrzeze_czarow_sub2';
const SHIP_AT = { hx: 18, hy: 74 };
const SHIP_ID = 150;
const COMMANDER_ID = 30;
const CREW_IDS = [30, 31, 32, 33, 34];
const SHIP_SMALL = 'ship_small';

/** Three loaded carts with a carrier attached to each. */
const CART_MAP = 'blekiny_nurt';
const CARTS = [
  { at: { hx: 362, hy: 318 }, type: 'handcart', id: 91, goods: { holy_oil: 5, tool_iron: 10 } },
  { at: { hx: 362, hy: 312 }, type: 'oxcart', id: 92, goods: { wood: 10, mud: 10, stone: 10 } },
  { at: { hx: 364, hy: 320 }, type: 'oxcart', id: 93, goods: { food_extra: 25, water: 5 } },
] as const;
const CARRIER = 'carrier';

const REAL_MAP_TIMEOUT_MS = 60_000;

function vehicleAt(sim: Simulation, at: { hx: number; hy: number }): Entity {
  for (const e of sim.world.query(Vehicle, Position)) {
    const p = sim.world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    if (node.hx === at.hx && node.hy === at.hy) return e;
  }
  throw new Error(`no vehicle stands on (${at.hx},${at.hy})`);
}

describe.runIf(hasRealIr() && existsSync(resolve(contentDir(), 'maps')))(
  'authored decoded-map vehicles',
  () => {
    it(
      `${SHIP_MAP}: the five heroes ride the small ship, the first as commander, all aboard before tick one`,
      async () => {
        const { sim, content } = await realMapWorld({ mapId: SHIP_MAP, aiSeats: [] });
        const ship = vehicleAt(sim, SHIP_AT);
        const type = content.vehicles.find((v) => v.typeId === sim.world.get(ship, Vehicle).vehicleType);
        expect(type?.id).toBe(SHIP_SMALL);
        expect(sim.world.get(ship, MissionObjectId).id).toBe(SHIP_ID);
        const seats = vehiclePassengers(sim.world.get(ship, Vehicle));
        expect(seats).toHaveLength(CREW_IDS.length);
        const commander = vehicleCommander(sim.world.get(ship, Vehicle));
        if (commander === null) throw new Error('nobody commands the ship');
        expect(sim.world.get(commander, MissionObjectId).id).toBe(COMMANDER_ID);
        const crewIds = seats
          .map((seat) => sim.world.get(seat.entity, MissionObjectId).id)
          .sort((a, b) => a - b);
        expect(crewIds).toEqual(CREW_IDS);
        for (const seat of seats) {
          expect(seat.inside).toBe(true);
          expect(sim.world.has(seat.entity, Position)).toBe(false); // aboard: off the map
          expect(sim.world.get(seat.entity, Rider)).toEqual({ vehicle: ship, boarding: false });
        }
      },
      REAL_MAP_TIMEOUT_MS,
    );

    it(
      `${CART_MAP}: the carts carry their authored cargo, asked for as stowed, with a carrier seated on each`,
      async () => {
        const { sim, content } = await realMapWorld({ mapId: CART_MAP, aiSeats: [] });
        const goodByName = new Map(content.goods.map((g) => [g.id, g.typeId]));
        const carrierJob = content.jobs.find((j) => j.id === CARRIER)?.typeId;
        for (const spec of CARTS) {
          const cart = vehicleAt(sim, spec.at);
          const state = sim.world.get(cart, Vehicle);
          const type = content.vehicles.find((v) => v.typeId === state.vehicleType);
          // The `oxcart` row must land on the ox cart's own slug, not the ox-less cart's `cart_no_ox`,
          // which shares the name and comes first in the table.
          expect(type?.id).toBe(spec.type);
          expect(sim.world.get(cart, MissionObjectId).id).toBe(spec.id);
          const stock = sim.world.get(cart, VehicleStock);
          for (const [name, amount] of Object.entries(spec.goods)) {
            const good = goodByName.get(name);
            if (good === undefined) throw new Error(`the real content has no \`${name}\` good`);
            expect(
              stock.lines.get(good),
              `${spec.type} at (${spec.at.hx},${spec.at.hy}) holds ${name}`,
            ).toEqual({
              current: amount,
              wanted: amount,
              reserved: amount,
            });
          }
          const commander = vehicleCommander(state);
          if (commander === null)
            throw new Error(`nobody crews the ${spec.type} at (${spec.at.hx},${spec.at.hy})`);
          expect(sim.world.get(commander, Settler).jobType).toBe(carrierJob);
          expect(sim.world.get(commander, Rider).vehicle).toBe(cart);
        }
      },
      REAL_MAP_TIMEOUT_MS,
    );
  },
);
