import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import {
  Building,
  JobAssignment,
  Owner,
  Settler,
  setStockAmount,
  Vehicle,
} from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation, type TerrainMap } from '../../../src/index.js';
import { withinNodeRadius } from '../../../src/nav/node-circle.js';
import {
  type BuildOrderEntry,
  buildOrderModule,
  DEFAULT_BUILD_ORDER,
  entryStatuses,
  SeatSupply,
  WELL_REACH_NODES,
} from '../../../src/systems/ai-player/index.js';
import { type JoineryRole, joineryRoles } from '../../../src/systems/ai-player/joinery-role.js';
import { anchorNodeOf } from '../../../src/systems/ai-player/node-geometry.js';
import * as seaRoute from '../../../src/systems/ai-player/sea-route.js';
import { ownedBuildings } from '../../../src/systems/ai-player/seat-roster.js';
import { tuneCraftCounters } from '../../../src/systems/ai-player/workforce/craft.js';
import { findVehicleSite, VEHICLE_SITE_PLACEMENT_RINGS } from '../../../src/systems/footprint/index.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import {
  BARRACKS_TYPE,
  BUILDER,
  CARRIER,
  completeSites,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  JOINER,
  JOINERY_TYPE,
  MILL_TYPE,
  SEAT,
  spawnMen,
  TOWER_TYPE,
  VIKING,
  WELL_TYPE,
  WOOD,
} from './support.js';

const ENEMY = SEAT + 1;
const GRASS = 0;
const WATER = 1;
const JOINERY_02_TYPE = 60;
const JOINERY_03_TYPE = 61;
const DRUID_TYPE = 62;
const SHIP_HOUSE_TYPE = 63;
const CATAPULT_HOUSE_TYPE = 64;
const SHIP_SMALL = 3;
const CATAPULT = 5;
/** The real small ship's and catapult's free-size classes. */
const SHIP_LOGIC_SIZE = 2;
const CATAPULT_LOGIC_SIZE = 1;
/** The vehicle goods the top-tier joinery's crew builds on a yard. */
const SHIP_GOOD = 40;
const CATAPULT_GOOD = 41;
/** The real top-tier joinery's joiner seats. */
const TOP_JOINERY_JOINERS = 3;
/** The real small-ship yard body, rows -2..2 and five wide at the middle, its door on the shore. */
const SHIP_HULL = [
  [-1, -2],
  [0, -2],
  [1, -2],
  [-2, -1],
  [-1, -1],
  [0, -1],
  [1, -1],
  [-2, 0],
  [-1, 0],
  [0, 0],
  [1, 0],
  [2, 0],
  [-2, 1],
  [-1, 1],
  [0, 1],
  [1, 1],
  [-1, 2],
  [0, 2],
  [1, 2],
].map(([dx, dy]) => ({ dx: dx as number, dy: dy as number }));
const SHIP_DOOR = { dx: -2, dy: 3 };
/** The real catapult yard body and door. */
const CATAPULT_BODY = [
  [-1, -1],
  [0, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
].map(([dx, dy]) => ({ dx: dx as number, dy: dy as number }));
const CATAPULT_DOOR = { dx: -1, dy: 2 };

/** The AI fixture with the joinery chain up to its top tier, the druid hut, and the yards of a small ship
 *  raised on water, whose `logicSize` the shore affinity reads, and of a catapult. The top tier's three
 *  joiners build the two vehicles out of the stores' wood. */
function fleetContent(): ContentSet {
  const base = aiContent();
  const bill = [{ goodType: WOOD, amount: 2 }];
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: SHIP_GOOD, id: 'ship_small', weight: 0, vehicleHouse: SHIP_HOUSE_TYPE },
      { typeId: CATAPULT_GOOD, id: 'catapult', weight: 0, vehicleHouse: CATAPULT_HOUSE_TYPE },
    ],
    buildings: [
      ...base.buildings.map((b) =>
        b.typeId === JOINERY_TYPE ? { ...b, upgradeTarget: JOINERY_02_TYPE } : b,
      ),
      {
        typeId: JOINERY_02_TYPE,
        id: 'work_joinery_02',
        kind: 'workplace',
        upgradeTarget: JOINERY_03_TYPE,
        construction: bill,
      },
      {
        typeId: JOINERY_03_TYPE,
        id: 'work_joinery_03',
        kind: 'workplace',
        construction: bill,
        workers: [
          { jobType: JOINER, count: TOP_JOINERY_JOINERS },
          { jobType: CARRIER, count: 1 },
        ],
        produces: [SHIP_GOOD, CATAPULT_GOOD],
        recipes: [SHIP_GOOD, CATAPULT_GOOD].map((goodType) => ({
          inputs: [],
          outputs: [{ goodType, amount: 1 }],
          ticks: 180,
        })),
      },
      { typeId: DRUID_TYPE, id: 'work_druid_01', kind: 'workplace', construction: bill },
      {
        typeId: SHIP_HOUSE_TYPE,
        id: 'ship_small',
        kind: 'vehicle',
        vehicleType: SHIP_SMALL,
        ignoreContinents: true,
        construction: bill,
        footprint: { blocked: SHIP_HULL, familyBody: SHIP_HULL, reserved: SHIP_HULL, door: SHIP_DOOR },
      },
      {
        typeId: CATAPULT_HOUSE_TYPE,
        id: 'catapult',
        kind: 'vehicle',
        vehicleType: CATAPULT,
        construction: bill,
        footprint: {
          blocked: CATAPULT_BODY,
          familyBody: CATAPULT_BODY,
          reserved: CATAPULT_BODY,
          door: CATAPULT_DOOR,
        },
      },
    ],
    vehicles: [
      {
        typeId: SHIP_SMALL,
        id: 'ship_small',
        jobId: 52,
        hitpoints: 5000,
        stockSlots: 50,
        passengerSlots: 19,
        logicSize: SHIP_LOGIC_SIZE,
        cargoGoods: [WOOD],
      },
      {
        typeId: CATAPULT,
        id: 'catapult',
        jobId: 54,
        hitpoints: 3000,
        stockSlots: 0,
        passengerSlots: 0,
        logicSize: CATAPULT_LOGIC_SIZE,
        cargoGoods: [],
      },
    ],
  });
}

