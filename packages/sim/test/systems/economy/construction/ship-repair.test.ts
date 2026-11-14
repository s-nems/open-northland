import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  Damaged,
  Health,
  mooringOf,
  Position,
  Settler,
  SiteAssignment,
  Stockpile,
  stampOwner,
  Vehicle,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import {
  adminCommand,
  halfCellMapFromCells,
  hexDistanceBetween,
  nodeOfPosition,
  ONE,
  positionOfNode,
  Simulation,
} from '../../../../src/index.js';
import { markStructureDamaged, needsRepair } from '../../../../src/systems/economy/repair.js';
import { createVehicle } from '../../../../src/systems/vehicles/index.js';
import { TEST_MANIFEST } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';

// Builders mend a damaged ship lying moored at the shore like a damaged building (owner rule).

const VIKING = 1;
const P0 = 0;
const GRASS = 0;
const WATER = 1;
const BUILDER = 7;
const BUILD_HOUSE_ATOMIC = 39;
const SHIP = 3;
const HANDCART = 1;
const HOUSE = 2;
const HOUSE_HITPOINTS = 1000;
const SHIP_HITPOINTS = 5000;
const CART_HITPOINTS = 1000;
const DOOR_DISTANCE = 4;
const MAP_W = 20;
const MAP_H = 10;
/** Cells from this column east are sea. */
const SEA_FROM = 6;
/** A sea node a ship moors from on the west shore. */
const NEAR_SHORE = { x: 15, y: 10 };
const BUILDER_AT = { x: 2, y: 10 };
/** A land node farther from a builder by the shore than the moored ship's mooring. */
const FAR_HOUSE_NODE = { hx: 1, hy: 2 };
const SHORE_BUILDER_AT = { x: 9, y: 10 };
/** Ample for the builder's walk and the swings that fill the hull. */
const REPAIR_TICKS = 6000;
/** Ample for an idle builder's re-plan. */
const PLAN_TICKS = 200;

function content(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    buildings: [{ typeId: HOUSE, id: 'home_small', kind: 'home', homeSize: 1, hitpoints: HOUSE_HITPOINTS }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: BUILDER, id: 'builder', allowedAtomics: [BUILD_HOUSE_ATOMIC] },
    ],
    landscape: [
      { typeId: GRASS, id: 'grass', walkable: true, buildable: true },
      { typeId: WATER, id: 'water', walkable: false, buildable: false },
    ],
    vehicles: [
      {
        typeId: SHIP,
        id: 'ship_small',
        jobId: 52,
        stockSlots: 0,
        logicSize: 2,
        passengerSlots: 4,
        passengerVector: { direction: 2, distance: DOOR_DISTANCE },
        hitpoints: SHIP_HITPOINTS,
      },
      { typeId: HANDCART, id: 'handcart', jobId: 50, stockSlots: 5, logicSize: 1, hitpoints: CART_HITPOINTS },
    ],
    tribes: [{ typeId: VIKING, id: 'viking' }],
  });
}

function sim(): Simulation {
  const typeIds = Array.from({ length: MAP_W * MAP_H }, (_, i) => (i % MAP_W >= SEA_FROM ? WATER : GRASS));
  const s = new Simulation({
    seed: 1,
    content: content(),
    map: halfCellMapFromCells({ width: MAP_W, height: MAP_H, typeIds }),
  });
  s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return s;
}

function vehicleAt(s: Simulation, type: number, at: { x: number; y: number }): Entity {
  const e = createVehicle(s.world, ctxOf(s), {
    vehicleType: type,
    x: at.x,
    y: at.y,
    tribe: VIKING,
    owner: P0,
  });
  if (e === null) throw new Error('setup: vehicle type missing');
  return e;
}

/** A ship the admin health tool leaves at `percent`, the way a tester hurts a hull. */
function hurtShipAt(s: Simulation, at: { x: number; y: number }, percent: number): Entity {
  const ship = vehicleAt(s, SHIP, at);
  s.enqueue(adminCommand({ kind: 'debugSetHealth', target: ship, percent }));
  return ship;
}

function builderAt(s: Simulation, at: { x: number; y: number }): Entity {
  s.enqueueSetup({ kind: 'spawnSettler', jobType: BUILDER, x: at.x, y: at.y, tribe: VIKING, owner: P0 });
  s.step();
  const settlers = [...s.world.query(Settler)];
  const builder = settlers[settlers.length - 1];
  if (builder === undefined) throw new Error('setup: builder missing');
  return builder;
}

