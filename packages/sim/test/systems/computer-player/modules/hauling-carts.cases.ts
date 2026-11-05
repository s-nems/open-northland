import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, HaulingCart, Settler, setStockAmount } from '../../../../src/components/index.js';
import type { PlayerCommand } from '../../../../src/core/commands/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { Simulation } from '../../../../src/index.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import { AI_PROFILES } from '../../../../src/systems/computer-player/difficulty.js';
import { DEFAULT_BUILD_ORDER, SeatSupply } from '../../../../src/systems/computer-player/index.js';
import {
  AI_FREE_HANDCARTS,
  JOINERY_TOOL_GLUT_UNITS,
  tuneCraftCounters,
} from '../../../../src/systems/computer-player/workforce/craft.js';
import { assignHaulingCarts } from '../../../../src/systems/computer-player/workforce/hauling-carts.js';
import { createVehicle } from '../../../../src/systems/vehicles/index.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';
import {
  BUILDER,
  CARRIER,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  IRON,
  JOINER,
  JOINERY_TYPE,
  placeHq,
  postGatherer,
  SEAT,
  spawnMen,
  TOOL_IRON,
  VIKING,
} from '../support.js';

const HANDCART = 1;
const HANDCART_GOOD = 50;
const HANDCART_HOUSE = 78;
const JOINERY_AT = { x: 40, y: 16 };
const CART_ROW_Y = 28;
/** Columns between two free carts parked on {@link CART_ROW_Y}. */
const CART_SPACING = 4;

/** The fixture joinery recast as the upgraded tools joinery, with a handcart recipe and its vehicle. */
function cartContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: HANDCART_GOOD, id: 'handcart', weight: 0, vehicleHouse: HANDCART_HOUSE },
    ],
    buildings: [
      ...base.buildings.map((b) =>
        b.typeId === JOINERY_TYPE
          ? {
              ...b,
              id: 'work_joinery_02',
              recipes: [
                ...b.recipes,
                { inputs: [], outputs: [{ goodType: HANDCART_GOOD, amount: 1 }], ticks: 180 },
              ],
            }
          : b,
      ),
      {
        typeId: HANDCART_HOUSE,
        id: 'handcart',
        kind: 'vehicle',
        vehicleType: HANDCART,
        construction: [{ goodType: 1, amount: 2 }],
      },
    ],
    vehicles: [
      {
        typeId: HANDCART,
        id: 'handcart',
        jobId: 50,
        stockSlots: 15,
        logicSize: 0,
        cargoGoods: [1],
        passengerJobs: [CARRIER],
        hitpoints: 1000,
      },
    ],
  });
}

/** The upgraded joinery with `joiners` of `crew` builders hired as joiners and the rest as its carrier, on a
 *  seat that gathers iron. */
function joinery(crew: number, joiners: number) {
  const content = cartContent();
  const sim = new Simulation({ seed: 1, content, map: grassNodeMap(64, 32) });
  placeHq(sim);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: JOINERY_TYPE,
    ...JOINERY_AT,
    tribe: VIKING,
    owner: SEAT,
  });
  spawnMen(sim, crew, BUILDER);
  sim.step();
  const workshop = entityOfBuilding(sim, JOINERY_TYPE);
  const men = [...sim.world.query(Settler)]
    .filter((e) => sim.world.get(e, Settler).jobType === BUILDER)
    .sort((a, b) => a - b);
  men.forEach((man, i) => {
    sim.enqueueSetup({
      kind: 'assignWorker',
      entity: man,
      building: workshop,
      jobPriority: [i < joiners ? JOINER : CARRIER],
    });
    if (i < joiners) sim.enqueueSetup({ kind: 'setProductionGoods', entity: man, goods: [] });
  });
  sim.step();
  postGatherer(sim, IRON);
  const ctx = { ...ctxOf(sim), content };
  const apply = (commands: readonly PlayerCommand[]): readonly PlayerCommand[] => {
    for (const c of commands) sim.enqueueSetup(c);
    sim.step();
    return commands;
  };
  return {
    sim,
    men,
    cart(x: number): Entity {
      const e = createVehicle(sim.world, ctx, {
        vehicleType: HANDCART,
        x,
        y: CART_ROW_Y,
        tribe: VIKING,
        owner: SEAT,
      });
      if (e === null) throw new Error('handcart not in the fixture');
      return e;
    },
    products(): (readonly number[])[] {
      const supply = SeatSupply.of(
        sim.world,
        ctx,
        SEAT,
        ownedBuildings(sim.world, SEAT),
        DEFAULT_BUILD_ORDER,
      );
      return apply(tuneCraftCounters(sim.world, ctx, SEAT, supply, AI_PROFILES.hard)).flatMap((c) =>
        c.kind === 'setProductionGoods' ? [c.goods] : [],
      );
    },
    assign: () => apply(assignHaulingCarts(sim.world, ctx, SEAT)),
    yards: () =>
      ownedBuildings(sim.world, SEAT).filter(
        (e) => sim.world.get(e, Building).buildingType === HANDCART_HOUSE,
      ).length,
  };
}

