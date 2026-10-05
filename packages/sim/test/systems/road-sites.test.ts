import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  Owner,
  Palisade,
  Position,
  Resource,
  RoadSite,
  SiteAssignment,
  Stockpile,
  Stump,
  SupplyRun,
  setStockAmount,
  stampOwner,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  hexNeighboursOf,
  type NodeArea,
  nodeGridAccepts,
  ONE,
  playerCommand,
  positionOfNode,
  restoreSimulation,
  type ScriptLandscapeType,
  type Simulation,
} from '../../src/index.js';
import { createBerryBush } from '../../src/systems/economy/berries.js';
import { constructionSystem } from '../../src/systems/economy/construction.js';
import { claimSite, releaseSiteClaim } from '../../src/systems/economy/site-claim.js';
import { stampResourceFootprintData } from '../../src/systems/footprint/index.js';
import { palisadePlacementProbe as palisadeProbe } from '../../src/systems/palisades/index.js';
import { openRoadSites } from '../../src/systems/roads/site-index.js';
import { pickRoadSite } from '../../src/systems/roads/site-pick.js';
import { roadSitePlacementProbe } from '../../src/systems/roads/sites.js';
import { createVehicle } from '../../src/systems/vehicles/index.js';
import { ctxOf } from '../fixtures/context.js';
import {
  BUILD_ROAD_ATOMIC,
  BUILD_TICKS,
  builderAt,
  FAR_HX,
  HANDCART,
  HUMAN,
  HUT,
  houseSiteAt,
  MAP_HEIGHT,
  MAP_WIDTH,
  MUSHROOM_GFX,
  orderRoads,
  RIVAL,
  ROW,
  roadAt,
  roadMapOf,
  roadSim,
  STONE,
  STORE_HX,
  siteAt,
  storeAt,
  TREE_GFX,
  VIKING,
  WALL,
  WOOD,
  WOODEN_HOUSE,
} from './road-support.js';

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
const SAPLING = { hx: 24, hy: ROW };
const BUSH = { hx: 26, hy: ROW };
const HEAP = { hx: 28, hy: ROW };
const MUSHROOM = { hx: 30, hy: ROW };

/** A resource on `at` stamped from landscape record `gfx` at a level that blocks nothing yet. */
function resourceAt(sim: Simulation, at: { hx: number; hy: number }, gfx: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(at.hx, at.hy));
  sim.world.add(e, Resource, { goodType: WOOD, remaining: 1, harvestAtomic: 0 });
  stampResourceFootprintData(sim.world, e, {
    walk: [],
    build: [],
    work: [{ dx: 0, dy: 0 }],
    sourceGfxIndex: gfx,
  });
  return e;
}

