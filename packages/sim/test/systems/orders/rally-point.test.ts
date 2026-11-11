import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  DeliveryFlag,
  Owner,
  Position,
  RallyPoint,
  UnderConstruction,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, halfCellMapFromCells, ONE, Simulation, type TerrainMap } from '../../../src/index.js';
import { removeBuildingSilently } from '../../../src/systems/lifecycle/cleanup.js';
import { WORK_FLAG_SNAP_MAX_RADIUS } from '../../../src/systems/orders/work/selection.js';
import { entityNode } from '../../../src/systems/spatial/nodes.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/needs.js';

// The `setRallyPoint` / `clearRallyPoint` orders: a finished barracks plants one flag on its own land,
// moves that same flag, and loses it on a clear or with the building. The walk to it is the drill's
// (`settlers/drives/barracks-training.test.ts`).

const PLAYER = 0;
const VIKING = 1;
const CARRIER_JOB = 24;
const BARRACKS_TYPE = 91;
const HEADQUARTERS_TYPE = 1;
const GRASS = 0;
const WATER = 1;
const WIDTH = 24;
const HEIGHT = 8;
/** Cell columns of water, wider than the flag snap reaches, with the far bank beyond them. */
const WATER_FROM = 10;
const WATER_TO = 18;
const BARRACKS = { x: 4, y: 3 } as const;
/** Half-cell nodes: beside the barracks, mid-water past the snap radius, and on the far bank. */
const NEAR = { x: 8, y: 12 } as const;
const MID_WATER = { x: 2 * WATER_FROM + WORK_FLAG_SNAP_MAX_RADIUS + 2, y: 8 } as const;
const FAR_BANK = { x: 2 * WATER_TO + 6, y: 8 } as const;

function content(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      // A LEARN house that employs haulers: what `isBarracksType` tells from the school.
      {
        typeId: BARRACKS_TYPE,
        id: 'barracks',
        kind: 'training',
        workers: [{ jobType: CARRIER_JOB, count: 4 }],
      },
    ],
  });
}

function twoBanks(): TerrainMap {
  const typeIds = new Array<number>(WIDTH * HEIGHT).fill(GRASS);
  for (let row = 0; row < HEIGHT; row++)
    for (let column = WATER_FROM; column < WATER_TO; column++) typeIds[row * WIDTH + column] = WATER;
  return halfCellMapFromCells({ width: WIDTH, height: HEIGHT, typeIds });
}

function setup(buildingType = BARRACKS_TYPE): { sim: Simulation; house: Entity } {
  const sim = new Simulation({ seed: 1, content: content(), map: twoBanks() });
  const house = sim.world.create();
  sim.world.add(house, Position, { x: fx.fromInt(BARRACKS.x), y: fx.fromInt(BARRACKS.y) });
  sim.world.add(house, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(house, Owner, { player: PLAYER });
  return { sim, house };
}

function setRally(sim: Simulation, building: Entity, node: { x: number; y: number }): void {
  sim.enqueueSetup({ kind: 'setRallyPoint', building, ...node });
  sim.step();
}

describe('setRallyPoint', () => {
  it('plants one flag, moves that same flag on the next order, and a clear takes it away', () => {
    const { sim, house } = setup();
    setRally(sim, house, NEAR);
    const flag = sim.world.get(house, RallyPoint).flag;
    expect(sim.world.has(flag, DeliveryFlag)).toBe(true);
    const terrain = ctxOf(sim).terrain;
    if (terrain === undefined) throw new Error('fixture map missing');
    const planted = entityNode(sim.world, terrain, flag);

    setRally(sim, house, { x: NEAR.x + 4, y: NEAR.y });
    expect(sim.world.get(house, RallyPoint).flag).toBe(flag);
    expect(entityNode(sim.world, terrain, flag)).not.toBe(planted);

    sim.enqueueSetup({ kind: 'clearRallyPoint', building: house });
    sim.step();
    expect(sim.world.has(house, RallyPoint)).toBe(false);
    expect(sim.world.isAlive(flag)).toBe(false);
  });

  it('refuses a foundation and a building that is no barracks', () => {
    const site = setup();
    site.sim.world.add(site.house, UnderConstruction, { labor: fx.fromInt(0) });
    site.sim.world.mut(site.house, Building).built = fx.fromInt(0);
    setRally(site.sim, site.house, NEAR);
    expect(site.sim.world.has(site.house, RallyPoint)).toBe(false);

    const headquarters = setup(HEADQUARTERS_TYPE);
    setRally(headquarters.sim, headquarters.house, NEAR);
    expect(headquarters.sim.world.has(headquarters.house, RallyPoint)).toBe(false);
  });

  it('refuses ground the flag cannot snap to and ground on another shore', () => {
    const { sim, house } = setup();
    setRally(sim, house, MID_WATER);
    expect(sim.world.has(house, RallyPoint)).toBe(false);
    setRally(sim, house, FAR_BANK);
    expect(sim.world.has(house, RallyPoint)).toBe(false);
  });

  it('takes the flag down with a barracks that is removed', () => {
    const { sim, house } = setup();
    setRally(sim, house, NEAR);
    const flag = sim.world.get(house, RallyPoint).flag;
    removeBuildingSilently(sim.world, ctxOf(sim), house);
    expect(sim.world.isAlive(flag)).toBe(false);
  });
});