describe('workforce module - the carriers’ handcarts', () => {
  it('has the upgraded joinery’s joiners make handcarts in turn with iron tools while fewer than two stand free', () => {
    const seat = joinery(3, 2);
    const both = [
      [TOOL_IRON, HANDCART_GOOD],
      [TOOL_IRON, HANDCART_GOOD],
    ];
    expect(seat.products()).toEqual(both);
    // A yard a joiner has opened is no free cart: the crew finishes it while the carts stand short.
    expect(seat.yards()).toBe(1);
    for (let free = 1; free < AI_FREE_HANDCARTS; free++) {
      seat.cart(JOINERY_AT.x + CART_SPACING * free);
      expect(seat.products()).toEqual([]);
    }
    seat.cart(JOINERY_AT.x);
    expect(seat.products()).toEqual([[TOOL_IRON], [TOOL_IRON]]);
    // The carrier takes the cart, so a free one is short again.
    expect(seat.assign()).toHaveLength(1);
    expect(seat.products()).toEqual(both);
  });

  it('keeps an apprentice joiner on iron tools past their glut, where his workmate rests', () => {
    const seat = joinery(3, 2);
    for (let free = 0; free < AI_FREE_HANDCARTS; free++) seat.cart(JOINERY_AT.x + CART_SPACING * free);
    setStockAmount(seat.sim.world, entityOfBuilding(seat.sim, HQ_TYPE), TOOL_IRON, JOINERY_TOOL_GLUT_UNITS);
    const [apprentice, workmate] = seat.men;
    if (apprentice === undefined || workmate === undefined) throw new Error('setup: two joiners');
    const ctx = { ...ctxOf(seat.sim), content: cartContent() };
    const supply = SeatSupply.of(
      seat.sim.world,
      ctx,
      SEAT,
      ownedBuildings(seat.sim.world, SEAT),
      DEFAULT_BUILD_ORDER,
    );
    const commands = tuneCraftCounters(
      seat.sim.world,
      ctx,
      SEAT,
      supply,
      AI_PROFILES.hard,
      new Set([apprentice]),
    );
    const of = (e: Entity) => commands.filter((c) => 'entity' in c && c.entity === e);
    expect(of(apprentice)).toEqual([{ kind: 'setProductionGoods', entity: apprentice, goods: [TOOL_IRON] }]);
    expect(of(workmate).some((c) => c.kind === 'setProductionCount')).toBe(true);
  });

  it('hands a free cart to the nearest posted carrier without one, once', () => {
    const seat = joinery(3, 2);
    const carrier = seat.men[2] as Entity;
    const cart = seat.cart(JOINERY_AT.x);
    expect(seat.assign()).toEqual([{ kind: 'attachToVehicle', entity: carrier, vehicle: cart }]);
    expect(seat.sim.world.get(carrier, HaulingCart).vehicle).toBe(cart);
    // The carrier holds it and no other carrier stands free, so a second cart waits.
    seat.cart(JOINERY_AT.x + 4);
    expect(seat.assign()).toEqual([]);
  });
});