/** Stone lying on the ground, outside every building. */
function looseStone(sim: Simulation): number {
  let stone = 0;
  for (const e of sim.world.query(Stockpile)) {
    if (!sim.world.has(e, Building)) stone += sim.world.get(e, Stockpile).amounts.get(STONE) ?? 0;
  }
  return stone;
}
/** The store's stone in the scenes that count every unit after a site goes away mid-errand. */
const STOCKED_STONE = 10;

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

  it('refuse a young tree that blocks no walk yet, and clear what grows or lies loose', () => {
    const sim = roadSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected a mapped simulation');
    const area: NodeArea = { minHx: 0, minHy: 0, maxHx: MAP_WIDTH - 1, maxHy: MAP_HEIGHT - 1 };
    const before = sim.roadSiteAnswer(area);
    if (before === null) throw new Error('expected an answer');
    const sapling = resourceAt(sim, SAPLING, TREE_GFX);
    const mushroom = resourceAt(sim, MUSHROOM, MUSHROOM_GFX);
    const bush = createBerryBush(sim.world, { x: BUSH.hx, y: BUSH.hy });
    const stump = sim.world.create();
    sim.world.add(stump, Position, positionOfNode(CENTRE.hx, CENTRE.hy));
    sim.world.add(stump, Stump, { goodType: WOOD });
    const heap = sim.world.create();
    sim.world.add(heap, Position, positionOfNode(HEAP.hx, HEAP.hy));
    sim.world.add(heap, Stockpile, { amounts: new Map([[STONE, 2]]) });

    const probe = roadSitePlacementProbe(sim.world, sim.content, terrain);
    expect(probe.canPlace(SAPLING.hx, SAPLING.hy), 'young tree').toBe(false);
    for (const at of [MUSHROOM, BUSH, CENTRE, HEAP]) expect(probe.canPlace(at.hx, at.hy)).toBe(true);
    const after = sim.roadSiteAnswer(area);
    if (after === null) throw new Error('expected an answer');
    expect(nodeGridAccepts(before, SAPLING.hx, SAPLING.hy)).toBe(true);
    expect(nodeGridAccepts(after, SAPLING.hx, SAPLING.hy)).toBe(false);

    orderRoads(sim, [SAPLING, MUSHROOM, BUSH, CENTRE, HEAP]);
    expect(siteAt(sim, SAPLING.hx, SAPLING.hy)).toBeUndefined();
    for (const at of [MUSHROOM, BUSH, CENTRE, HEAP]) expect(siteAt(sim, at.hx, at.hy)).toBeDefined();
    expect([sapling, mushroom, bush, stump, heap].map((e) => sim.world.isAlive(e))).toEqual([
      true,
      false,
      false,
      false,
      true,
    ]);
    const cleared = sim.events.current().flatMap((ev) => (ev.kind === 'groundCleared' ? ev.razed : []));
    expect([...cleared].sort((a, b) => a - b)).toEqual([mushroom, bush, stump].sort((a, b) => a - b));
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('take the same ground as a wall segment, which clears it the same way', () => {
    const sim = roadSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected a mapped simulation');
    resourceAt(sim, SAPLING, TREE_GFX);
    const mushroom = resourceAt(sim, MUSHROOM, MUSHROOM_GFX);
    const road = roadSitePlacementProbe(sim.world, sim.content, terrain);
    const wall = palisadeProbe(sim.world, sim.content, terrain, WALL.typeId);
    for (const at of [SAPLING, MUSHROOM, CENTRE]) {
      expect(wall?.canPlace(at.hx, at.hy), `${at.hx},${at.hy}`).toBe(road.canPlace(at.hx, at.hy));
    }
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: MUSHROOM.hx,
      y: MUSHROOM.hy,
      tribe: VIKING,
      owner: HUMAN,
    });
    sim.step();
    expect(sim.world.isAlive(mushroom)).toBe(false);
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

describe('road site stone', () => {
  it('is left beside the road by a debug completion, which spends none', () => {
    const sim = roadSim();
    orderRoads(sim, [CENTRE]);
    const site = siteAt(sim, CENTRE.hx, CENTRE.hy);
    if (site === undefined) throw new Error('expected a road site');
    setStockAmount(sim.world, site, STONE, 1);
    sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: site });
    sim.step();
    expect(roadAt(sim, CENTRE.hx, CENTRE.hy)).toBe(true);
    expect(looseStone(sim)).toBe(1);
  });

  it('spills beside a cancelled site forced onto water', () => {
    const sim = roadSim(1, MAP_WIDTH, [CENTRE]);
    sim.enqueueSetup({
      kind: 'placeRoadSite',
      x: CENTRE.hx,
      y: CENTRE.hy,
      tribe: VIKING,
      owner: HUMAN,
      force: true,
    });
    sim.step();
    const site = siteAt(sim, CENTRE.hx, CENTRE.hy);
    if (site === undefined) throw new Error('expected a forced road site');
    setStockAmount(sim.world, site, STONE, 1);
    sim.enqueue(playerCommand(HUMAN, { kind: 'cancelRoadSite', roadSite: site }));
    sim.step();
    expect(sim.world.isAlive(site)).toBe(false);
    expect(looseStone(sim)).toBe(1);
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

  it('leave a claimed, a stocked and a rival neighbour to their own build', () => {
    const sim = roadSim();
    const [claimed, stocked, free, , , rival] = hexNeighboursOf(CENTRE.hx, CENTRE.hy);
    if (claimed === undefined || stocked === undefined || free === undefined || rival === undefined) {
      throw new Error('expected six neighbours');
    }
    orderRoads(sim, [CENTRE, claimed, stocked, free]);
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

    finishDirectly(sim, at(CENTRE));
    expect(roadAt(sim, free.hx, free.hy)).toBe(true);
    for (const kept of [claimed, stocked, rival]) {
      expect(roadAt(sim, kept.hx, kept.hy), `${kept.hx},${kept.hy}`).toBe(false);
      expect(siteAt(sim, kept.hx, kept.hy)).toBeDefined();
    }
    expect(sim.world.get(holder, SiteAssignment).site).toBe(at(claimed));
  });

  it('pave a neighbour whose errand lost its claim, and the stone on the way stays whole', () => {
    const sim = roadSim();
    storeAt(sim, STORE_HX, STOCKED_STONE);
    const builder = builderAt(sim, 8);
    const [east] = hexNeighboursOf(CENTRE.hx, CENTRE.hy);
    if (east === undefined) throw new Error('expected six neighbours');
    orderRoads(sim, [CENTRE, east]);
    for (let tick = 0; tick < BUILD_TICKS && !sim.world.has(builder, Carrying); tick++) sim.step();
    // Two neighbours: the builder fetches for one, the other finishes with stone of its own.
    const errand = sim.world.get(builder, SupplyRun).site;
    const other = [CENTRE, east].map(({ hx, hy }) => siteAt(sim, hx, hy)).find((e) => e !== errand);
    if (other === undefined) throw new Error('expected the other site');
    releaseSiteClaim(sim.world, builder);
    sim.world.remove(builder, SiteAssignment);

    finishDirectly(sim, other);
    expect(sim.world.isAlive(errand)).toBe(false);
    expect(roadAt(sim, CENTRE.hx, CENTRE.hy) && roadAt(sim, east.hx, east.hy)).toBe(true);
    for (let tick = 0; tick < BUILD_TICKS && sim.world.has(builder, Carrying); tick++) sim.step();
    expect(sim.world.tryGet(builder, SupplyRun)?.site).not.toBe(errand);
    let stone = 0;
    for (const e of sim.world.query(Stockpile)) stone += sim.world.get(e, Stockpile).amounts.get(STONE) ?? 0;
    expect(stone + (sim.world.tryGet(builder, Carrying)?.amount ?? 0)).toBe(STOCKED_STONE);
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

  it('wait for a building site only while it holds a task the builder can do', () => {
    for (const wood of [0, 1]) {
      const sim = roadSim();
      const store = storeAt(sim, STORE_HX);
      setStockAmount(sim.world, store, WOOD, wood);
      const house = houseSiteAt(sim, 12, WOODEN_HOUSE);
      const builder = builderAt(sim, 8);
      orderRoads(sim, [{ hx: 10, hy: ROW }]);
      const road = siteAt(sim, 10, ROW);
      if (road === undefined) throw new Error('expected a road site');

      for (let tick = 0; tick < 2 * BUILD_TICKS && sim.world.isAlive(road); tick++) {
        sim.step();
        if (wood > 0 && sim.world.tryGet(builder, SiteAssignment)?.site === road) {
          expect(sim.world.has(house, UnderConstruction), `house first, tick ${tick}`).toBe(false);
        }
      }
      expect(roadAt(sim, 10, ROW), `wood ${wood}`).toBe(true);
      expect(sim.world.has(house, UnderConstruction), `wood ${wood}`).toBe(wood === 0);
    }
  });

  it('cancelled while its stone is on the way, strands no errand and loses no stone', () => {
    const sim = roadSim();
    storeAt(sim, STORE_HX, STOCKED_STONE);
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
    expect(stone + (sim.world.tryGet(builder, Carrying)?.amount ?? 0)).toBe(STOCKED_STONE);
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
    expect(builders.map((b) => firstPick.get(b))).toEqual([sites[1], sites[4]]);
    expect(LINE.map(({ hx, hy }) => roadAt(sim, hx, hy))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(sim.world.get(store, Stockpile).amounts.get(STONE) ?? 0).toBe(0);
  });

  it('a builder with no stone to fetch claims no site, so the one stone paves its full cover', () => {
    const sim = roadSim();
    const store = storeAt(sim, STORE_HX, 1);
    const builders = [builderAt(sim, 6), builderAt(sim, 7)];
    const sites = lineSites(sim);
    for (let tick = 0; tick < BUILD_TICKS; tick++) {
      sim.step();
      const holders = builders.filter((b) => sim.world.has(b, SiteAssignment));
      expect(holders.length, `tick ${tick}`).toBeLessThanOrEqual(1);
    }
    expect(LINE.map(({ hx, hy }) => roadAt(sim, hx, hy))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(sim.world.get(store, Stockpile).amounts.get(STONE) ?? 0).toBe(0);
    for (const site of sites.slice(3)) expect(sim.world.get(site, RoadSite).reservation).toBeNull();
  });

  it('prefers the most pending cover away from another builder claim, then the nearer site', () => {
    const sim = roadSim();
    const sites = lineSites(sim);
    const terrain = sim.terrain;
    const [west, second] = sites;
    if (terrain === undefined || west === undefined || second === undefined)
      throw new Error('expected sites');
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

describe('road site index', () => {
  it('moves a site between owners when its owner changes in place', () => {
    const sim = roadSim();
    orderRoads(sim, [CENTRE, { hx: 30, hy: ROW }]);
    const terrain = sim.terrain;
    const site = siteAt(sim, CENTRE.hx, CENTRE.hy);
    if (terrain === undefined || site === undefined) throw new Error('expected a road site');
    setStockAmount(sim.world, site, STONE, 1);
    expect(openRoadSites(sim.world, terrain, HUMAN)).toEqual({ unstocked: 1, stocked: 1 });

    stampOwner(sim.world, site, RIVAL);
    expect(openRoadSites(sim.world, terrain, HUMAN)).toEqual({ unstocked: 1, stocked: 0 });
    expect(openRoadSites(sim.world, terrain, RIVAL)).toEqual({ unstocked: 0, stocked: 1 });
    expect(sim.world.verifyCaches()).toEqual([]);

    sim.world.remove(site, Owner);
    expect(openRoadSites(sim.world, terrain, RIVAL)).toEqual({ unstocked: 0, stocked: 0 });
    expect(openRoadSites(sim.world, terrain, undefined)).toEqual({ unstocked: 1, stocked: 1 });
    expect(sim.world.verifyCaches()).toEqual([]);

    // The verifier checks the tallies themselves, not only the per-site entries they sum.
    openRoadSites(sim.world, terrain, HUMAN).unstocked++;
    expect(sim.world.verifyCaches()).toEqual([`open road sites of owner ${HUMAN} are tallied stale`]);
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
