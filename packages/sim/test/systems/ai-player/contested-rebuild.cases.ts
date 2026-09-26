import { footprintCellDx } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { AttackOrder, Building, DefenceMode, Position, Settler } from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { positionOfNode, Simulation, type TerrainMap } from '../../../src/index.js';
import {
  type BuildOrderEntry,
  buildOrderModule,
  enemyFire,
  REBUILD_DELAY_TICKS,
  sitePace,
  THREAT_STAND_DOWN_MARGIN_NODES,
  threatWatchNodes,
} from '../../../src/systems/ai-player/index.js';
import { seatRaiders } from '../../../src/systems/ai-player/military/defence/index.js';
import { SIGHT_RADIUS_NODES } from '../../../src/systems/conflict/targeting.js';
import { standsAtPost, TOWER_RANGE_BONUS_NODES } from '../../../src/systems/conflict/tower-post.js';
import { attackerWeapon } from '../../../src/systems/conflict/weapons.js';
import { buildingFootprintOf } from '../../../src/systems/footprint/geometry.js';
import { razeBuilding } from '../../../src/systems/lifecycle/cleanup.js';
import { entityNode } from '../../../src/systems/spatial/nodes.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { waterColumnMap } from '../../fixtures/terrain.js';
import {
  aiSim,
  BAKERY_TYPE,
  CIVILIST,
  ctxOf,
  entityOfBuilding,
  FARM_TYPE,
  HOME_TYPE,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  MILL_TYPE,
  makeAiSeat,
  placeHq,
  SEAT,
  STOCK_TOP_TYPE,
  TOWER_TYPE,
  VIKING,
  WELL_TYPE,
} from './support.js';

/**
 * Rebuilding under the enemy: nothing is placed while the defence sees a raid on the settlement, and a
 * razed building waits out the rebuild delay from the last decision that saw the attack, so the band that
 * razed it cannot flatten the site again as it rises.
 */

const FOE = 3;
const SPEARMAN = 32;
const BOWMAN = 40;
const BAKERY = { x: 34, y: 16 };
const MILL = { x: 38, y: 16 };
const ORDER: readonly BuildOrderEntry[] = [
  { kind: 'place', building: 'work_bakery_00', count: 1 },
  { kind: 'place', building: 'work_mill_00', count: 1 },
];
/** A far corner of the 64x32 fixture map, outside every watch band of the seat's buildings. */
const FAR_CORNER = { x: 2, y: 2 };
/** A water column (cell 22, nodes 44 to 46) east of the mill, on the fixture map in cells. */
const SEAM_MAP = { width: 32, height: 16, column: 22 };
/** East of the seam, well inside the mill's watch band. */
const FAR_BANK = { x: 50, y: 16 };
/** Long enough for a posted archer to walk the few nodes to his tower and step inside. */
const WALK_IN_TICKS = 200;
/** The far reach of the fixture's bowman, read off his weapon row. */
function bowReach(sim: Simulation): number {
  const bow = attackerWeapon(ctxOf(sim), VIKING, BOWMAN);
  if (bow === null) throw new Error('setup: the fixture bowman is unarmed');
  return bow.maxRange;
}

/** The nearest Manhattan distance from `at` to any wall cell of a `buildingType` site anchored on `site`. */
function wallDistance(sim: Simulation, buildingType: number, site: Spot, at: Spot): number {
  const cells = buildingFootprintOf(sim.content, buildingType)?.blocked ?? [];
  let nearest = Math.abs(site.x - at.x) + Math.abs(site.y - at.y);
  for (const c of cells) {
    const x = site.x + footprintCellDx(site.y, c);
    const y = site.y + c.dy;
    nearest = Math.min(nearest, Math.abs(x - at.x) + Math.abs(y - at.y));
  }
  return nearest;
}

