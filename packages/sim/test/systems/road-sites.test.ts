import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Carrying,
  CurrentAtomic,
  Owner,
  Palisade,
  Position,
  RoadSite,
  SiteAssignment,
  Stockpile,
  SupplyRun,
  setStockAmount,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  fx,
  hexNeighboursOf,
  type NodeArea,
  nodeGridAccepts,
  nodeOfPosition,
  ONE,
  playerCommand,
  positionOfNode,
  restoreSimulation,
  type ScriptLandscapeType,
  Simulation,
} from '../../src/index.js';
import type { TerrainMap } from '../../src/nav/terrain/index.js';
import { constructionSystem } from '../../src/systems/economy/construction.js';
import { claimSite } from '../../src/systems/economy/site-claim.js';
import { palisadePlacementProbe as palisadeProbe } from '../../src/systems/palisades/index.js';
import { isRoad } from '../../src/systems/roads/index.js';
import { pickRoadSite } from '../../src/systems/roads/site-pick.js';
import { roadSitePlacementProbe } from '../../src/systems/roads/sites.js';
import { createVehicle } from '../../src/systems/vehicles/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const VIKING = 1;
const HUMAN = 0;
const RIVAL = 1;
const STONE = 1;
const WOOD = 2;
const IDLE = 0;
const BUILDER = 7;
const BUILD_HOUSE_ATOMIC = 39;
const BUILD_ROAD_ATOMIC = 41;
const BUILD_WALL_ATOMIC = 42;
const BUILD_ROAD_CLIP = 'viking_builder_build_road';
/** The mod's build-road clip length. */
const BUILD_ROAD_CLIP_TICKS = 15;
const STORE = 1;
const HOUSE = 2;
const GRASS = 0;
const ROW = 6;
const STORE_HX = 4;
const MAP_WIDTH = 48;
const MAP_HEIGHT = 16;
/** Long enough for a builder to fetch a stone across the test map and swing once. */
const BUILD_TICKS = 3000;
const FAR_HX = 40;
const HUT = 3;
/** A two-node body over which a road site is cancelled, with a one-node margin a road may keep. */
const HUT_FOOTPRINT = {
  blocked: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  familyBody: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  reserved: [-1, 0, 1, 2].flatMap((dy) => [-1, 0, 1, 2].map((dx) => ({ dx, dy }))),
  door: { dx: -1, dy: 0 },
};
const HANDCART = 1;
const HANDCART_JOB = 50;
const HANDCART_SLOTS = 15;
const HANDCART_HITPOINTS = 100;
/** A disc one node out from its anchor, so the cart covers its neighbours too. */
const HANDCART_LOGIC_SIZE = 1;

const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [],
  groups: [],
  wall: { maxHitpoints: 100, repairPerStrike: 3, construction: [{ goodType: WOOD, amount: 1 }] },
};

function roadContent() {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
      { typeId: WOOD, id: 'wood' },
    ],
    jobs: [
      { typeId: IDLE, id: 'idle' },
      {
        typeId: BUILDER,
        id: 'builder',
        allowedAtomics: [BUILD_HOUSE_ATOMIC, BUILD_ROAD_ATOMIC, BUILD_WALL_ATOMIC],
      },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [{ jobType: BUILDER, atomicId: BUILD_ROAD_ATOMIC, animation: BUILD_ROAD_CLIP }],
      },
    ],
    vehicles: [
      {
        typeId: HANDCART,
        id: 'handcart',
        jobId: HANDCART_JOB,
        stockSlots: HANDCART_SLOTS,
        logicSize: HANDCART_LOGIC_SIZE,
        passengerJobs: [],
        hitpoints: HANDCART_HITPOINTS,
      },
    ],
    atomicAnimations: [{ id: BUILD_ROAD_CLIP, name: BUILD_ROAD_CLIP, length: BUILD_ROAD_CLIP_TICKS }],
    buildings: [
      {
        typeId: STORE,
        id: 'headquarters',
        kind: 'storage',
        stock: [
          { goodType: STONE, capacity: 20 },
          { goodType: WOOD, capacity: 20 },
        ],
      },
      {
        typeId: HOUSE,
        id: 'home_small',
        kind: 'home',
        homeSize: 1,
        construction: [{ goodType: STONE, amount: 1 }],
      },
      {
        typeId: HUT,
        id: 'hut',
        kind: 'home',
        homeSize: 1,
        construction: [{ goodType: STONE, amount: 1 }],
        footprint: HUT_FOOTPRINT,
      },
    ],
  });
}