const MAP_W = 128;
const MAP_H = 64;
/** Our shore: the sea fills half-cell columns `SEA_WEST..SEA_EAST - 1` from top to bottom. */
const SEA_WEST = 56;
const SEA_EAST = 80;
const HOME = { x: 24, y: 32 };
const ENEMY_HOME = { x: 104, y: 32 };
/** A lake on our side, nearer the base than the sea. */
const LAKE = { x0: 28, x1: 40, y0: 2, y1: 14 };
/** A bay the sea reaches into our land by: its south shore is where a ship yard fits, since the yard's
 *  door stands south of its hull and the sea's straight west shore admits none. */
const BAY = { x0: 44, x1: SEA_WEST, y0: 36, y1: 44 };
/** The same bay further south, beyond the reach of a settlement of the headquarters alone. */
const FAR_BAY = { ...BAY, y0: 50, y1: 58 };

interface MapShape {
  readonly bridge?: boolean;
  readonly lake?: boolean;
  readonly bay?: typeof BAY | null;
}

/** A sea between our land and the enemy's reaching into ours by a bay, with a land bridge over it or a
 *  lake on our side on request. */
function seaMap({ bridge = false, lake = false, bay = BAY }: MapShape = {}): TerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H).fill(GRASS);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const sea = x >= SEA_WEST && x < SEA_EAST && !(bridge && y >= HOME.y - 2 && y < HOME.y + 2);
      const pond = lake && x >= LAKE.x0 && x < LAKE.x1 && y >= LAKE.y0 && y < LAKE.y1;
      const inlet = bay !== null && x >= bay.x0 && x < bay.x1 && y >= bay.y0 && y < bay.y1;
      if (sea || pond || inlet) typeIds[y * MAP_W + x] = WATER;
    }
  }
  return { resolution: 'half-cell', width: MAP_W, height: MAP_H, typeIds };
}

function landMap(): TerrainMap {
  return {
    resolution: 'half-cell',
    width: MAP_W,
    height: MAP_H,
    typeIds: new Array(MAP_W * MAP_H).fill(GRASS),
  };
}

interface Site {
  readonly buildingType: number;
  readonly x: number;
  readonly y: number;
  readonly owner?: number;
}

