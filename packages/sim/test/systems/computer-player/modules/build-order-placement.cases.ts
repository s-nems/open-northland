import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  mapBriefOf,
  Position,
  Resource,
  Settler,
  StalledPlacements,
  setStockAmount,
} from '../../../../src/components/index.js';
import type { Command } from '../../../../src/core/commands/index.js';
import { positionOfNode, Simulation, type TerrainMap } from '../../../../src/index.js';
import { GRASS_BESIDE_NODES, spotAcceptor } from '../../../../src/systems/ai-shared/building-spot.js';
import { bestRingNode } from '../../../../src/systems/ai-shared/node-geometry.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import { FRONT_EDGE_STEP_NODES } from '../../../../src/systems/computer-player/build-order/affinity.js';
import { FRONT_LINE_DEPTH_NODES } from '../../../../src/systems/computer-player/build-order/front.js';
import { grassScarce } from '../../../../src/systems/computer-player/build-order/grass-reserve.js';
import {
  CHAIN_ROOM_RADIUS_NODES,
  FARM_ROOM_RESOURCE_PENALTY_RINGS,
  HOME_FARM_MARGIN_NODES,
} from '../../../../src/systems/computer-player/build-order/placement.js';
import { buildReach } from '../../../../src/systems/computer-player/build-order/reach.js';
import {
  BUILD_SEARCH_MAX_RADIUS_NODES,
  type BuildOrder,
  type BuildOrderEntry,
  buildOrderModule,
  COMPUTER_DECISION_INTERVAL_TICKS,
  DEFAULT_BUILD_ORDER,
  enemyFire,
  HQ_PULL_DIVISOR_NODES,
  overflowBuildReachNodes,
  STALLED_PLACEMENT_RETRY_DECISIONS,
} from '../../../../src/systems/computer-player/index.js';
import { seatTerritoryOf } from '../../../../src/systems/computer-player/knowledge/map-intent/index.js';
import { canPlaceBuilding, stampResourceFootprintData } from '../../../../src/systems/index.js';
import { SUCCESSFUL_IF } from '../../../../src/systems/missions/index.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap, waterColumnMap } from '../../../fixtures/terrain.js';
import {
  aiSim,
  COLLECTOR,
  ctxOf,
  entityOfBuilding,
  FARM_TYPE,
  HOME_TYPE,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  IRON,
  MUD,
  makeAiSeat,
  oneLine,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SAND,
  SEAT,
  SPEARMAN,
  STOCK_TYPE,
  STONE,
  STONE_HARVEST,
  TOWER_TYPE,
  VIKING,
  WELL_TYPE,
} from '../support.js';

/** The fixture's edible good, field-farmed where a test gives it a `farming` block. */
const FOOD_GOOD = 3;

/** How near a deposit an affinity placement that keeps off it still lands (a reserved ring plus one). */
const DEPOSIT_NEIGHBOURHOOD_NODES = 4;