function roadSim(seed = 1): Simulation {
  const map: TerrainMap = grassNodeMap(MAP_WIDTH, MAP_HEIGHT);
  const sim = new Simulation({
    seed,
    content: roadContent(),
    map: { ...map, landscapes: { types: [WALL], placements: [] } },
  });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: HUMAN, tribes: [VIKING] });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: RIVAL, tribes: [VIKING] });
  return sim;
}

function storeAt(sim: Simulation, hx: number, stone = 10): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, ROW));
  sim.world.add(e, Building, { buildingType: STORE, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, {
    amounts: new Map([
      [STONE, stone],
      [WOOD, 10],
    ]),
  });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

function houseSiteAt(sim: Simulation, hx: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, ROW));
  sim.world.add(e, Building, { buildingType: HOUSE, tribe: VIKING, built: fx.fromInt(0), level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  sim.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

function builderAt(sim: Simulation, hx: number, hy = ROW): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: BUILDER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

/** Order road sites through the seat's own command path and apply them. */
function orderRoads(sim: Simulation, nodes: readonly { hx: number; hy: number }[], player = HUMAN): void {
  for (const { hx, hy } of nodes) {
    sim.enqueue(playerCommand(player, { kind: 'placeRoadSite', x: hx, y: hy, tribe: VIKING }));
  }
  sim.step();
}

function siteAt(sim: Simulation, hx: number, hy: number): Entity | undefined {
  return [...sim.world.query(RoadSite, Position)].find((e) => {
    const n = nodeOfPosition(sim.world.get(e, Position).x, sim.world.get(e, Position).y);
    return n.hx === hx && n.hy === hy;
  });
}

function roadAt(sim: Simulation, hx: number, hy: number): boolean {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('expected a mapped simulation');
  return isRoad(sim.world, terrain.nodeAt(hx, hy));
}

/** Hand `site` its stone and a claim holder that has landed its one strike, then run the finish. */
function finishDirectly(sim: Simulation, site: Entity): Entity {
  const builder = builderAt(sim, STORE_HX);
  sim.world.add(builder, SiteAssignment, { site, pinned: false });
  expect(claimSite(sim.world, site, builder)).toBe(true);
  setStockAmount(sim.world, site, STONE, 1);
  sim.world.mut(site, UnderConstruction).labor = ONE;
  constructionSystem(sim.world, ctxOf(sim));
  return builder;
}

const CENTRE = { hx: 20, hy: ROW };

describe('road site commands', () => {
  it('place a seat-owned site costing one stone, even under a standing settler', () => {
    const sim = roadSim();
    builderAt(sim, CENTRE.hx, CENTRE.hy);
    orderRoads(sim, [CENTRE]);
    const site = siteAt(sim, CENTRE.hx, CENTRE.hy);
    if (site === undefined) throw new Error('expected a road site');
    expect(sim.world.get(site, Owner)).toEqual({ player: HUMAN });
    expect(sim.world.get(site, RoadSite).construction).toEqual([{ goodType: STONE, amount: 1 }]);
    expect(sim.world.has(site, UnderConstruction)).toBe(true);
  });

  it('refuse a node under a building, a wall, a road or another site', () => {
    const sim = roadSim();
    storeAt(sim, STORE_HX);
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: 10,
      y: ROW,
      tribe: VIKING,
      owner: HUMAN,
    });
    orderRoads(sim, [CENTRE]);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected a mapped simulation');
    const laid = siteAt(sim, CENTRE.hx, CENTRE.hy);
    if (laid === undefined) throw new Error('expected a road site');
    finishDirectly(sim, laid);
    expect(roadAt(sim, CENTRE.hx, CENTRE.hy)).toBe(true);
    orderRoads(sim, [{ hx: 30, hy: ROW }]);

    const probe = roadSitePlacementProbe(sim.world, sim.content, terrain);
    expect(probe.canPlace(STORE_HX, ROW), 'building').toBe(false);
    expect(probe.canPlace(10, ROW), 'wall').toBe(false);
    expect(probe.canPlace(CENTRE.hx, CENTRE.hy), 'road').toBe(false);
    expect(probe.canPlace(30, ROW), 'site').toBe(false);
    expect(probe.canPlace(-1, ROW), 'off the map').toBe(false);
    expect(probe.canPlace(34, ROW), 'open grass').toBe(true);

    const before = [...sim.world.query(RoadSite)].length;
    orderRoads(sim, [{ hx: STORE_HX, hy: ROW }, { hx: 10, hy: ROW }, CENTRE, { hx: 30, hy: ROW }]);
    expect([...sim.world.query(RoadSite)]).toHaveLength(before);
  });

  it('ignore a parked vehicle, which a wall still refuses', () => {
    const sim = roadSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected a mapped simulation');
    createVehicle(sim.world, ctxOf(sim), {
      vehicleType: HANDCART,
      x: CENTRE.hx,
      y: CENTRE.hy,
      tribe: VIKING,
      owner: HUMAN,
    });
    const wallProbe = palisadeProbe(sim.world, sim.content, terrain, WALL.typeId);
    expect(wallProbe?.canPlace(CENTRE.hx, CENTRE.hy)).toBe(false);
    expect(roadSitePlacementProbe(sim.world, sim.content, terrain).canPlace(CENTRE.hx, CENTRE.hy)).toBe(true);
    orderRoads(sim, [CENTRE]);
    expect(siteAt(sim, CENTRE.hx, CENTRE.hy)).toBeDefined();
  });

  it('answer the probe as plain data, keyed to change when a road site is ordered', () => {
    const sim = roadSim();
    storeAt(sim, STORE_HX);
    sim.step();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected a mapped simulation');
    const area: NodeArea = { minHx: -1, minHy: -1, maxHx: MAP_WIDTH, maxHy: MAP_HEIGHT };
    const before = sim.roadSiteAnswer(area);
    if (before === null) throw new Error('expected an answer');
    expect(sim.roadSiteAnswer(area)?.key).toBe(before.key);
    orderRoads(sim, [CENTRE]);
    const after = sim.roadSiteAnswer(area);
    if (after === null) throw new Error('expected an answer');
    expect(after.key).not.toBe(before.key);
    const probe = roadSitePlacementProbe(sim.world, sim.content, terrain);
    for (let hy = area.minHy; hy <= area.maxHy; hy++) {
      for (let hx = area.minHx; hx <= area.maxHx; hx++) {
        expect(nodeGridAccepts(after, hx, hy), `${hx},${hy}`).toBe(probe.canPlace(hx, hy));
      }
    }
    expect(nodeGridAccepts(after, CENTRE.hx, CENTRE.hy)).toBe(false);
    expect(nodeGridAccepts(before, CENTRE.hx, CENTRE.hy)).toBe(true);
  });

  it('refuse a seat the force option and a tribe it may not place', () => {
    const sim = roadSim();
    sim.enqueue(playerCommand(HUMAN, { kind: 'placeRoadSite', x: 20, y: ROW, tribe: VIKING, force: true }));
    sim.enqueue(playerCommand(HUMAN, { kind: 'placeRoadSite', x: 22, y: ROW, tribe: VIKING + 1 }));
    sim.step();
    expect([...sim.world.query(RoadSite)]).toEqual([]);
  });

  it('let only the owner cancel a site, spilling its stone and letting its builder go', () => {
    const sim = roadSim();
    orderRoads(sim, [CENTRE]);
    const site = siteAt(sim, CENTRE.hx, CENTRE.hy);
    if (site === undefined) throw new Error('expected a road site');
    const builder = builderAt(sim, STORE_HX);
    sim.world.add(builder, SiteAssignment, { site, pinned: false });
    claimSite(sim.world, site, builder);
    setStockAmount(sim.world, site, STONE, 1);

    sim.enqueue(playerCommand(RIVAL, { kind: 'cancelRoadSite', roadSite: site }));
    sim.step();
    expect(sim.world.isAlive(site)).toBe(true);

    sim.enqueue(playerCommand(HUMAN, { kind: 'cancelRoadSite', roadSite: site }));
    sim.step();
    expect(sim.world.isAlive(site)).toBe(false);
    expect(sim.world.tryGet(builder, SiteAssignment)?.site).not.toBe(site);
    const spilled = [...sim.world.query(Stockpile)].reduce(
      (sum, e) =>
        sum + (sim.world.has(e, Building) ? 0 : (sim.world.get(e, Stockpile).amounts.get(STONE) ?? 0)),
      0,
    );
    expect(spilled).toBe(1);
  });
});