/** Our HQ, the enemy's unless `enemyHq` is false, and `sites`, all standing. */
function world(map: TerrainMap, sites: readonly Site[] = [], enemyHq = true): Simulation {
  const sim = new Simulation({ seed: 1, content: fleetContent(), map });
  for (const player of [SEAT, ENEMY])
    sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player, tribes: [VIKING] });
  const all: Site[] = [
    { buildingType: HQ_TYPE, ...HOME },
    ...(enemyHq ? [{ buildingType: HQ_TYPE, ...ENEMY_HOME, owner: ENEMY }] : []),
    ...sites,
  ];
  for (const { owner = SEAT, ...site } of all) {
    sim.enqueueSetup({ kind: 'placeBuilding', ...site, tribe: VIKING, owner, force: true });
  }
  sim.step();
  return sim;
}

function fleetCtx(sim: Simulation): SystemContext {
  return { ...ctxOf(sim), content: fleetContent() };
}

function first(sim: Simulation, order: readonly BuildOrderEntry[]): Command | undefined {
  return [...buildOrderModule(order).run(sim.world, fleetCtx(sim), SEAT)][0];
}

function placeEntry(
  test: (entry: Extract<BuildOrderEntry, { kind: 'place' }>) => boolean,
): Extract<BuildOrderEntry, { kind: 'place' }> {
  for (const entry of DEFAULT_BUILD_ORDER) if (entry.kind === 'place' && test(entry)) return entry;
  throw new Error('entry missing from the default list');
}

const shipJoinery = placeEntry((e) => e.role === 'ship');
const catapultJoinery = placeEntry((e) => e.role === 'catapult');
const toolsJoinery = placeEntry((e) => e.building === 'work_joinery_01');
const druidWell = placeEntry(
  (e) => e.building === 'work_well_00' && e.unlessWithin?.building === 'work_druid_01',
);
/** The ship joinery's placement without its sea gate, so the shore affinity is tested on any map. */
const shoreJoinery: BuildOrderEntry = {
  kind: 'place',
  building: 'work_joinery_03',
  count: 1,
  near: [{ kind: 'shore' }],
};
const toolsUpgrade = DEFAULT_BUILD_ORDER.find(
  (e) => e.kind === 'upgrade' && e.building === 'work_joinery_02',
);

function isWaterAt(map: TerrainMap, x: number, y: number): boolean {
  return map.typeIds[y * MAP_W + x] === WATER;
}

describe('build order - the sea route', () => {
  it('needs a ship only when the nearest enemy headquarters stands on another continent', () => {
    const overSea = world(seaMap());
    expect(seaRoute.enemyOverSea(overSea.world, fleetCtx(overSea), SEAT)).toBe(true);
    const bridged = world(seaMap({ bridge: true }));
    expect(seaRoute.enemyOverSea(bridged.world, fleetCtx(bridged), SEAT)).toBe(false);
    // Only a tower stands over the sea: no headquarters to sail for.
    const towerOnly = world(seaMap(), [{ buildingType: TOWER_TYPE, ...ENEMY_HOME, owner: ENEMY }], false);
    expect(seaRoute.enemyOverSea(towerOnly.world, fleetCtx(towerOnly), SEAT)).toBe(false);
  });

  it('reads each enemy seat’s headquarters, never its other buildings', () => {
    const ENEMY_TOWERS = [
      { x: HOME.x + 6, y: HOME.y },
      { x: ENEMY_HOME.x - 6, y: ENEMY_HOME.y },
      { x: ENEMY_HOME.x, y: ENEMY_HOME.y + 8 },
    ];
    const sim = world(
      seaMap(),
      ENEMY_TOWERS.map((at) => ({ buildingType: TOWER_TYPE, ...at, owner: ENEMY })),
    );
    const towers = ownedBuildings(sim.world, ENEMY).filter(
      (e) => sim.world.get(e, Building).buildingType === TOWER_TYPE,
    );
    expect(towers).toHaveLength(ENEMY_TOWERS.length);
    const read = vi.spyOn(sim.world, 'get');
    try {
      const ctx = fleetCtx(sim);
      expect(seaRoute.enemyOverSea(sim.world, ctx, SEAT)).toBe(true);
      expect(seaRoute.nearestEnemyBuilding(sim.world, ctx, SEAT, { hx: HOME.x, hy: HOME.y })).toMatchObject({
        headquarters: true,
      });
      expect(read.mock.calls.filter(([e]) => towers.includes(e))).toEqual([]);
    } finally {
      read.mockRestore();
    }
  });

  it('asks the sea question once a decision, however many entries depend on it', () => {
    const sim = world(seaMap());
    const asked = vi.spyOn(seaRoute, 'enemyOverSea');
    try {
      const statuses = entryStatuses(sim.world, fleetCtx(sim), SEAT, [
        shipJoinery,
        { ...shipJoinery, count: 2 },
      ]);
      expect(statuses).toEqual(['unmet', 'unmet']);
      expect(asked).toHaveBeenCalledTimes(1);
    } finally {
      asked.mockRestore();
    }
  });
});