describe('build-order placement - affinity and ground rules', () => {
  /** A half-cell node map that is grass except where `sandy(x, y)` says otherwise. */
  function mapWithSand(width: number, height: number, sandy: (x: number, y: number) => boolean): TerrainMap {
    const typeIds = new Array<number>(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) typeIds[y * width + x] = sandy(x, y) ? SAND : 0;
    }
    return { resolution: 'half-cell', width, height, typeIds };
  }

  const ESSENTIAL_FARM: BuildOrderEntry = {
    kind: 'place',
    building: 'work_farm_00',
    count: 1,
    ground: 'plantable',
    essential: true,
  };

  function firstCommandOf(
    sim: Simulation,
    order: readonly BuildOrderEntry[] | BuildOrder,
  ): Command | undefined {
    const lines = 'lines' in order ? order : oneLine(order);
    return [...buildOrderModule(lines).run(sim.world, ctxOf(sim), SEAT)][0];
  }

  it('places the farm only on plantable ground - a barren pocket is skipped, a barren map stalls', () => {
    // Sand within 6 nodes of the HQ: the farm must land beyond it, on the first grass ring.
    const SAND_RADIUS = 6;
    const pocket = new Simulation({
      seed: 1,
      content: aiContent(),
      map: mapWithSand(64, 32, (x, y) => Math.abs(x - HQ_X) + Math.abs(y - HQ_Y) <= SAND_RADIUS),
    });
    placeHq(pocket);
    pocket.step();
    const farm = firstCommandOf(pocket, DEFAULT_BUILD_ORDER);
    if (farm?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
    expect(Math.abs(farm.x - HQ_X) + Math.abs(farm.y - HQ_Y)).toBeGreaterThan(SAND_RADIUS);

    // An all-sand map stalls the farm (hard rule) even though the ground is buildable - proven by
    // a home entry placing fine on the same ground.
    const barren = new Simulation({ seed: 1, content: aiContent(), map: mapWithSand(64, 32, () => true) });
    placeHq(barren);
    barren.step();
    expect(firstCommandOf(barren, [ESSENTIAL_FARM])).toBeUndefined();
    const home = firstCommandOf(barren, [{ kind: 'place', building: 'home_level_00', count: 1 }]);
    expect(home?.kind).toBe('placeBuilding');
  });

  /** A home first, then a well still to place, which keeps a grass-short seat's reservation on. */
  const HOME_BEFORE_WELL: readonly BuildOrderEntry[] = [
    { kind: 'place', building: 'home_level_00', count: 1 },
    { kind: 'place', building: 'work_well_00', count: 1 },
  ];

  it('keeps a home off the grass on a seat short of it, and builds on the grass once nothing else is left', () => {
    // A grass patch round the HQ, far under the scarcity line, and sand beyond it.
    const GRASS_RADIUS = 8;
    const onPatch = (x: number, y: number) => Math.abs(x - HQ_X) + Math.abs(y - HQ_Y) <= GRASS_RADIUS;
    const home = HOME_BEFORE_WELL;
    const scarce = new Simulation({
      seed: 1,
      content: aiContent(),
      map: mapWithSand(64, 32, (x, y) => !onPatch(x, y)),
    });
    placeHq(scarce);
    scarce.step();
    const terrain = scarce.terrain;
    if (terrain === undefined) throw new Error('expected a mapped sim');
    expect(grassScarce(terrain, { hx: HQ_X, hy: HQ_Y })).toBe(true);
    const offGrass = firstCommandOf(scarce, home);
    if (offGrass?.kind !== 'placeBuilding') throw new Error('expected the home placement');
    expect(onPatch(offGrass.x, offGrass.y)).toBe(false);

    // The same patch ringed by water: no other ground in reach, so the home takes the grass.
    const WATER = 1;
    const typeIds = new Array<number>(64 * 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) typeIds[y * 64 + x] = onPatch(x, y) ? 0 : WATER;
    const island = new Simulation({
      seed: 1,
      content: aiContent(),
      map: { resolution: 'half-cell', width: 64, height: 32, typeIds },
    });
    placeHq(island);
    island.step();
    expect(firstCommandOf(island, home)?.kind).toBe('placeBuilding');
  });

  it('takes the grass in reach before the off-grass ground past it', () => {
    // A grass patch round the HQ, moor nothing can stand on out to past the reach, sand beyond: the sand
    // only the overflow reaches loses to the reserved grass in reach.
    const MOOR = 3;
    const base = aiContent();
    const content = parseContentSet({
      ...base,
      landscape: [...base.landscape, { typeId: MOOR, id: 'moor', walkable: true, buildable: false }],
    });
    const GRASS_RADIUS = 8;
    const BELT = BUILD_SEARCH_MAX_RADIUS_NODES + 4;
    const WIDE = 2 * (HQ_X + overflowBuildReachNodes(BUILD_SEARCH_MAX_RADIUS_NODES));
    const typeIds = new Array<number>(WIDE * 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < WIDE; x++) {
        const distance = Math.abs(x - HQ_X) + Math.abs(y - HQ_Y);
        typeIds[y * WIDE + x] = distance <= GRASS_RADIUS ? 0 : distance <= BELT ? MOOR : SAND;
      }
    }
    const sim = new Simulation({
      seed: 1,
      content,
      map: { resolution: 'half-cell', width: WIDE, height: 32, typeIds },
    });
    placeHq(sim);
    sim.step();
    const home = [
      ...buildOrderModule(oneLine(HOME_BEFORE_WELL)).run(sim.world, { ...ctxOf(sim), content }, SEAT),
    ][0];
    if (home?.kind !== 'placeBuilding') throw new Error('expected the home placement');
    expect(Math.abs(home.x - HQ_X) + Math.abs(home.y - HQ_Y)).toBeLessThanOrEqual(GRASS_RADIUS);
  });

  it('lets a home take the grass beside the HQ where grass is plentiful', () => {
    // A patch wide enough to clear the scarcity line, sand beyond it as before.
    const GRASS_RADIUS = 20;
    const onPatch = (x: number, y: number) => Math.abs(x - HQ_X) + Math.abs(y - HQ_Y) <= GRASS_RADIUS;
    const sim = new Simulation({
      seed: 1,
      content: aiContent(),
      map: mapWithSand(64, 32, (x, y) => !onPatch(x, y)),
    });
    placeHq(sim);
    sim.step();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected a mapped sim');
    expect(grassScarce(terrain, { hx: HQ_X, hy: HQ_Y })).toBe(false);
    const home = firstCommandOf(sim, HOME_BEFORE_WELL);
    if (home?.kind !== 'placeBuilding') throw new Error('expected the home placement');
    expect(onPatch(home.x, home.y)).toBe(true);
  });

  it('passes over a well with no grass in reach and calls no clearing gatherers for it', () => {
    const sim = new Simulation({ seed: 1, content: aiContent(), map: mapWithSand(64, 32, () => true) });
    placeHq(sim);
    sim.step();
    makeAiSeat(sim, SEAT);
    const command = firstCommandOf(sim, [
      { kind: 'place', building: 'work_well_00', count: 1 },
      { kind: 'place', building: 'home_level_00', count: 1, belowTier: 'home_level_01' },
    ]);
    expect(command).toMatchObject({ kind: 'placeBuilding', buildingType: HOME_TYPE });
    // The clearing gatherers answer only a search that holds the list.
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI carrier');
    expect(sim.world.tryGet(carrier, StalledPlacements)?.holding.size ?? 0).toBe(0);
  });

  it('frees the reserved grass once the last grass building of the list is placed', () => {
    const GRASS_RADIUS = 8;
    const onPatch = (x: number, y: number) => Math.abs(x - HQ_X) + Math.abs(y - HQ_Y) <= GRASS_RADIUS;
    const sim = new Simulation({
      seed: 1,
      content: aiContent(),
      map: mapWithSand(64, 32, (x, y) => !onPatch(x, y)),
    });
    placeHq(sim);
    sim.step();
    const well = firstCommandOf(sim, [{ kind: 'place', building: 'work_well_00', count: 1 }]);
    if (well?.kind !== 'placeBuilding') throw new Error('expected the well placement');
    expect(onPatch(well.x, well.y)).toBe(true);
    sim.enqueueSetup(well);
    sim.step();
    const home = firstCommandOf(sim, [
      { kind: 'place', building: 'work_well_00', count: 1 },
      { kind: 'place', building: 'home_level_00', count: 1 },
    ]);
    if (home?.kind !== 'placeBuilding') throw new Error('expected the home placement');
    expect(onPatch(home.x, home.y)).toBe(true);
  });

  it('raises one well on a seat short of grass however many the entry counts, and every one on a green seat', () => {
    const wells: BuildOrderEntry[] = [{ kind: 'place', building: 'work_well_00', count: 3 }];
    const patch = (radius: number) =>
      new Simulation({
        seed: 1,
        content: aiContent(),
        map: mapWithSand(64, 32, (x, y) => Math.abs(x - HQ_X) + Math.abs(y - HQ_Y) > radius),
      });
    const SCARCE_RADIUS = 8;
    const GREEN_RADIUS = 20;
    for (const [radius, more] of [
      [SCARCE_RADIUS, false],
      [GREEN_RADIUS, true],
    ] as const) {
      const sim = patch(radius);
      placeHq(sim);
      sim.step();
      const first = firstCommandOf(sim, wells);
      if (first?.kind !== 'placeBuilding') throw new Error('expected the first well');
      sim.enqueueSetup(first);
      sim.step();
      expect(firstCommandOf(sim, wells) !== undefined, `radius ${radius}`).toBe(more);
    }
  });

  it('passes over a grass placement with no grass in reach but holds the list for an essential one', () => {
    // The mill stands in for the herb hut, which the fixture lacks: a `plantable` entry, not essential.
    const sim = new Simulation({ seed: 1, content: aiContent(), map: mapWithSand(64, 32, () => true) });
    placeHq(sim);
    sim.step();
    const after = { kind: 'place', building: 'home_level_00', count: 1, belowTier: 'home_level_01' } as const;
    expect(
      firstCommandOf(sim, [
        { kind: 'place', building: 'work_mill_00', count: 1, ground: 'plantable' },
        after,
      ]),
    ).toMatchObject({ kind: 'placeBuilding', buildingType: HOME_TYPE });
    expect(
      firstCommandOf(sim, [
        { kind: 'place', building: 'work_farm_00', count: 1, ground: 'plantable', essential: true },
        after,
      ]),
    ).toBeUndefined();
  });

  it('stands the farm on grass where it fits, beside free grass where it does not, and never beside taken grass', () => {
    // A grass patch too small for nothing but a point farm's anchor - the fixture farm has no footprint, so
    // a single node fits it: a sand map with one grass node first takes the farm on it.
    const GRASS_AT = { x: 40, y: 16 };
    const lone = () =>
      new Simulation({
        seed: 1,
        content: aiContent(),
        map: mapWithSand(64, 32, (x, y) => x !== GRASS_AT.x || y !== GRASS_AT.y),
      });
    const farmEntry: BuildOrderEntry[] = [
      { kind: 'place', building: 'work_farm_00', count: 1, ground: 'plantable' },
    ];
    const onIt = lone();
    placeHq(onIt);
    onIt.step();
    expect(firstCommandOf(onIt, farmEntry)).toMatchObject({ x: GRASS_AT.x, y: GRASS_AT.y });

    // A home on that node: the grass is taken, so no spot beside it serves either.
    const taken = lone();
    placeHq(taken);
    taken.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: GRASS_AT.x,
      y: GRASS_AT.y,
      tribe: VIKING,
      owner: SEAT,
    });
    taken.step();
    expect(firstCommandOf(taken, farmEntry)).toBeUndefined();
  });

  it('stands the farm beside grass past the reach when none fits on it, on its own land only', () => {
    // Sand out to beyond the reach around the HQ, grass past it: the farm stops at the reach's edge,
    // beside the grass its workers sow.
    const BELT = BUILD_SEARCH_MAX_RADIUS_NODES + 4;
    const WIDE = 2 * (HQ_X + overflowBuildReachNodes(BUILD_SEARCH_MAX_RADIUS_NODES));
    const barrenBelt = (x: number, y: number) => Math.abs(x - HQ_X) + Math.abs(y - HQ_Y) <= BELT;
    const overflow = new Simulation({
      seed: 1,
      content: aiContent(),
      map: mapWithSand(WIDE, 32, barrenBelt),
    });
    placeHq(overflow);
    overflow.step();
    const farm = firstCommandOf(overflow, DEFAULT_BUILD_ORDER);
    if (farm?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
    const distance = Math.abs(farm.x - HQ_X) + Math.abs(farm.y - HQ_Y);
    expect(distance).toBeGreaterThan(BELT - GRASS_BESIDE_NODES);
    expect(distance).toBeLessThanOrEqual(BUILD_SEARCH_MAX_RADIUS_NODES);

    // The same grass behind a strait: the farm stalls rather than standing where no worker walks.
    const WATER = 1;
    const STRAIT_X = HQ_X + BELT + 1;
    const typeIds = new Array<number>(WIDE * 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < WIDE; x++) {
        const west = x < STRAIT_X;
        typeIds[y * WIDE + x] = x === STRAIT_X ? WATER : west || barrenBelt(x, y) ? SAND : 0;
      }
    }
    const island = new Simulation({
      seed: 1,
      content: aiContent(),
      map: { resolution: 'half-cell', width: WIDE, height: 32, typeIds },
    });
    placeHq(island);
    island.step();
    expect(firstCommandOf(island, [ESSENTIAL_FARM])).toBeUndefined();
  });

  it('places a stalled placement on the first retry after room frees, not the first decision', () => {
    // One grass node on a sand map, held by a well: the farm has nowhere to go until the well is razed.
    const GRASS_AT = { x: 40, y: 16 };
    const FREED_AT_DECISION = STALLED_PLACEMENT_RETRY_DECISIONS + 5;
    const sim = new Simulation({
      seed: 1,
      content: aiContent(),
      map: mapWithSand(64, 32, (x, y) => x !== GRASS_AT.x || y !== GRASS_AT.y),
    });
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: WELL_TYPE,
      ...GRASS_AT,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    makeAiSeat(sim, SEAT);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected a mapped sim');
    const farm = buildOrderModule(
      oneLine([{ kind: 'place', building: 'work_farm_00', count: 1, ground: 'plantable', essential: true }]),
    );

    let placedAt: number | null = null;
    for (
      let decision = 0;
      placedAt === null && decision <= 2 * STALLED_PLACEMENT_RETRY_DECISIONS;
      decision++
    ) {
      if (decision === FREED_AT_DECISION) {
        sim.enqueueSetup({ kind: 'demolish', building: entityOfBuilding(sim, WELL_TYPE) });
        sim.step();
      }
      const commands = farm.run(
        sim.world,
        ctxOf(sim, SEAT + decision * COMPUTER_DECISION_INTERVAL_TICKS),
        SEAT,
      );
      if (commands.length > 0) placedAt = decision;
    }
    // Freed mid-interval, the farm waits for the next retry instead of the next decision.
    expect(placedAt).toBe(2 * STALLED_PLACEMENT_RETRY_DECISIONS);
  });

  it('pulls a resource-affinity placement toward the deposit while staying in the near-HQ band', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.stone]);
    sim.step();
    const spot = firstCommandOf(sim, [
      { kind: 'place', building: 'work_bakery_00', count: 1, near: [{ kind: 'resource', good: 'stone' }] },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected an affinity placement');
    const toStone = Math.abs(spot.x - RESOURCE_SPOTS.stone.x) + Math.abs(spot.y - RESOURCE_SPOTS.stone.y);
    expect(toStone).toBeLessThanOrEqual(2); // beside the deposit, not beside the HQ
    expect(Math.abs(spot.x - HQ_X) + Math.abs(spot.y - HQ_Y)).toBeLessThanOrEqual(
      BUILD_SEARCH_MAX_RADIUS_NODES,
    );
  });

  it('pulls a resource-affinity placement toward the store holding the most of the good once no deposit stands', () => {
    const sim = aiSim();
    placeHq(sim);
    const FAR_STORE = { x: HQ_X + 28, y: HQ_Y };
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: STOCK_TYPE,
      x: FAR_STORE.x,
      y: FAR_STORE.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    setStockAmount(sim.world, entityOfBuilding(sim, STOCK_TYPE), IRON, 40);
    const order: BuildOrderEntry[] = [
      { kind: 'place', building: 'work_bakery_00', count: 1, near: [{ kind: 'resource', good: 'iron' }] },
    ];
    const spot = firstCommandOf(sim, order);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected an affinity placement');
    const toStore = Math.abs(spot.x - FAR_STORE.x) + Math.abs(spot.y - FAR_STORE.y);
    const toHq = Math.abs(spot.x - HQ_X) + Math.abs(spot.y - HQ_Y);
    expect(toStore).toBeLessThan(toHq); // beside the iron in store, not beside the HQ
    // With the store emptied the pull is gone: the placement lands beside the HQ.
    setStockAmount(sim.world, entityOfBuilding(sim, STOCK_TYPE), IRON, 0);
    const bare = firstCommandOf(sim, order);
    if (bare?.kind !== 'placeBuilding') throw new Error('expected a base placement');
    expect(Math.abs(bare.x - HQ_X) + Math.abs(bare.y - HQ_Y)).toBeLessThan(
      Math.abs(bare.x - FAR_STORE.x) + Math.abs(bare.y - FAR_STORE.y),
    );
  });

  it('pulls a building-affinity placement beside the named building', () => {
    const WELL_AT = { x: 44, y: 20 };
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: WELL_TYPE,
      x: WELL_AT.x,
      y: WELL_AT.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const spot = firstCommandOf(sim, [
      {
        kind: 'place',
        building: 'work_bakery_00',
        count: 1,
        near: [{ kind: 'building', id: 'work_well_00' }],
      },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected an affinity placement');
    expect(Math.abs(spot.x - WELL_AT.x) + Math.abs(spot.y - WELL_AT.y)).toBeLessThanOrEqual(2);
  });

  it('stands a home on the far side of the base from the field farm, off its fields', () => {
    const FIELD_RADIUS = 4;
    const base = aiContent();
    const content = parseContentSet({
      ...base,
      goods: base.goods.map((g) =>
        g.id === 'food_simple'
          ? { ...g, farming: { stages: 5, yieldPerField: 1, fieldRadius: FIELD_RADIUS, maxFields: 25 } }
          : g,
      ),
      buildings: base.buildings.map((b) => (b.id === 'work_farm_00' ? { ...b, produces: [FOOD_GOOD] } : b)),
    });
    const homeBeside = (farmX: number, entry: BuildOrderEntry) => {
      const sim = aiSim(1, content);
      placeHq(sim);
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: FARM_TYPE,
        x: farmX,
        y: HQ_Y,
        tribe: VIKING,
        owner: SEAT,
      });
      sim.step();
      const home = [
        ...buildOrderModule(oneLine([entry])).run(sim.world, { ...ctxOf(sim), content }, SEAT),
      ][0];
      if (home?.kind !== 'placeBuilding') throw new Error('expected the home placement');
      expect(Math.abs(home.x - farmX) + Math.abs(home.y - HQ_Y)).toBeGreaterThan(
        FIELD_RADIUS + HOME_FARM_MARGIN_NODES,
      );
      return home.x;
    };
    // A school-like `amongHomes` workshop searches as the homes do.
    for (const entry of [
      { kind: 'place', building: 'home_level_00', count: 1 },
      { kind: 'place', building: 'work_mill_00', count: 1, amongHomes: true },
    ] as const) {
      expect(homeBeside(HQ_X + 10, entry)).toBeLessThan(HQ_X);
      expect(homeBeside(HQ_X - 10, entry)).toBeGreaterThan(HQ_X);
    }
  });

  it("moves a deposit-pulled workshop off a field farm's chain ground when a spot a few rings off is free", () => {
    const base = aiContent();
    const content = parseContentSet({
      ...base,
      goods: base.goods.map((g) =>
        g.id === 'food_simple'
          ? { ...g, farming: { stages: 5, yieldPerField: 1, fieldRadius: 4, maxFields: 25 } }
          : g,
      ),
      buildings: base.buildings.map((b) => (b.id === 'work_farm_00' ? { ...b, produces: [FOOD_GOOD] } : b)),
    });
    // The farm stands west of the stone, the deposit just inside its chain's ground.
    const FARM_AT = { x: RESOURCE_SPOTS.stone.x - CHAIN_ROOM_RADIUS_NODES + 2, y: RESOURCE_SPOTS.stone.y };
    const depositSpot = (withFarm: boolean) => {
      const sim = aiSim(1, content);
      placeHq(sim);
      placeResources(sim, [RESOURCE_SPOTS.stone]);
      if (withFarm)
        sim.enqueueSetup({
          kind: 'placeBuilding',
          buildingType: FARM_TYPE,
          x: FARM_AT.x,
          y: FARM_AT.y,
          tribe: VIKING,
          owner: SEAT,
        });
      sim.step();
      const spot = [
        ...buildOrderModule(
          oneLine([
            {
              kind: 'place',
              building: 'work_bakery_00',
              count: 1,
              near: [{ kind: 'resource', good: 'stone' }],
            },
          ]),
        ).run(sim.world, { ...ctxOf(sim), content }, SEAT),
      ][0];
      if (spot?.kind !== 'placeBuilding') throw new Error('expected the deposit placement');
      return spot;
    };
    const toFarm = (spot: { x: number; y: number }) =>
      Math.abs(spot.x - FARM_AT.x) + Math.abs(spot.y - FARM_AT.y);
    expect(toFarm(depositSpot(false))).toBeLessThanOrEqual(CHAIN_ROOM_RADIUS_NODES);
    const moved = depositSpot(true);
    expect(toFarm(moved)).toBeGreaterThan(CHAIN_ROOM_RADIUS_NODES);
    expect(
      Math.abs(moved.x - RESOURCE_SPOTS.stone.x) + Math.abs(moved.y - RESOURCE_SPOTS.stone.y),
    ).toBeLessThanOrEqual(FARM_ROOM_RESOURCE_PENALTY_RINGS);
  });

  it('stands a room placement where the free ground around it holds the buildings it names', () => {
    // Water west of the HQ, open ground east of it; the mill the farm names wants a large reserved zone.
    const WATER = 1;
    const SHORE_X = HQ_X - 6;
    const MILL_ROOM = 22;
    const typeIds = new Array<number>(64 * 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) typeIds[y * 64 + x] = x < SHORE_X ? WATER : 0;
    const base = aiContent();
    const content = parseContentSet({
      ...base,
      buildings: base.buildings.map((b) =>
        b.id === 'work_mill_00'
          ? {
              ...b,
              footprint: {
                reserved: Array.from({ length: MILL_ROOM * MILL_ROOM }, (_, i) => ({
                  dx: i % MILL_ROOM,
                  dy: Math.floor(i / MILL_ROOM),
                })),
              },
            }
          : b,
      ),
    });
    const farmX = (entry: BuildOrderEntry): number => {
      const sim = new Simulation({
        seed: 1,
        content,
        map: { resolution: 'half-cell', width: 64, height: 32, typeIds },
      });
      placeHq(sim);
      sim.step();
      const farm = [
        ...buildOrderModule(oneLine([entry])).run(sim.world, { ...ctxOf(sim), content }, SEAT),
      ][0];
      if (farm?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
      return farm.x;
    };
    // The ring walk reaches the shore side first, so a farm with no room named stands west of the HQ.
    expect(farmX(ESSENTIAL_FARM)).toBeLessThan(HQ_X);
    expect(farmX({ ...ESSENTIAL_FARM, room: ['work_mill_00'] })).toBeGreaterThan(HQ_X);
  });

  it('pulls a mapCentre-affinity placement toward the middle of the map', () => {
    const HQ_FAR = { x: 20, y: 20 };
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(sim, HQ_FAR.x, HQ_FAR.y);
    sim.step();
    const spot = firstCommandOf(sim, [
      { kind: 'place', building: 'work_well_00', count: 1, near: [{ kind: 'mapCentre' }] },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected a centre-pulled placement');
    const toHq = Math.abs(spot.x - HQ_FAR.x) + Math.abs(spot.y - HQ_FAR.y);
    expect(toHq).toBeLessThanOrEqual(BUILD_SEARCH_MAX_RADIUS_NODES); // never outside the band
    expect(toHq).toBeGreaterThan(BUILD_SEARCH_MAX_RADIUS_NODES / 2); // pulled hard toward the middle
    // The pull points at the map centre (128,128), east and south of this HQ.
    expect(spot.x).toBeGreaterThan(HQ_FAR.x);
    expect(spot.y).toBeGreaterThan(HQ_FAR.y);
  });

  it('keeps a placement behind the tower line toward a forecast attack', () => {
    // The map centre lies east of the base, where the raiders come from.
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(160, 32) });
    sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
    placeHq(sim);
    // A start home inside the line, so the seat's build reach stretches past it.
    const HOME_X = HQ_X + FRONT_LINE_DEPTH_NODES / 2;
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HOME_X,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    makeAiSeat(sim, SEAT);
    sim.step();
    const anchor = seatTerritoryOf(mapBriefOf(sim.world), SEAT)?.anchor;
    if (anchor === undefined) throw new Error('setup: the seat has no start in the map brief');
    const RAIDER = 6;
    const raid = {
      successfullIf: SUCCESSFUL_IF.all,
      active: true,
      visible: false,
      goals: [],
      results: [
        {
          opcode: 'SetHumanX' as const,
          player: RAIDER,
          tribe: VIKING,
          job: SPEARMAN,
          point: { hx: 159, hy: HQ_Y },
          humanId: 1,
          behaviour: 0,
          amount: 6,
        },
        { opcode: 'SendHuman' as const, humanId: 1, point: anchor },
      ],
    };
    const centred = buildOrderModule(
      oneLine([{ kind: 'place', building: 'work_well_00', count: 1, near: [{ kind: 'mapCentre' }] }]),
    );
    const spotIn = (ctx: ReturnType<typeof ctxOf>) => {
      const spot = [...centred.run(sim.world, ctx, SEAT)][0];
      if (spot?.kind !== 'placeBuilding') throw new Error('expected a centre-pulled placement');
      return spot;
    };
    expect(spotIn(ctxOf(sim)).x).toBeGreaterThan(HQ_X + FRONT_LINE_DEPTH_NODES);
    const raided = spotIn({ ...ctxOf(sim), missions: { missions: [raid] } });
    expect(raided.x).toBeGreaterThan(HQ_X);
    expect(raided.x).toBeLessThanOrEqual(HQ_X + FRONT_LINE_DEPTH_NODES);
    // A building that went up past the line later does not walk the scripted line out: its depth reads
    // the start buildings alone.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: STOCK_TYPE,
      x: HQ_X + 3 * FRONT_LINE_DEPTH_NODES,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect(spotIn({ ...ctxOf(sim), missions: { missions: [raid] } }).x).toBeLessThanOrEqual(
      HQ_X + FRONT_LINE_DEPTH_NODES,
    );
  });

  it('pulls a front-affinity placement toward the nearest enemy headquarters, or the map centre without one', () => {
    const HQ_AT = { x: 40, y: 40 };
    const ENEMY = SEAT + 1;
    const ENEMY_HQ = { x: 40, y: 200 }; // due south; the map centre (128,128) lies south-east
    const ENEMY_TOWER = { x: 70, y: 40 }; // nearer, due east - but not a headquarters
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(sim, HQ_AT.x, HQ_AT.y);
    sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: ENEMY, tribes: [VIKING] });
    for (const [buildingType, at] of [
      [HQ_TYPE, ENEMY_HQ],
      [TOWER_TYPE, ENEMY_TOWER],
    ] as const) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType,
        x: at.x,
        y: at.y,
        tribe: VIKING,
        owner: ENEMY,
      });
    }
    sim.step();
    const front: BuildOrderEntry[] = [
      { kind: 'place', building: 'work_well_00', count: 1, near: [{ kind: 'front' }] },
    ];
    const spot = firstCommandOf(sim, front);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected a front-pulled placement');
    // South toward the enemy headquarters, past the nearer tower's eastward pull, but only a step past
    // the settlement's edge - here the headquarters alone - never a whole reach out.
    expect(spot.y - HQ_AT.y).toBeGreaterThan(0);
    expect(spot.y - HQ_AT.y).toBeLessThanOrEqual(FRONT_EDGE_STEP_NODES + HQ_PULL_DIVISOR_NODES);
    expect(Math.abs(spot.x - HQ_AT.x)).toBeLessThan(BUILD_SEARCH_MAX_RADIUS_NODES / 4);

    // A home standing out toward the enemy is the settlement's edge: the placement steps past it, not past
    // the headquarters, and never a reach beyond it.
    const OUTPOST = { x: HQ_AT.x, y: HQ_AT.y + 40 };
    const grown = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(grown, HQ_AT.x, HQ_AT.y);
    grown.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: ENEMY, tribes: [VIKING] });
    for (const [buildingType, at, owner] of [
      [HQ_TYPE, ENEMY_HQ, ENEMY],
      [HOME_TYPE, OUTPOST, SEAT],
    ] as const) {
      grown.enqueueSetup({
        kind: 'placeBuilding',
        buildingType,
        x: at.x,
        y: at.y,
        tribe: VIKING,
        owner,
        force: true,
      });
    }
    grown.step();
    const edge = firstCommandOf(grown, front);
    if (edge?.kind !== 'placeBuilding') throw new Error('expected an edge placement');
    expect(edge.y - OUTPOST.y).toBeGreaterThan(0);
    expect(edge.y - OUTPOST.y).toBeLessThanOrEqual(FRONT_EDGE_STEP_NODES + HQ_PULL_DIVISOR_NODES);

    // No enemy building anywhere: the pull falls back to the middle of the map, east and south of here.
    const alone = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(alone, HQ_AT.x, HQ_AT.y);
    alone.step();
    const fallback = firstCommandOf(alone, front);
    if (fallback?.kind !== 'placeBuilding') throw new Error('expected a centre-pulled placement');
    expect(fallback.x).toBeGreaterThan(HQ_AT.x);
    expect(fallback.y).toBeGreaterThan(HQ_AT.y);
  });

  it("breaks a tie between two enemy seats' equally near buildings by the lowest id, whichever seat it belongs to", () => {
    const HQ_AT = { x: 128, y: 40 };
    const WEST = { x: HQ_AT.x - 60, y: HQ_AT.y };
    const EAST = { x: HQ_AT.x + 60, y: HQ_AT.y };
    const front: BuildOrderEntry[] = [
      { kind: 'place', building: 'work_well_00', count: 1, near: [{ kind: 'front' }] },
    ];
    // Two enemy towers, one per seat, the same distance from the base: the one placed first, with the
    // lower id, pulls the front whichever seat's roster is walked first.
    const pulledBy = (first: { x: number; y: number }, second: { x: number; y: number }): number => {
      const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
      placeHq(sim, HQ_AT.x, HQ_AT.y);
      for (const [owner, at] of [
        [SEAT + 2, first],
        [SEAT + 1, second],
      ] as const) {
        sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: owner, tribes: [VIKING] });
        sim.enqueueSetup({
          kind: 'placeBuilding',
          buildingType: TOWER_TYPE,
          x: at.x,
          y: at.y,
          tribe: VIKING,
          owner,
        });
      }
      sim.step();
      const spot = firstCommandOf(sim, front);
      if (spot?.kind !== 'placeBuilding') throw new Error('expected a front-pulled placement');
      return spot.x - HQ_AT.x;
    };
    expect(pulledBy(WEST, EAST)).toBeLessThan(0);
    expect(pulledBy(EAST, WEST)).toBeGreaterThan(0);
  });

  it('keeps a front-affinity placement by the base while enemy seats surround it', () => {
    const HQ_AT = { x: 128, y: 128 };
    const ENEMY_HQS = [
      { x: HQ_AT.x - 80, y: HQ_AT.y },
      { x: HQ_AT.x, y: HQ_AT.y - 80 },
      { x: HQ_AT.x + 80, y: HQ_AT.y },
    ];
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(sim, HQ_AT.x, HQ_AT.y);
    for (const [i, at] of ENEMY_HQS.entries()) {
      const owner = SEAT + 1 + i;
      sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: owner, tribes: [VIKING] });
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HQ_TYPE, ...at, tribe: VIKING, owner });
    }
    // The computer seat's first decision scans the map brief, every seat's start in it.
    makeAiSeat(sim, SEAT, { houseBuild: false });
    sim.step();
    const spot = firstCommandOf(sim, [
      { kind: 'place', building: 'work_well_00', count: 1, near: [{ kind: 'front' }] },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected a placement');
    // The base's own search ring, not a front edge pushed toward the nearest of them.
    expect(Math.abs(spot.x - HQ_AT.x) + Math.abs(spot.y - HQ_AT.y)).toBeLessThan(FRONT_EDGE_STEP_NODES);
  });

  it('searches from the base when the affinity-pulled fan finds no room, so a wide settlement never stalls on its far side', () => {
    // Grass west of the water line, water east of it; a home stands far out on the water side (forced) and
    // the enemy beyond it, so the front-pulled centre lands east of the home and its fan never reaches the
    // grass around the base. Two fans would cover the whole reach; one cannot.
    const WATER_FROM_X = 60;
    const WIDTH = 256;
    const HEIGHT = 64;
    const GRASS = 0;
    const WATER = 1;
    const HQ = { x: 20, y: 32 };
    const FAR_HOME = { x: 100, y: 32 };
    const RIVAL_HQ = { x: 240, y: 32 };
    const RIVAL = 3;
    expect(FAR_HOME.x - BUILD_SEARCH_MAX_RADIUS_NODES).toBeGreaterThan(WATER_FROM_X);
    const typeIds = new Array<number>(WIDTH * HEIGHT).fill(GRASS);
    for (let y = 0; y < HEIGHT; y++)
      for (let x = WATER_FROM_X; x < WIDTH; x++) typeIds[y * WIDTH + x] = WATER;
    const map: TerrainMap = { resolution: 'half-cell', width: WIDTH, height: HEIGHT, typeIds };
    const sim = new Simulation({ seed: 1, content: aiContent(), map });
    placeHq(sim, HQ.x, HQ.y);
    sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: RIVAL, tribes: [VIKING] });
    for (const [buildingType, at, owner] of [
      [HOME_TYPE, FAR_HOME, SEAT],
      [HQ_TYPE, RIVAL_HQ, RIVAL],
    ] as const) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType,
        x: at.x,
        y: at.y,
        tribe: VIKING,
        owner,
        force: true,
      });
    }
    sim.step();
    const spot = firstCommandOf(sim, [
      { kind: 'place', building: 'work_well_00', count: 1, near: [{ kind: 'front' }] },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected a placement from the base');
    expect(spot.x).toBeLessThan(WATER_FROM_X);
    expect(Math.abs(spot.x - HQ.x) + Math.abs(spot.y - HQ.y)).toBeLessThanOrEqual(
      BUILD_SEARCH_MAX_RADIUS_NODES,
    );
  });

  it('breaks a near tie between affinity spots toward the base, never trading more than the divisor allows', () => {
    // A well west of the HQ: the ring walk meets the west side first, the pull turns the pick east.
    const WELL_AT = { x: 14, y: 16 };
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: WELL_TYPE,
      ...WELL_AT,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const spot = firstCommandOf(sim, [
      {
        kind: 'place',
        building: 'work_bakery_00',
        count: 1,
        near: [{ kind: 'building', id: 'work_well_00' }],
      },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected an affinity placement');
    expect(spot.x).toBeGreaterThan(WELL_AT.x); // the HQ side
    expect(Math.abs(spot.x - WELL_AT.x) + Math.abs(spot.y - WELL_AT.y)).toBeLessThanOrEqual(2); // still beside

    // The walk itself, around (0, 0) with the base 20 nodes east. On one ring the node nearer the base wins.
    const BASE = { hx: 20, hy: 0 };
    const pull = (x: number, y: number) =>
      Math.floor((Math.abs(x - BASE.hx) + Math.abs(y - BASE.hy)) / HQ_PULL_DIVISOR_NODES);
    const only =
      (...nodes: readonly [number, number][]) =>
      (x: number, y: number) =>
        nodes.some(([nx, ny]) => nx === x && ny === y);
    expect(bestRingNode(0, 0, 10, pull, only([-1, 0], [0, 1], [1, 0]))).toEqual({ hx: 1, hy: 0 });
    // A further ring wins only while the pull gives back more than its rings cost: west ring 6 costs
    // 6 + floor(26 / 4) = 12, east ring 9 costs 9 + floor(11 / 4) = 11, and east ring 10 ties at
    // 10 + floor(10 / 4) = 12, where the nearer ring keeps the spot.
    expect(bestRingNode(0, 0, 10, pull, only([-6, 0], [9, 0]))).toEqual({ hx: 9, hy: 0 });
    expect(bestRingNode(0, 0, 10, pull, only([-6, 0], [10, 0]))).toEqual({ hx: -6, hy: 0 });
    expect(bestRingNode(0, 0, 10, pull, () => false)).toBeNull();
  });

  it("clamps a far-off affinity centre back into the band of the seat's buildings", () => {
    const HQ_FAR = { x: 20, y: 20 };
    const STONE_FAR = { x: 200, y: 200 };
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(sim, HQ_FAR.x, HQ_FAR.y);
    placeResources(sim, [{ good: STONE, harvest: STONE_HARVEST, x: STONE_FAR.x, y: STONE_FAR.y }]);
    sim.step();
    const spot = firstCommandOf(sim, [
      { kind: 'place', building: 'work_bakery_00', count: 1, near: [{ kind: 'resource', good: 'stone' }] },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected a clamped placement');
    const toHq = Math.abs(spot.x - HQ_FAR.x) + Math.abs(spot.y - HQ_FAR.y);
    expect(toHq).toBeLessThanOrEqual(BUILD_SEARCH_MAX_RADIUS_NODES); // never outside the band
    expect(toHq).toBeGreaterThan(BUILD_SEARCH_MAX_RADIUS_NODES / 2); // yet pulled hard toward the deposit
  });

  it('takes a second resource affinity beside the first deposit, not on the far side of the base', () => {
    const sim = aiSim();
    placeHq(sim);
    // The east wood is the nearest to the HQ, the west wood the nearest to the iron.
    const IRON_WOOD = { x: RESOURCE_SPOTS.iron.x + 2, y: RESOURCE_SPOTS.iron.y + 2 };
    placeResources(sim, [
      RESOURCE_SPOTS.iron,
      RESOURCE_SPOTS.wood,
      { ...RESOURCE_SPOTS.wood, x: IRON_WOOD.x, y: IRON_WOOD.y },
    ]);
    sim.step();
    const spot = firstCommandOf(sim, [
      {
        kind: 'place',
        building: 'work_bakery_00',
        count: 1,
        near: [
          { kind: 'resource', good: 'iron' },
          { kind: 'resource', good: 'wood' },
        ],
      },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected an affinity placement');
    const toIron = Math.abs(spot.x - RESOURCE_SPOTS.iron.x) + Math.abs(spot.y - RESOURCE_SPOTS.iron.y);
    expect(toIron).toBeLessThan(Math.abs(spot.x - HQ_X) + Math.abs(spot.y - HQ_Y));
  });

  it('pulls a gathered-good affinity toward the deposit its gatherers work, not a nearer idle one', () => {
    const sim = aiSim();
    placeHq(sim);
    const IDLE_STONE = { ...RESOURCE_SPOTS.stone, x: HQ_X - 10, y: HQ_Y };
    const WORKED_FLAG = { x: RESOURCE_SPOTS.stone.x, y: RESOURCE_SPOTS.stone.y + 5 };
    placeResources(sim, [IDLE_STONE, RESOURCE_SPOTS.stone]);
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: COLLECTOR,
      x: HQ_X,
      y: HQ_Y + 4,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const gatherer = [...sim.world.query(Settler)].find(
      (e) => sim.world.get(e, Settler).jobType === COLLECTOR,
    );
    if (gatherer === undefined) throw new Error('setup: the gatherer');
    const order: BuildOrderEntry[] = [
      { kind: 'place', building: 'work_bakery_00', count: 1, near: [{ kind: 'resource', good: 'stone' }] },
    ];
    const toWorked = (spot: { x: number; y: number }) =>
      Math.abs(spot.x - RESOURCE_SPOTS.stone.x) + Math.abs(spot.y - RESOURCE_SPOTS.stone.y);
    const toIdle = (spot: { x: number; y: number }) =>
      Math.abs(spot.x - IDLE_STONE.x) + Math.abs(spot.y - IDLE_STONE.y);
    const unworked = firstCommandOf(sim, order);
    if (unworked?.kind !== 'placeBuilding') throw new Error('expected an affinity placement');
    expect(toIdle(unworked)).toBeLessThan(toWorked(unworked)); // no one digs: the nearest deposit
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: gatherer, ...WORKED_FLAG });
    sim.enqueueSetup({ kind: 'setGatherGood', entity: gatherer, goodType: STONE });
    sim.step();
    const worked = firstCommandOf(sim, order);
    if (worked?.kind !== 'placeBuilding') throw new Error('expected an affinity placement');
    expect(toWorked(worked)).toBeLessThan(toIdle(worked));
  });

  it('keeps a placement off the far bank of a river the builders only cross at a ford far downstream', () => {
    // Nodes 64 x 128: the river's water stands at node columns 38-39 down to the bottom cell row.
    const RIVER_CELL_COLUMN = 19;
    const RIVER_WEST_NODE = 2 * RIVER_CELL_COLUMN;
    const sim = new Simulation({
      seed: 1,
      content: aiContent(),
      map: waterColumnMap(32, 64, RIVER_CELL_COLUMN, 1),
    });
    placeHq(sim);
    const FAR_BANK_STONE = { ...RESOURCE_SPOTS.stone, x: RIVER_WEST_NODE + 8, y: HQ_Y };
    placeResources(sim, [FAR_BANK_STONE]);
    sim.step();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: a map');
    // One land: the ford joins the banks, so only the walk tells them apart.
    expect(terrain.componentOf(terrain.nodeAt(FAR_BANK_STONE.x - 3, FAR_BANK_STONE.y))).toBe(
      terrain.componentOf(terrain.nodeAt(HQ_X, HQ_Y + 3)),
    );
    const spot = firstCommandOf(sim, [
      { kind: 'place', building: 'work_bakery_00', count: 1, near: [{ kind: 'resource', good: 'stone' }] },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected a placement on the near bank');
    expect(spot.x).toBeLessThan(RIVER_WEST_NODE);
  });

  it('keeps every building whose band meets the search disc when the reach is cut down to it', () => {
    const R = BUILD_SEARCH_MAX_RADIUS_NODES;
    const HQ_AT = { hx: 20, hy: 20 };
    const SPAN = 2 * R;
    // A well just inside span + R of the HQ: its band still covers nodes of the HQ-centred search disc.
    const WELL_AT = { x: HQ_AT.hx + SPAN + R - 4, y: HQ_AT.hy };
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 64) });
    placeHq(sim, HQ_AT.hx, HQ_AT.hy);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: WELL_TYPE,
      x: WELL_AT.x,
      y: WELL_AT.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const reach = buildReach(sim.world, ownedBuildings(sim.world, SEAT), HQ_AT).around(HQ_AT, SPAN);
    expect(reach.contains(HQ_AT.hx + SPAN, HQ_AT.hy)).toBe(true); // the well's band, the disc's edge
    expect(reach.contains(HQ_AT.hx + R + 1, HQ_AT.hy)).toBe(false); // between the two bands
  });

  it("reaches past the HQ band from an outlying building, never past that building's own band", () => {
    const HQ_FAR = { x: 20, y: 20 };
    const OUTPOST = { x: 60, y: 20 };
    const STONE_FAR = { x: 200, y: 200 };
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(sim, HQ_FAR.x, HQ_FAR.y);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: WELL_TYPE,
      x: OUTPOST.x,
      y: OUTPOST.y,
      tribe: VIKING,
      owner: SEAT,
    });
    placeResources(sim, [{ good: STONE, harvest: STONE_HARVEST, x: STONE_FAR.x, y: STONE_FAR.y }]);
    sim.step();
    const spot = firstCommandOf(sim, [
      { kind: 'place', building: 'work_bakery_00', count: 1, near: [{ kind: 'resource', good: 'stone' }] },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected a placement past the HQ band');
    expect(Math.abs(spot.x - HQ_FAR.x) + Math.abs(spot.y - HQ_FAR.y)).toBeGreaterThan(
      BUILD_SEARCH_MAX_RADIUS_NODES,
    );
    const toOutpost = Math.abs(spot.x - OUTPOST.x) + Math.abs(spot.y - OUTPOST.y);
    expect(toOutpost).toBeLessThanOrEqual(BUILD_SEARCH_MAX_RADIUS_NODES);
    expect(toOutpost).toBeGreaterThan(BUILD_SEARCH_MAX_RADIUS_NODES / 2); // pulled out toward the deposit
  });

  it('keeps the acceptor off an iron deposit the engine would not refuse, not off clay or a mushroom', () => {
    // A walk-free deposit as the real records stamp clay: walkable, no walk or build block, dug from its own
    // node. Iron is scarce and stays uncovered; clay builds over (owner ruling: build wherever there is room).
    const PIT_HOUSE = 34;
    const pitFootprint = {
      blocked: [{ dx: 0, dy: 0 }],
      familyBody: [{ dx: 0, dy: 0 }],
      reserved: [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => ({ dx, dy }))),
    };
    const MUSHROOM = 50;
    const MUSHROOM_HARVEST = 50;
    const base = aiContent();
    const content = parseContentSet({
      ...base,
      goods: [
        ...base.goods,
        { typeId: MUSHROOM, id: 'test_mushroom', weight: 1, atomics: { harvest: MUSHROOM_HARVEST } },
      ],
      buildings: [
        ...base.buildings,
        { typeId: PIT_HOUSE, id: 'test_pit_house', kind: 'home', homeSize: 1, footprint: pitFootprint },
      ],
    });
    const sim = aiSim(1, content);
    placeHq(sim);
    sim.step();
    const iron = sim.world.create();
    const { x: ironX, y: ironY, harvest } = RESOURCE_SPOTS.iron;
    sim.world.add(iron, Position, positionOfNode(ironX, ironY));
    sim.world.add(iron, Resource, { goodType: IRON, remaining: 5, harvestAtomic: harvest });
    stampResourceFootprintData(sim.world, iron, { walk: [], build: [], work: [{ dx: 0, dy: 0 }] });
    const clay = sim.world.create();
    const { x: clayX, y: clayY, harvest: clayHarvest } = RESOURCE_SPOTS.mud;
    sim.world.add(clay, Position, positionOfNode(clayX, clayY));
    sim.world.add(clay, Resource, { goodType: MUD, remaining: 5, harvestAtomic: clayHarvest });
    stampResourceFootprintData(sim.world, clay, { walk: [], build: [], work: [{ dx: 0, dy: 0 }] });
    // A meadow mushroom, walk-free like the clay: the seat may build over it.
    const MUSHROOM_SPOT = { x: 12, y: 14 };
    const mushroom = sim.world.create();
    sim.world.add(mushroom, Position, positionOfNode(MUSHROOM_SPOT.x, MUSHROOM_SPOT.y));
    sim.world.add(mushroom, Resource, { goodType: MUSHROOM, remaining: 1, harvestAtomic: MUSHROOM_HARVEST });
    stampResourceFootprintData(sim.world, mushroom, { walk: [], build: [], work: [{ dx: 0, dy: 0 }] });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    expect(
      canPlaceBuilding(sim.world, { ...ctxOf(sim), content }, terrain, PIT_HOUSE, VIKING, ironX, ironY),
    ).toBe(true);

    const [spot] = buildOrderModule(
      oneLine([
        { kind: 'place', building: 'test_pit_house', count: 1, near: [{ kind: 'resource', good: 'iron' }] },
      ]),
    ).run(sim.world, { ...ctxOf(sim), content }, SEAT);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected a placement beside the iron');
    // No gatherer works the iron, so the seat may cover it (`build-order/deposit-keep.ts`); the acceptor's
    // own rule below keeps every scarce deposit.
    expect(Math.abs(spot.x - ironX) + Math.abs(spot.y - ironY)).toBeLessThanOrEqual(
      DEPOSIT_NEIGHBOURHOOD_NODES,
    );

    const accept = spotAcceptor(
      sim.world,
      { ...ctxOf(sim), content },
      terrain,
      SEAT,
      PIT_HOUSE,
      VIKING,
    ).around(enemyFire([]), { hx: ironX, hy: ironY }, 0);
    expect(accept(ironX, ironY)).toBe(false);
    expect(accept(clayX, clayY)).toBe(true);
    expect(accept(MUSHROOM_SPOT.x, MUSHROOM_SPOT.y)).toBe(true);
  });
});