describe('road sites under a new structure', () => {
  function totalStone(sim: Simulation): number {
    let stone = 0;
    for (const e of sim.world.query(Stockpile)) stone += sim.world.get(e, Stockpile).amounts.get(STONE) ?? 0;
    return stone;
  }

  it('are withdrawn under a building body, their stone spilled, while a laid road and the margin stay', () => {
    const sim = roadSim();
    const laid = { hx: 21, hy: ROW };
    const covered = { hx: CENTRE.hx, hy: ROW };
    const margin = { hx: 22, hy: ROW };
    orderRoads(sim, [laid]);
    const laidSite = siteAt(sim, laid.hx, laid.hy);
    if (laidSite === undefined) throw new Error('expected a road site');
    const holder = finishDirectly(sim, laidSite);
    sim.world.remove(holder, SiteAssignment);
    orderRoads(sim, [covered, margin]);
    const site = siteAt(sim, covered.hx, covered.hy);
    if (site === undefined) throw new Error('expected a road site');
    setStockAmount(sim.world, site, STONE, 1);

    sim.enqueue(
      playerCommand(HUMAN, { kind: 'placeBuilding', buildingType: HUT, x: CENTRE.hx, y: ROW, tribe: VIKING }),
    );
    sim.step();
    expect([...sim.world.query(Building)]).toHaveLength(1);
    expect(sim.world.isAlive(site)).toBe(false);
    expect(siteAt(sim, margin.hx, margin.hy)).toBeDefined();
    expect(roadAt(sim, laid.hx, laid.hy)).toBe(true);
    expect(totalStone(sim)).toBe(1);
  });

  it('are withdrawn under a wall segment', () => {
    const sim = roadSim();
    orderRoads(sim, [CENTRE]);
    const site = siteAt(sim, CENTRE.hx, CENTRE.hy);
    if (site === undefined) throw new Error('expected a road site');
    sim.enqueue(
      playerCommand(HUMAN, {
        kind: 'placePalisade',
        gfxIndex: WALL.typeId,
        x: CENTRE.hx,
        y: CENTRE.hy,
        tribe: VIKING,
        underConstruction: true,
      }),
    );
    sim.step();
    expect([...sim.world.query(Palisade)]).toHaveLength(1);
    expect(sim.world.isAlive(site)).toBe(false);
  });
});