/** A foe tower at `at` with a bowman walked in to man its post; returns the archer. */
function mannedFoeTower(sim: Simulation, at: Spot): Entity {
  const before = new Set(sim.world.query(Building));
  place(sim, TOWER_TYPE, at, FOE);
  sim.step();
  const tower = [...sim.world.query(Building)].find(
    (e) => !before.has(e) && sim.world.get(e, Building).buildingType === TOWER_TYPE,
  );
  if (tower === undefined) throw new Error('setup: no foe tower');
  const archer = onlyOne(spawnAt(sim, { x: at.x + 4, y: at.y }, BOWMAN));
  sim.enqueueSetup({ kind: 'assignWorker', entity: archer, building: tower, jobPriority: [BOWMAN] });
  for (let i = 0; i < WALK_IN_TICKS; i++) sim.step();
  expect(standsAtPost(sim.world, archer)).toBe(tower);
  return archer;
}

interface Spot {
  readonly x: number;
  readonly y: number;
}

function place(sim: Simulation, buildingType: number, at: Spot, owner = SEAT): void {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x: at.x, y: at.y, tribe: VIKING, owner });
}

function placementOf(commands: readonly Command[]): (Spot & { buildingType: number }) | null {
  const first = commands[0];
  if (first?.kind !== 'placeBuilding') return null;
  return { x: first.x, y: first.y, buildingType: first.buildingType };
}

/** The seat with its bakery just razed, so the next decision is its rebuild. */
function razedBakerySim(map?: TerrainMap): Simulation {
  const sim = map === undefined ? aiSim() : new Simulation({ seed: 1, content: aiContent(), map });
  placeHq(sim);
  place(sim, BAKERY_TYPE, BAKERY);
  place(sim, MILL_TYPE, MILL);
  sim.step();
  razeBuilding(sim.world, ctxOf(sim), entityOfBuilding(sim, BAKERY_TYPE));
  return sim;
}

/** Settlers of `owner` spawned over `at`, two nodes apart, as the wave that razed it would stand. */
function spawnAt(sim: Simulation, at: Spot, jobType: number, owner = FOE, count = 1): Entity[] {
  const before = new Set(sim.world.query(Settler));
  for (let i = 0; i < count; i++) {
    sim.enqueueSetup({ kind: 'spawnSettler', jobType, x: at.x + 2 * i, y: at.y, tribe: VIKING, owner });
  }
  sim.step();
  return [...sim.world.query(Settler)].filter((e) => !before.has(e));
}

function onlyOne(men: readonly Entity[]): Entity {
  const [man] = men;
  if (man === undefined || men.length !== 1) throw new Error('setup: expected exactly one spawn');
  return man;
}

function nodeOf(sim: Simulation, e: Entity): Spot {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: the fixture map builds no terrain graph');
  return terrain.coordsOf(entityNode(sim.world, terrain, e));
}

/** Put `e` on `at` between two decisions, undoing whatever the setup step walked him. */
function standAt(sim: Simulation, e: Entity, at: Spot): void {
  sim.world.add(e, Position, positionOfNode(at.x, at.y));
}

/** The node `distance` nodes (Manhattan) from the HQ, west first and then north: away from the mill. */
function offTheHq(sim: Simulation, distance: number): Spot {
  const hq = nodeOf(sim, entityOfBuilding(sim, HQ_TYPE));
  const west = Math.min(distance, hq.x);
  return { x: hq.x - west, y: hq.y - (distance - west) };
}

