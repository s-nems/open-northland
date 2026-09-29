import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import { Building } from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import { Simulation, type TerrainMap } from '../../../src/index.js';
import { hexDistanceBetween } from '../../../src/nav/halfcell.js';
import { withinNodeRadius } from '../../../src/nav/node-circle.js';
import {
  type BuildOrderEntry,
  buildOrderModule,
  DEFAULT_BUILD_ORDER,
  entryStatuses,
  WELL_REACH_NODES,
} from '../../../src/systems/ai-player/index.js';
import * as seaRoute from '../../../src/systems/ai-player/sea-route.js';
import { VEHICLE_SITE_PLACEMENT_RINGS } from '../../../src/systems/footprint/index.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import {
  BARRACKS_TYPE,
  completeSites,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  JOINERY_TYPE,
  MILL_TYPE,
  SEAT,
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
const SHIP_SMALL = 3;
/** The real small ship's free-size class. */
const SHIP_LOGIC_SIZE = 2;

/** The AI fixture with the joinery chain up to its top tier, the druid hut, and a small ship raised on
 *  water, whose `logicSize` the shore affinity reads. */
function fleetContent(): ContentSet {
  const base = aiContent();
  const bill = [{ goodType: WOOD, amount: 2 }];
  return parseContentSet({
    ...base,
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
      { typeId: JOINERY_03_TYPE, id: 'work_joinery_03', kind: 'workplace', construction: bill },
      { typeId: DRUID_TYPE, id: 'work_druid_01', kind: 'workplace', construction: bill },
      {
        typeId: SHIP_HOUSE_TYPE,
        id: 'ship_small',
        kind: 'vehicle',
        vehicleType: SHIP_SMALL,
        ignoreContinents: true,
        construction: bill,
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

interface MapShape {
  readonly bridge?: boolean;
  readonly lake?: boolean;
}

/** A sea between our land and the enemy's, with a land bridge over it or a lake on our side on request. */
function seaMap({ bridge = false, lake = false }: MapShape = {}): TerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H).fill(GRASS);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const sea = x >= SEA_WEST && x < SEA_EAST && !(bridge && y >= HOME.y - 2 && y < HOME.y + 2);
      const pond = lake && x >= LAKE.x0 && x < LAKE.x1 && y >= LAKE.y0 && y < LAKE.y1;
      if (sea || pond) typeIds[y * MAP_W + x] = WATER;
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

const shipJoinery = placeEntry((e) => e.onlyWhen === 'enemyOverSea');
const catapultJoinery = placeEntry((e) => e.building === 'work_joinery_03' && e.unlessWithin !== undefined);
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
  it('puts the ship joinery on our shore within a ship yard search of water a ship can sail', () => {
    const map = seaMap();
    const sim = world(map);
    const spot = first(sim, [shipJoinery]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected the ship joinery placement');
    expect(spot.buildingType).toBe(JOINERY_03_TYPE);
    expect(spot.x).toBeLessThan(SEA_WEST);
    // Sailable water sits a ship's free-size class off the shore, inside the yard search's rings.
    expect(hexDistanceBetween(spot.x, spot.y, SEA_WEST + SHIP_LOGIC_SIZE, spot.y)).toBeLessThan(
      VEHICLE_SITE_PLACEMENT_RINGS,
    );
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

describe('build order - the top-tier joineries', () => {
  const BARRACKS_AT = { x: 30, y: 20 };

  /** Runs the ship and catapult entries to the end, finishing each site, and counts the top-tier joineries. */
  function topJoineries(map: TerrainMap): number {
    const sim = world(map, [{ buildingType: BARRACKS_TYPE, ...BARRACKS_AT }]);
    for (let round = 0; round < 4; round++) {
      const command = first(sim, [shipJoinery, catapultJoinery]);
      if (command === undefined) break;
      sim.enqueueSetup(command);
      sim.step();
      completeSites(sim);
    }
    return [...sim.world.query(Building)].filter(
      (e) => sim.world.get(e, Building).buildingType === JOINERY_03_TYPE,
    ).length;
  }

  it('raises one by the barracks on a land map and one more by the shore on a sea map', () => {
    expect(topJoineries(landMap())).toBe(1);
    expect(topJoineries(seaMap())).toBe(2);
  });

  it('puts the catapult joinery beside the barracks', () => {
    const spot = first(world(landMap(), [{ buildingType: BARRACKS_TYPE, ...BARRACKS_AT }]), [
      catapultJoinery,
    ]);
    if (spot?.kind !== 'placeBuilding' || catapultJoinery.unlessWithin === undefined)
      throw new Error('expected the catapult joinery placement');
    expect(spot.buildingType).toBe(JOINERY_03_TYPE);
    expect(
      withinNodeRadius(BARRACKS_AT.x, BARRACKS_AT.y, spot.x, spot.y, catapultJoinery.unlessWithin.radius),
    ).toBe(true);
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