describe('ship repair', () => {
  it('a builder walks to a damaged moored ship and mends it back to its max from the shore', () => {
    const s = sim();
    const ship = hurtShipAt(s, NEAR_SHORE, 40);
    const builder = builderAt(s, BUILDER_AT);
    const mooring = mooringOf(s.world, ship);
    if (mooring === null) throw new Error('setup: the ship should lie moored');
    expect(s.world.has(ship, Damaged)).toBe(true);

    let swungFrom: { hx: number; hy: number } | undefined;
    for (let i = 0; i < REPAIR_TICKS && s.world.has(ship, Damaged); i++) {
      s.step();
      if (swungFrom === undefined && s.world.tryGet(builder, CurrentAtomic)?.effect.kind === 'repair') {
        const p = s.world.get(builder, Position);
        swungFrom = nodeOfPosition(p.x, p.y);
      }
    }

    expect(s.world.get(ship, Health).hitpoints).toBe(SHIP_HITPOINTS);
    expect(s.world.has(ship, Damaged)).toBe(false);
    if (swungFrom === undefined) throw new Error('the builder never swung at the ship');
    expect(hexDistanceBetween(swungFrom.hx, swungFrom.hy, mooring.hx, mooring.hy)).toBeLessThanOrEqual(1);
  });

  it('leaves a damaged ship under way alone and mends it once it lies moored', () => {
    const s = sim();
    const ship = hurtShipAt(s, NEAR_SHORE, 40);
    s.world.mut(ship, Vehicle).moored = false;
    const builder = builderAt(s, BUILDER_AT);
    expect(needsRepair(s.world, ship)).toBe(false);

    s.run(PLAN_TICKS);
    expect(s.world.tryGet(builder, SiteAssignment)?.site).not.toBe(ship);
    expect(s.world.get(ship, Health).hitpoints).toBeLessThan(SHIP_HITPOINTS);

    s.world.mut(ship, Vehicle).moored = true;
    for (let i = 0; i < PLAN_TICKS && s.world.tryGet(builder, SiteAssignment)?.site !== ship; i++) s.step();
    expect(s.world.tryGet(builder, SiteAssignment)?.site).toBe(ship);
  });

  it('a builder mends a damaged building before a nearer moored ship', () => {
    const s = sim();
    const ship = hurtShipAt(s, NEAR_SHORE, 40);
    const house = s.world.create();
    s.world.add(house, Position, positionOfNode(FAR_HOUSE_NODE.hx, FAR_HOUSE_NODE.hy));
    s.world.add(house, Building, { buildingType: HOUSE, tribe: VIKING, built: ONE, level: 0 });
    s.world.add(house, Stockpile, { amounts: new Map() });
    s.world.add(house, Health, { hitpoints: HOUSE_HITPOINTS / 2, max: HOUSE_HITPOINTS });
    s.world.add(house, Damaged, { lastHitTick: null });
    stampOwner(s.world, house, P0);
    const builder = builderAt(s, SHORE_BUILDER_AT);

    for (let i = 0; i < PLAN_TICKS && !s.world.has(builder, SiteAssignment); i++) s.step();
    expect(s.world.tryGet(builder, SiteAssignment)?.site).toBe(house);
    for (let i = 0; i < REPAIR_TICKS && s.world.has(house, Damaged); i++) s.step();
    for (let i = 0; i < PLAN_TICKS && s.world.tryGet(builder, SiteAssignment)?.site !== ship; i++) s.step();
    expect(s.world.tryGet(builder, SiteAssignment)?.site).toBe(ship);
  });

  it('marks a hit ship for the builders and leaves a hit cart unmarked', () => {
    const s = sim();
    const ship = vehicleAt(s, SHIP, NEAR_SHORE);
    const cart = vehicleAt(s, HANDCART, BUILDER_AT);
    for (const e of [ship, cart]) {
      s.world.mut(e, Health).hitpoints -= 1;
      markStructureDamaged(s.world, ctxOf(s), e);
    }

    expect(s.world.has(ship, Damaged)).toBe(true);
    expect(s.world.has(cart, Damaged)).toBe(false);
  });
});