describe('build-order module - rebuilding under the enemy', () => {
  const module = buildOrderModule(ORDER);
  const decide = (sim: Simulation): readonly Command[] => module.run(sim.world, ctxOf(sim), SEAT);

  it('holds the placement while an enemy fighter stands in a watch band, until he clears the margin', () => {
    const sim = razedBakerySim();
    const home = placementOf(decide(sim));
    expect(home?.buildingType).toBe(BAKERY_TYPE);
    const watch = threatWatchNodes(ctxOf(sim), VIKING);

    const raider = onlyOne(spawnAt(sim, offTheHq(sim, watch), SPEARMAN));
    standAt(sim, raider, offTheHq(sim, watch));
    expect(decide(sim)).toEqual([]);

    // The alarm the defence raises over the HQ widens its band by the margin: a man drawing off only that
    // far still holds the build order, as he still holds the town in cover.
    const hq = entityOfBuilding(sim, HQ_TYPE);
    sim.enqueueSetup({ kind: 'setDefenceMode', building: hq, enabled: true });
    sim.step();
    expect(sim.world.has(hq, DefenceMode)).toBe(true);
    const inMargin = offTheHq(sim, watch + THREAT_STAND_DOWN_MARGIN_NODES);
    standAt(sim, raider, inMargin);
    expect(decide(sim)).toEqual([]);

    const clear = offTheHq(sim, watch + THREAT_STAND_DOWN_MARGIN_NODES + 1);
    standAt(sim, raider, clear);
    expect(placementOf(decide(sim))).toEqual(home);
  });

  it('does not hold for a far fighter carrying an attack order on one of its settlers', () => {
    const sim = razedBakerySim();
    const settler = onlyOne(spawnAt(sim, { x: FAR_CORNER.x + 2, y: FAR_CORNER.y }, CIVILIST, SEAT));
    const raider = onlyOne(spawnAt(sim, FAR_CORNER, SPEARMAN));
    sim.world.add(raider, AttackOrder, { target: settler });
    expect(placementOf(decide(sim))?.buildingType).toBe(BAKERY_TYPE);
  });

  it('does not hold for a fighter on ground the seat cannot walk to', () => {
    const sim = razedBakerySim(waterColumnMap(SEAM_MAP.width, SEAM_MAP.height, SEAM_MAP.column));
    const raider = onlyOne(spawnAt(sim, FAR_BANK, SPEARMAN));
    const at = nodeOf(sim, raider);
    const mill = nodeOf(sim, entityOfBuilding(sim, MILL_TYPE));
    // Inside the mill's band, so only the seam lets the placement through.
    expect(Math.abs(at.x - mill.x) + Math.abs(at.y - mill.y)).toBeLessThan(
      threatWatchNodes(ctxOf(sim), VIKING),
    );
    expect(placementOf(decide(sim))?.buildingType).toBe(BAKERY_TYPE);
  });

  it('does not hold for an enemy archer holding his own tower, but keeps the site out of his reach', () => {
    const sim = razedBakerySim();
    const near = placementOf(decide(sim));
    if (near === null) throw new Error('expected the bakery re-placed beside the mill');
    const archer = mannedFoeTower(sim, FAR_BANK);
    const post = nodeOf(sim, archer);
    const reach = bowReach(sim) + TOWER_RANGE_BONUS_NODES;
    // The old spot lies under the tower's bow: the garrison would shoot the site down as it rose.
    expect(wallDistance(sim, BAKERY_TYPE, near, post)).toBeLessThanOrEqual(reach);

    const moved = placementOf(decide(sim));
    expect(moved?.buildingType).toBe(BAKERY_TYPE);
    if (moved === null) throw new Error('expected the bakery re-placed out of reach');
    // Judged at the walls: every wall cell of the site, not only its anchor, lies past the reach.
    expect(wallDistance(sim, BAKERY_TYPE, moved, post)).toBeGreaterThan(reach);

    // An empty tower shoots nothing: the old spot is back.
    sim.world.destroy(archer);
    expect(placementOf(decide(sim))).toEqual(near);
  });

  it('waits the full rebuild delay from the last decision that saw the attack', () => {
    const sim = razedBakerySim();
    makeAiSeat(sim, SEAT);
    const decideAt = (tick: number): readonly Command[] => module.run(sim.world, ctxOf(sim, tick), SEAT);
    // Stand the bakery back up so the list completes and the frontier passes it, then lose it again.
    const home = placementOf(decideAt(0));
    if (home === null) throw new Error('expected the bakery placed');
    place(sim, BAKERY_TYPE, home);
    sim.step();
    expect(decideAt(0)).toEqual([]);
    razeBuilding(sim.world, ctxOf(sim), entityOfBuilding(sim, BAKERY_TYPE));

    const band = spawnAt(sim, BAKERY, SPEARMAN, FOE, 3);
    const lastAttacked = 2 * REBUILD_DELAY_TICKS;
    expect(decideAt(0)).toEqual([]);
    expect(decideAt(lastAttacked)).toEqual([]); // past the first delay, but still attacked

    for (const man of band) sim.world.destroy(man);
    expect(decideAt(lastAttacked + REBUILD_DELAY_TICKS - 1)).toEqual([]);
    expect(placementOf(decideAt(lastAttacked + REBUILD_DELAY_TICKS))).toEqual({
      ...home,
      buildingType: BAKERY_TYPE,
    });
  });

  it('judges an enemy fire reach at the walls: the span the site puts out from its anchor', () => {
    const fire = enemyFire([{ x: 10, y: 10, reach: 5 }]);
    expect(fire.reaches(15, 10, 0)).toBe(true);
    expect(fire.reaches(16, 10, 0)).toBe(false);
    expect(fire.reaches(16, 10, 1)).toBe(true);
    expect(enemyFire([]).reaches(10, 10, 0)).toBe(false);
    // Narrowed to the shooters a fan can meet: the disc's rim plus the span, and no one farther.
    expect(fire.around(30, 10, 14, 1).reaches(15, 10, 0)).toBe(true);
    expect(fire.around(30, 10, 13, 1).reaches(15, 10, 0)).toBe(false);
  });

  it("scans a seat's raiders once per world state, however many modules read them, and afresh once a man moves", () => {
    const sim = razedBakerySim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: the fixture map builds no terrain graph');
    spawnAt(sim, FAR_CORNER, SPEARMAN);
    sim.step();
    const ctx = ctxOf(sim);
    const first = seatRaiders(sim.world, ctx, terrain, SEAT);
    expect(first).toHaveLength(1);
    // The build order and the military module both read the seat's raiders in its decision tick.
    expect(seatRaiders(sim.world, ctx, terrain, SEAT)).toBe(first);
    spawnAt(sim, { x: FAR_CORNER.x + 6, y: FAR_CORNER.y }, BOWMAN);
    sim.step();
    const next = seatRaiders(sim.world, ctxOf(sim), terrain, SEAT);
    expect(next).not.toBe(first);
    expect(next).toHaveLength(2);
  });

  it('gives a loose raider at least his sight as reach, since he advances on what he sees', () => {
    const sim = razedBakerySim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: the fixture map builds no terrain graph');
    spawnAt(sim, FAR_CORNER, SPEARMAN);
    spawnAt(sim, { x: FAR_CORNER.x + 6, y: FAR_CORNER.y }, BOWMAN);
    const reaches = seatRaiders(sim.world, ctxOf(sim), terrain, SEAT).map((r) => r.reach);
    expect(reaches).toEqual([SIGHT_RADIUS_NODES, Math.max(bowReach(sim), SIGHT_RADIUS_NODES)]);
  });

  it("keeps a tower coverage placement out of a manned enemy tower's reach", () => {
    const coverage = buildOrderModule([{ kind: 'towerCoverage', building: 'tower_01' }]);
    const sim = aiSim();
    placeHq(sim);
    // An outlying home outside the HQ's circle arms the coverage entry.
    const home = { x: HQ_X + 31, y: HQ_Y };
    place(sim, HOME_TYPE, home);
    sim.step();
    const open = placementOf(coverage.run(sim.world, ctxOf(sim), SEAT));
    if (open === null) throw new Error('expected a covering tower');
    const archer = mannedFoeTower(sim, { x: home.x, y: home.y - 6 });
    const post = nodeOf(sim, archer);
    const reach = bowReach(sim) + TOWER_RANGE_BONUS_NODES;
    expect(wallDistance(sim, TOWER_TYPE, open, post)).toBeLessThanOrEqual(reach);

    const moved = placementOf(coverage.run(sim.world, ctxOf(sim), SEAT));
    expect(moved?.buildingType).toBe(TOWER_TYPE);
    if (moved === null) throw new Error('expected the tower placed out of reach');
    expect(wallDistance(sim, TOWER_TYPE, moved, post)).toBeGreaterThan(reach);
  });

  /** A store circle two manned towers can cover whole. */
  const SMALL_STORE_RADIUS = 12;

  /** A seat whose one workshop, out east, arms a small store coverage entry until two manned foe towers
   *  north and south of it put every spot of its circle under fire. */
  function besiegedStoreTarget(): Simulation {
    const sim = aiSim();
    placeHq(sim);
    const bakery = { x: HQ_X + 29, y: HQ_Y };
    place(sim, BAKERY_TYPE, bakery);
    sim.step();
    const stores = buildOrderModule([
      { kind: 'storeCoverage', building: 'stock_02', radius: SMALL_STORE_RADIUS },
    ]);
    expect(placementOf(stores.run(sim.world, ctxOf(sim), SEAT))?.buildingType).toBe(STOCK_TOP_TYPE);
    mannedFoeTower(sim, { x: bakery.x, y: bakery.y - 4 });
    mannedFoeTower(sim, { x: bakery.x, y: bakery.y + 4 });
    sim.step();
    expect(placementOf(stores.run(sim.world, ctxOf(sim), SEAT))).toBeNull();
    return sim;
  }

  it("passes a store coverage entry over while its only spots lie in an enemy tower's reach", () => {
    const order = buildOrderModule([
      { kind: 'storeCoverage', building: 'stock_02', radius: SMALL_STORE_RADIUS },
      { kind: 'place', building: 'work_farm_00', count: 1 },
    ]);
    const sim = besiegedStoreTarget();
    // The list goes on to the farm instead of stalling on the warehouse.
    expect(placementOf(order.run(sim.world, ctxOf(sim), SEAT))?.buildingType).toBe(FARM_TYPE);
  });

  it('never counts a passed-over entry as the one the lookahead waits on', () => {
    // The farm's site is the oldest entry waiting on a site; the passed-over store entry before it
    // would put the mill one entry past the lookahead if it counted.
    const order = buildOrderModule([
      { kind: 'storeCoverage', building: 'stock_02', radius: SMALL_STORE_RADIUS },
      { kind: 'place', building: 'work_farm_00', count: 1 },
      { kind: 'place', building: 'home_level_00', count: 1 },
      { kind: 'place', building: 'work_well_00', count: 1 },
      { kind: 'place', building: 'work_mill_00', count: 1 },
    ]);
    const sim = besiegedStoreTarget();
    const act = (): (Spot & { buildingType: number }) | null => {
      const commands = [...order.run(sim.world, ctxOf(sim), SEAT)];
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return placementOf(commands);
    };
    expect(act()?.buildingType).toBe(FARM_TYPE); // its site stays open
    for (const finished of [HOME_TYPE, WELL_TYPE]) {
      expect(act()?.buildingType).toBe(finished);
      const built = entityOfBuilding(sim, finished);
      sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: built });
      sim.step();
    }
    expect(sitePace(0).lookahead).toBe(3);
    expect(act()?.buildingType).toBe(MILL_TYPE);
  });

  it('holds a tower coverage placement while the seat is attacked', () => {
    const coverage = buildOrderModule([{ kind: 'towerCoverage', building: 'tower_01' }]);
    const sim = aiSim();
    placeHq(sim);
    // An outlying home outside the HQ's circle arms the coverage entry.
    place(sim, HOME_TYPE, { x: HQ_X + 31, y: HQ_Y });
    sim.step();
    const band = spawnAt(sim, { x: HQ_X, y: HQ_Y + 4 }, SPEARMAN);
    expect(coverage.run(sim.world, ctxOf(sim), SEAT)).toEqual([]);

    for (const man of band) sim.world.destroy(man);
    expect(placementOf(coverage.run(sim.world, ctxOf(sim), SEAT))?.buildingType).toBe(TOWER_TYPE);
  });
});