describe('road site construction', () => {
  it('a builder fetches one stone, swings the build-road action once and lays the road', () => {
    const sim = roadSim();
    const store = storeAt(sim, STORE_HX);
    const builder = builderAt(sim, 8);
    orderRoads(sim, [CENTRE]);
    const site = siteAt(sim, CENTRE.hx, CENTRE.hy);
    if (site === undefined) throw new Error('expected a road site');

    let swings = 0;
    let swinging = false;
    for (let tick = 0; tick < BUILD_TICKS && sim.world.isAlive(site); tick++) {
      sim.step();
      const atomic = sim.world.tryGet(builder, CurrentAtomic);
      const construct = atomic?.effect.kind === 'construct';
      if (construct && !swinging) {
        expect(atomic?.atomicId).toBe(BUILD_ROAD_ATOMIC);
        swings++;
      }
      swinging = construct;
    }
    expect(sim.world.isAlive(site)).toBe(false);
    expect(swings).toBe(1);
    expect(roadAt(sim, CENTRE.hx, CENTRE.hy)).toBe(true);
    expect(sim.world.get(store, Stockpile).amounts.get(STONE)).toBe(9);
    expect(sim.world.tryGet(builder, SiteAssignment)?.site).not.toBe(site);
  });

  it('pave the six lattice neighbours that wait unclaimed and unsupplied, seven nodes for one stone', () => {
    const sim = roadSim();
    // The half-cell lattice neighbours: E and W, and two in each adjacent row, which the odd-row stagger
    // shifts half a node east.
    const ring = hexNeighboursOf(CENTRE.hx, CENTRE.hy);
    expect(ring).toEqual([
      { hx: 21, hy: 6 },
      { hx: 19, hy: 6 },
      { hx: 19, hy: 5 },
      { hx: 20, hy: 5 },
      { hx: 19, hy: 7 },
      { hx: 20, hy: 7 },
    ]);
    const beyond = { hx: 22, hy: ROW };
    orderRoads(sim, [CENTRE, ...ring, beyond]);
    const centre = siteAt(sim, CENTRE.hx, CENTRE.hy);
    if (centre === undefined) throw new Error('expected a road site');
    finishDirectly(sim, centre);

    for (const n of [CENTRE, ...ring]) {
      expect(roadAt(sim, n.hx, n.hy), `${n.hx},${n.hy}`).toBe(true);
      expect(siteAt(sim, n.hx, n.hy)).toBeUndefined();
    }
    expect(roadAt(sim, beyond.hx, beyond.hy)).toBe(false);
    expect(siteAt(sim, beyond.hx, beyond.hy)).toBeDefined();
  });

  it('leave a claimed, a stocked, a supplied and a rival neighbour to their own build', () => {
    const sim = roadSim();
    const [claimed, stocked, supplied, free, , rival] = hexNeighboursOf(CENTRE.hx, CENTRE.hy);
    if (claimed === undefined || stocked === undefined || supplied === undefined || free === undefined) {
      throw new Error('expected six neighbours');
    }
    if (rival === undefined) throw new Error('expected six neighbours');
    orderRoads(sim, [CENTRE, claimed, stocked, supplied, free]);
    orderRoads(sim, [rival], RIVAL);
    const at = (n: { hx: number; hy: number }): Entity => {
      const e = siteAt(sim, n.hx, n.hy);
      if (e === undefined) throw new Error(`expected a road site at ${n.hx},${n.hy}`);
      return e;
    };
    const holder = builderAt(sim, 30);
    sim.world.add(holder, SiteAssignment, { site: at(claimed), pinned: false });
    claimSite(sim.world, at(claimed), holder);
    setStockAmount(sim.world, at(stocked), STONE, 1);
    const carrier = builderAt(sim, 30);
    sim.world.add(carrier, SupplyRun, { site: at(supplied), goodType: STONE, amount: 1, source: null });

    finishDirectly(sim, at(CENTRE));
    expect(roadAt(sim, free.hx, free.hy)).toBe(true);
    for (const kept of [claimed, stocked, supplied, rival]) {
      expect(roadAt(sim, kept.hx, kept.hy), `${kept.hx},${kept.hy}`).toBe(false);
      expect(siteAt(sim, kept.hx, kept.hy)).toBeDefined();
    }
    expect(sim.world.get(holder, SiteAssignment).site).toBe(at(claimed));
  });

  it('come after a building site and a wall site, even when the road site is nearest', () => {
    const sim = roadSim();
    storeAt(sim, STORE_HX);
    const house = houseSiteAt(sim, FAR_HX);
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: 30,
      y: ROW,
      tribe: VIKING,
      owner: HUMAN,
      underConstruction: true,
    });
    const builder = builderAt(sim, 8);
    orderRoads(sim, [{ hx: 10, hy: ROW }]);
    const road = siteAt(sim, 10, ROW);
    const [wall] = [...sim.world.query(Palisade)];
    if (road === undefined || wall === undefined) throw new Error('expected a road and a wall site');

    for (let tick = 0; tick < 3 * BUILD_TICKS && sim.world.isAlive(road); tick++) {
      sim.step();
      if (sim.world.tryGet(builder, SiteAssignment)?.site === road) {
        expect(sim.world.has(house, UnderConstruction), `house first, tick ${tick}`).toBe(false);
        expect(sim.world.has(wall, UnderConstruction), `wall first, tick ${tick}`).toBe(false);
      }
    }
    expect(sim.world.isAlive(road)).toBe(false);
    expect(roadAt(sim, 10, ROW)).toBe(true);
  });

  it('cancelled while its stone is on the way, strands no errand and loses no stone', () => {
    const sim = roadSim();
    storeAt(sim, STORE_HX);
    const builder = builderAt(sim, 8);
    orderRoads(sim, [{ hx: FAR_HX, hy: ROW }]);
    const site = siteAt(sim, FAR_HX, ROW);
    if (site === undefined) throw new Error('expected a road site');
    for (let tick = 0; tick < BUILD_TICKS && !sim.world.has(builder, Carrying); tick++) sim.step();
    expect(sim.world.get(builder, SupplyRun).site).toBe(site);

    sim.enqueue(playerCommand(HUMAN, { kind: 'cancelRoadSite', roadSite: site }));
    for (let tick = 0; tick < BUILD_TICKS && sim.world.has(builder, Carrying); tick++) sim.step();
    expect(sim.world.isAlive(site)).toBe(false);
    expect(sim.world.tryGet(builder, SupplyRun)?.site).not.toBe(site);
    expect(sim.world.tryGet(builder, SiteAssignment)).toBeUndefined();
    let stone = 0;
    for (const e of sim.world.query(Stockpile)) stone += sim.world.get(e, Stockpile).amounts.get(STONE) ?? 0;
    expect(stone + (sim.world.tryGet(builder, Carrying)?.amount ?? 0)).toBe(10);
  });
});