describe('build order - the shore affinity', () => {
  it('puts the ship joinery on our shore where its ship yard search finds a site', () => {
    const map = seaMap();
    const sim = world(map);
    const spot = first(sim, [shipJoinery]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected the ship joinery placement');
    expect(spot.buildingType).toBe(JOINERY_03_TYPE);
    expect(spot.x).toBeLessThan(SEA_WEST);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const yard = findVehicleSite(
      sim.world,
      fleetCtx(sim),
      terrain,
      SHIP_HOUSE_TYPE,
      VIKING,
      { hx: spot.x, hy: spot.y },
      terrain.nodeAt(spot.x, spot.y),
    );
    expect(yard.kind).toBe('site');
  });

  it('places nothing by a straight shore, where no ship yard fits', () => {
    expect(first(world(seaMap({ bay: null })), [shipJoinery])).toBeUndefined();
  });

  it('prefers the sea that reaches the enemy over a nearer lake, and takes the lake when no enemy lies over the sea', () => {
    const map = seaMap({ lake: true });
    const toSea = first(world(map), [shoreJoinery]);
    if (toSea?.kind !== 'placeBuilding') throw new Error('expected a shore placement');
    expect(toSea.x).toBeGreaterThan(LAKE.x1);
    const noEnemy = first(world(map, [], false), [shoreJoinery]);
    if (noEnemy?.kind !== 'placeBuilding') throw new Error('expected a lake placement');
    expect(noEnemy.y).toBeLessThan(LAKE.y1 + VEHICLE_SITE_PLACEMENT_RINGS);
    expect(isWaterAt(map, noEnemy.x, noEnemy.y)).toBe(false);
  });

  it('places nothing by the shore where no water lies in reach', () => {
    expect(first(world(landMap()), [shoreJoinery])).toBeUndefined();
  });
});

/** Each top-tier joinery of the seat with its role this decision, ascending id. */
function rolesOf(sim: Simulation): JoineryRole[] {
  const ctx = fleetCtx(sim);
  const roleOf = joineryRoles(sim.world, ctx, SEAT, () => seaRoute.enemyOverSea(sim.world, ctx, SEAT));
  return ownedBuildings(sim.world, SEAT)
    .filter((e) => sim.world.get(e, Building).buildingType === JOINERY_03_TYPE)
    .map(roleOf);
}

/** Runs `order` to the end, finishing each site. */
function buildOut(sim: Simulation, order: readonly BuildOrderEntry[]): void {
  for (let round = 0; round < 4; round++) {
    const command = first(sim, order);
    if (command === undefined) return;
    sim.enqueueSetup(command);
    sim.step();
    completeSites(sim);
  }
}

describe('build order - the top-tier joineries', () => {
  const BARRACKS_AT = { x: 30, y: 20 };
  /** How near the barracks the catapult joinery's spot lands, in world-metric nodes. */
  const BESIDE_BARRACKS_NODES = 12;

  function topJoineryRoles(map: TerrainMap, barracks = BARRACKS_AT): JoineryRole[] {
    const sim = world(map, [{ buildingType: BARRACKS_TYPE, ...barracks }]);
    buildOut(sim, [shipJoinery, catapultJoinery]);
    return rolesOf(sim);
  }

  it('raises a catapult joinery on a land map and a ship joinery besides on a sea map', () => {
    expect(topJoineryRoles(landMap())).toEqual(['catapult']);
    expect(topJoineryRoles(seaMap())).toEqual(['ship', 'catapult']);
  });

  it('raises both where the barracks stands by the shore, the first one on the water building ships', () => {
    const BY_THE_BAY = { x: 46, y: 50 };
    expect(topJoineryRoles(seaMap(), BY_THE_BAY)).toEqual(['ship', 'catapult']);
    // Placed first, the catapult joinery by the water takes the ship role, and the next one catapults.
    const sim = world(seaMap(), [{ buildingType: BARRACKS_TYPE, ...BY_THE_BAY }]);
    buildOut(sim, [catapultJoinery, shipJoinery]);
    expect(rolesOf(sim)).toEqual(['ship', 'catapult']);
  });

  it('still raises the ship joinery once the shore comes in reach after the catapult joinery stands', () => {
    const FROM_THE_BARRACKS = { x: 30, y: 12 };
    const TOWARD_THE_BAY = { x: 40, y: 50 };
    const map = seaMap({ bay: FAR_BAY });
    const sim = world(map, [
      { buildingType: BARRACKS_TYPE, ...BARRACKS_AT },
      { buildingType: JOINERY_03_TYPE, ...FROM_THE_BARRACKS },
    ]);
    expect(entryStatuses(sim.world, fleetCtx(sim), SEAT, [shipJoinery, catapultJoinery])).toEqual([
      'unmet',
      'satisfied',
    ]);
    expect(first(sim, [shipJoinery])).toBeUndefined();
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: TOWER_TYPE,
      ...TOWARD_THE_BAY,
      tribe: VIKING,
      owner: SEAT,
      force: true,
    });
    sim.step();
    buildOut(sim, [shipJoinery, catapultJoinery]);
    expect(rolesOf(sim)).toEqual(['catapult', 'ship']);
    expect(entryStatuses(sim.world, fleetCtx(sim), SEAT, [shipJoinery, catapultJoinery])).toEqual([
      'satisfied',
      'satisfied',
    ]);
  });

  it('keeps a joinery by the water on catapults and skips the ship joinery where the enemy lies over land', () => {
    const sim = world(seaMap({ bridge: true }), [
      { buildingType: BARRACKS_TYPE, ...BARRACKS_AT },
      { buildingType: JOINERY_03_TYPE, x: 44, y: 50 },
    ]);
    expect(rolesOf(sim)).toEqual(['catapult']);
    expect(entryStatuses(sim.world, fleetCtx(sim), SEAT, [shipJoinery, catapultJoinery])).toEqual([
      'skip',
      'satisfied',
    ]);
  });

  it('puts the catapult joinery beside the barracks', () => {
    const spot = first(world(landMap(), [{ buildingType: BARRACKS_TYPE, ...BARRACKS_AT }]), [
      catapultJoinery,
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected the catapult joinery placement');
    expect(spot.buildingType).toBe(JOINERY_03_TYPE);
    expect(withinNodeRadius(BARRACKS_AT.x, BARRACKS_AT.y, spot.x, spot.y, BESIDE_BARRACKS_NODES)).toBe(true);
  });

  it.each([
    ['a land map', 1],
    ['a sea map', 2],
  ])(
    'upgrades the tools joinery a tier on %s, the top-tier joineries counting for neither of its entries',
    (_, tops) => {
      if (toolsUpgrade === undefined) throw new Error('tools upgrade missing from the default list');
      const TOOLS_AT = { x: 40, y: 16 };
      const topSites = [
        { buildingType: JOINERY_03_TYPE, x: 30, y: 44 },
        { buildingType: JOINERY_03_TYPE, x: 50, y: 44 },
      ].slice(0, tops);
      const onlyTops = world(landMap(), topSites);
      expect(entryStatuses(onlyTops.world, fleetCtx(onlyTops), SEAT, [toolsJoinery])).toEqual(['unmet']);

      const sim = world(landMap(), [{ buildingType: JOINERY_TYPE, ...TOOLS_AT }, ...topSites]);
      const upgrade = first(sim, [toolsUpgrade]);
      expect(upgrade).toEqual({ kind: 'upgradeBuilding', building: entityOfBuilding(sim, JOINERY_TYPE) });
      const upgraded = world(landMap(), [{ buildingType: JOINERY_02_TYPE, ...TOOLS_AT }, ...topSites]);
      expect(entryStatuses(upgraded.world, fleetCtx(upgraded), SEAT, [toolsJoinery, toolsUpgrade])).toEqual([
        'satisfied',
        'satisfied',
      ]);
    },
  );
});

describe('build order - the druid wells', () => {
  const DRUID_AT = { x: 44, y: 16 };
  const order: readonly BuildOrderEntry[] = [
    druidWell,
    { kind: 'place', building: 'work_mill_00', count: 1 },
  ];

  function druidSeat(wellX: number): Command | undefined {
    const sim = world(landMap(), [
      { buildingType: DRUID_TYPE, ...DRUID_AT },
      { buildingType: WELL_TYPE, x: wellX, y: DRUID_AT.y },
    ]);
    return first(sim, order);
  }

  it('raises a well beside a druid hut with none in reach', () => {
    const command = druidSeat(DRUID_AT.x - 3 * WELL_REACH_NODES);
    if (command?.kind !== 'placeBuilding') throw new Error('expected a well placement');
    expect(command.buildingType).toBe(WELL_TYPE);
    expect(withinNodeRadius(DRUID_AT.x, DRUID_AT.y, command.x, command.y, WELL_REACH_NODES)).toBe(true);
  });

  it('skips the well while one stands beside the druid hut', () => {
    expect(druidSeat(DRUID_AT.x + 4)).toMatchObject({ kind: 'placeBuilding', buildingType: MILL_TYPE });
  });
});

describe('workforce - the top-tier joineries’ roles', () => {
  const BARRACKS_AT = { x: 30, y: 20 };
  const BY_BARRACKS = { x: 30, y: 12 };
  const AWAY = { x: 44, y: 50 };
  /** Wood in the headquarters for every yard bill a test runs. */
  const YARD_WOOD = 40;
  /** Well past the crew's walk, the bill's fetch and the hammering. */
  const LAUNCH_BUDGET_TICKS = 6000;

  /** Hire `TOP_JOINERY_JOINERS` fresh men at `joinery` as its joiners. */
  function crew(sim: Simulation, joinery: Entity): void {
    const hired = new Set([...sim.world.query(JobAssignment)]);
    spawnMen(sim, TOP_JOINERY_JOINERS, BUILDER);
    sim.step();
    for (const man of [...sim.world.query(Settler)].sort((a, b) => a - b)) {
      if (hired.has(man) || sim.world.get(man, Settler).jobType !== BUILDER) continue;
      sim.enqueueSetup({ kind: 'assignWorker', entity: man, building: joinery, jobPriority: [JOINER] });
    }
    sim.step();
  }

  function topJoineryAt(sim: Simulation, at: { x: number; y: number }): Entity {
    const found = ownedBuildings(sim.world, SEAT).find(
      (e) =>
        sim.world.get(e, Building).buildingType === JOINERY_03_TYPE &&
        anchorNodeOf(sim.world, e)?.hx === at.x &&
        anchorNodeOf(sim.world, e)?.hy === at.y,
    );
    if (found === undefined) throw new Error(`setup: no top-tier joinery at ${at.x}, ${at.y}`);
    return found;
  }

  /** One decision's craft selections, keyed by the joiners' workplace; applied to the sim. */
  function tuned(sim: Simulation): Map<Entity, (readonly number[])[]> {
    const ctx = fleetCtx(sim);
    const supply = SeatSupply.of(sim.world, ctx, SEAT, ownedBuildings(sim.world, SEAT), DEFAULT_BUILD_ORDER);
    const byWorkplace = new Map<Entity, (readonly number[])[]>();
    for (const c of tuneCraftCounters(sim.world, ctx, SEAT, supply)) {
      if (c.kind !== 'setProductionGoods') continue;
      const workplace = sim.world.get(c.entity, JobAssignment).workplace;
      byWorkplace.set(workplace, [...(byWorkplace.get(workplace) ?? []), c.goods]);
      sim.enqueueSetup(c);
    }
    sim.step();
    return byWorkplace;
  }

  function crewedJoineries(map: TerrainMap, spots: readonly { x: number; y: number }[]) {
    const sim = world(map, [
      { buildingType: BARRACKS_TYPE, ...BARRACKS_AT },
      ...spots.map((at) => ({ buildingType: JOINERY_03_TYPE, ...at })),
    ]);
    const joineries = spots.map((at) => topJoineryAt(sim, at));
    for (const joinery of joineries) crew(sim, joinery);
    return { sim, joineries };
  }

  const all = (good: number) => Array.from({ length: TOP_JOINERY_JOINERS }, () => [good]);

  it('puts a whole crew on catapults away from the water and another on ships by a sea seat’s shore', () => {
    const { sim, joineries } = crewedJoineries(seaMap(), [BY_BARRACKS, AWAY]);
    const [byBarracks, away] = joineries;
    if (byBarracks === undefined || away === undefined) throw new Error('setup: two joineries');
    // The untuned crew has opened a yard on the water, whose body blocks it: the ship role holds.
    expect(
      ownedBuildings(sim.world, SEAT).some(
        (e) => sim.world.get(e, Building).buildingType === SHIP_HOUSE_TYPE,
      ),
    ).toBe(true);
    expect(tuned(sim)).toEqual(
      new Map([
        [byBarracks, all(CATAPULT_GOOD)],
        [away, all(SHIP_GOOD)],
      ]),
    );
    // Applied, the selections hold: the next decision issues nothing.
    expect(tuned(sim)).toEqual(new Map());
  });

  it('puts a crew by the water on catapults where no enemy lies over the sea', () => {
    const { sim, joineries } = crewedJoineries(landMap(), [AWAY]);
    expect(tuned(sim)).toEqual(new Map([[joineries[0], all(CATAPULT_GOOD)]]));
  });

  it('asks the sea question once a decision, and puts one crew by the water on ships', () => {
    const { sim } = crewedJoineries(seaMap(), [AWAY, { x: 44, y: 46 }]);
    const asked = vi.spyOn(seaRoute, 'enemyOverSea');
    try {
      expect([...tuned(sim).values()]).toEqual([all(SHIP_GOOD), all(CATAPULT_GOOD)]);
      expect(asked).toHaveBeenCalledTimes(1);
    } finally {
      asked.mockRestore();
    }
  });

  function vehiclesOf(sim: Simulation, vehicleType: number): Entity[] {
    return [...sim.world.query(Vehicle)].filter((e) => sim.world.get(e, Vehicle).vehicleType === vehicleType);
  }

  /** Stock the yard wood, tune the crews once, and step until a `vehicleType` launches. */
  function launch(sim: Simulation, vehicleType: number): Entity | undefined {
    const hq = ownedBuildings(sim.world, SEAT).find(
      (e) => sim.world.get(e, Building).buildingType === HQ_TYPE,
    );
    if (hq === undefined) throw new Error('setup: our headquarters');
    setStockAmount(sim.world, hq, WOOD, YARD_WOOD);
    tuned(sim);
    for (let i = 0; i < LAUNCH_BUDGET_TICKS && vehiclesOf(sim, vehicleType).length === 0; i++) sim.step();
    return vehiclesOf(sim, vehicleType)[0];
  }

  it('launches a catapult from the joinery beside the barracks', () => {
    const { sim } = crewedJoineries(landMap(), [BY_BARRACKS]);
    const catapult = launch(sim, CATAPULT);
    if (catapult === undefined) throw new Error('no catapult launched');
    expect(sim.world.get(catapult, Owner).player).toBe(SEAT);
    expect(vehiclesOf(sim, SHIP_SMALL)).toEqual([]);
  });

  it('launches a small ship from the joinery the build order put by the shore', () => {
    const sim = world(seaMap(), [{ buildingType: BARRACKS_TYPE, ...BARRACKS_AT }]);
    const spot = first(sim, [shipJoinery]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected the ship joinery placement');
    sim.enqueueSetup(spot);
    sim.step();
    completeSites(sim);
    crew(sim, topJoineryAt(sim, spot));
    const ship = launch(sim, SHIP_SMALL);
    if (ship === undefined) throw new Error('no ship launched');
    expect(sim.world.get(ship, Owner).player).toBe(SEAT);
    expect(vehiclesOf(sim, CATAPULT)).toEqual([]);
  });
});
