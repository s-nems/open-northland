import { footprintCellDx, parseContentSet } from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import { Position, Resource } from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import { positionOfNode, Simulation, type TerrainMap } from '../../../src/index.js';
import {
  buildingSpotAccept,
  buildReach,
  FRONT_EDGE_STEP_NODES,
  HQ_PULL_DIVISOR_NODES,
} from '../../../src/systems/ai-player/build-order/placement.js';
import {
  AI_DECISION_INTERVAL_TICKS,
  BUILD_SEARCH_MAX_RADIUS_NODES,
  type BuildOrderEntry,
  buildOrderModule,
  DEFAULT_BUILD_ORDER,
  enemyFire,
  STALLED_PLACEMENT_RETRY_DECISIONS,
} from '../../../src/systems/ai-player/index.js';
import { bestRingNode } from '../../../src/systems/ai-player/node-geometry.js';
import { ownedBuildings } from '../../../src/systems/ai-player/seat-roster.js';
import { canPlaceBuilding, stampResourceFootprintData } from '../../../src/systems/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  aiSim,
  ctxOf,
  entityOfBuilding,
  HOME_TYPE,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  MUD,
  makeAiSeat,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SAND,
  SEAT,
  STONE,
  STONE_HARVEST,
  TOWER_TYPE,
  VIKING,
  WELL_TYPE,
} from './support.js';

/** How near a deposit an affinity placement that keeps off it still lands (a reserved ring plus one). */
const CLAY_NEIGHBOURHOOD_NODES = 4;

describe('build-order placement - affinity and ground rules', () => {
  /** A half-cell node map that is grass except where `sandy(x, y)` says otherwise. */
  function mapWithSand(width: number, height: number, sandy: (x: number, y: number) => boolean): TerrainMap {
    const typeIds = new Array<number>(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) typeIds[y * width + x] = sandy(x, y) ? SAND : 0;
    }
    return { resolution: 'half-cell', width, height, typeIds };
  }

  function firstCommandOf(sim: Simulation, order: readonly BuildOrderEntry[]): Command | undefined {
    return [...buildOrderModule(order).run(sim.world, ctxOf(sim), SEAT)][0];
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
    expect(firstCommandOf(barren, DEFAULT_BUILD_ORDER)).toBeUndefined();
    const home = firstCommandOf(barren, [{ kind: 'place', building: 'home_level_00', count: 1 }]);
    expect(home?.kind).toBe('placeBuilding');
  });

  it('re-searches a stalled placement only every retry interval and places on the first retry after room frees', () => {
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
    const groundTests = vi.spyOn(terrain, 'isPlantable');
    const farm = buildOrderModule([
      { kind: 'place', building: 'work_farm_00', count: 1, ground: 'plantable' },
    ]);

    const searchedAt: number[] = [];
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
      const before = groundTests.mock.calls.length;
      const commands = farm.run(sim.world, ctxOf(sim, SEAT + decision * AI_DECISION_INTERVAL_TICKS), SEAT);
      if (groundTests.mock.calls.length > before) searchedAt.push(decision);
      if (commands.length > 0) placedAt = decision;
    }
    expect(searchedAt).toEqual([0, STALLED_PLACEMENT_RETRY_DECISIONS, 2 * STALLED_PLACEMENT_RETRY_DECISIONS]);
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

  it('keeps the reserved zone off a clay deposit, which carries no block the engine would refuse, not off a mushroom', () => {
    // A clay deposit as the real records stamp it: walkable, no walk or build block, dug from its own node.
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
    const clay = sim.world.create();
    const { x: clayX, y: clayY, harvest } = RESOURCE_SPOTS.mud;
    sim.world.add(clay, Position, positionOfNode(clayX, clayY));
    sim.world.add(clay, Resource, { goodType: MUD, remaining: 5, harvestAtomic: harvest });
    stampResourceFootprintData(sim.world, clay, { walk: [], build: [], work: [{ dx: 0, dy: 0 }] });
    // A meadow mushroom, walk-free like the clay: the seat may build over it.
    const MUSHROOM_SPOT = { x: 12, y: 14 };
    const mushroom = sim.world.create();
    sim.world.add(mushroom, Position, positionOfNode(MUSHROOM_SPOT.x, MUSHROOM_SPOT.y));
    sim.world.add(mushroom, Resource, { goodType: MUSHROOM, remaining: 1, harvestAtomic: MUSHROOM_HARVEST });
    stampResourceFootprintData(sim.world, mushroom, { walk: [], build: [], work: [{ dx: 0, dy: 0 }] });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    expect(canPlaceBuilding(sim.world, { ...ctxOf(sim), content }, terrain, PIT_HOUSE, clayX, clayY)).toBe(
      true,
    );

    const [spot] = buildOrderModule([
      { kind: 'place', building: 'test_pit_house', count: 1, near: [{ kind: 'resource', good: 'mud' }] },
    ]).run(sim.world, { ...ctxOf(sim), content }, SEAT);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected a placement beside the clay');
    const covered = pitFootprint.reserved.some(
      (c) => spot.x + footprintCellDx(spot.y, c) === clayX && spot.y + c.dy === clayY,
    );
    expect(covered).toBe(false);
    expect(Math.abs(spot.x - clayX) + Math.abs(spot.y - clayY)).toBeLessThanOrEqual(CLAY_NEIGHBOURHOOD_NODES);

    const accept = buildingSpotAccept(
      sim.world,
      { ...ctxOf(sim), content },
      terrain,
      SEAT,
      PIT_HOUSE,
      enemyFire([]),
      { hx: clayX, hy: clayY },
      0,
    );
    expect(accept(clayX, clayY)).toBe(false);
    expect(accept(MUSHROOM_SPOT.x, MUSHROOM_SPOT.y)).toBe(true);
  });
});