describe('road site pick', () => {
  /** Seven pending sites in a row, west to east. */
  const LINE = [10, 11, 12, 13, 14, 15, 16].map((hx) => ({ hx, hy: ROW }));

  function lineSites(sim: Simulation): Entity[] {
    orderRoads(sim, LINE);
    return LINE.map(({ hx, hy }) => {
      const site = siteAt(sim, hx, hy);
      if (site === undefined) throw new Error(`expected a road site at ${hx},${hy}`);
      return site;
    });
  }

  it('two builders pick interior sites a stone apart and pave six of seven with two stones', () => {
    const sim = roadSim();
    const store = storeAt(sim, STORE_HX, 2);
    const builders = [builderAt(sim, 6), builderAt(sim, 7)];
    const sites = lineSites(sim);
    const firstPick = new Map<Entity, Entity>();
    for (let tick = 0; tick < BUILD_TICKS; tick++) {
      sim.step();
      for (const b of builders) {
        const site = sim.world.tryGet(b, SiteAssignment)?.site;
        if (site !== undefined && !firstPick.has(b)) firstPick.set(b, site);
      }
    }
    expect(builders.map((b) => sites.indexOf(firstPick.get(b) ?? -1))).toEqual([1, 4]);
    expect(LINE.map(({ hx, hy }) => roadAt(sim, hx, hy))).toEqual([true, true, true, true, true, true, false]);
    expect(sim.world.get(store, Stockpile).amounts.get(STONE) ?? 0).toBe(0);
  });

  it('prefers the most pending cover away from another builder claim, then the nearer site', () => {
    const sim = roadSim();
    const sites = lineSites(sim);
    const terrain = sim.terrain;
    const [west, second] = sites;
    if (terrain === undefined || west === undefined || second === undefined) throw new Error('expected sites');
    const holder = builderAt(sim, 30);
    sim.world.add(holder, SiteAssignment, { site: second, pinned: false });
    claimSite(sim.world, second, holder);
    const seeker = builderAt(sim, 2);
    const here = terrain.nodeAt(2, ROW);
    const pick = pickRoadSite(sim.world, terrain, seeker, here, west, () => true);
    expect(sites.indexOf(pick)).toBe(4);
    const lone = pickRoadSite(sim.world, terrain, seeker, here, west, (site) => site === west);
    expect(lone).toBe(west);
  });
});

describe('road sites persisted', () => {
  function midBuild(): Simulation {
    const sim = roadSim(7);
    storeAt(sim, STORE_HX);
    builderAt(sim, 8);
    orderRoads(sim, [
      { hx: 16, hy: ROW },
      { hx: 17, hy: ROW },
      { hx: 30, hy: ROW },
    ]);
    sim.run(40);
    return sim;
  }

  it('round-trip a claimed site through a save, and replay identically from the same seed', () => {
    const sim = midBuild();
    expect([...sim.world.query(RoadSite)].some((e) => sim.world.get(e, RoadSite).reservation !== null)).toBe(
      true,
    );
    const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content, map: roadMapOf() });
    expect(restored.hashState()).toBe(sim.hashState());

    const a = midBuild();
    const b = midBuild();
    a.run(BUILD_TICKS);
    b.run(BUILD_TICKS);
    expect(a.hashState()).toBe(b.hashState());
    expect(a.world.verifyCaches()).toEqual([]);
    expect([...a.world.query(RoadSite)]).toEqual([]);
  });
});

function roadMapOf(): TerrainMap {
  return { ...grassNodeMap(MAP_WIDTH, MAP_HEIGHT), landscapes: { types: [WALL], placements: [] } };
}
