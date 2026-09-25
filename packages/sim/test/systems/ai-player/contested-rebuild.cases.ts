import { describe, expect, it } from 'vitest';
import { AttackOrder, DefenceMode, Position, Settler } from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { positionOfNode, Simulation, type TerrainMap } from '../../../src/index.js';
import {
  type BuildOrderEntry,
  buildOrderModule,
  REBUILD_DELAY_TICKS,
  THREAT_STAND_DOWN_MARGIN_NODES,
  threatWatchNodes,
} from '../../../src/systems/ai-player/index.js';
import { standsAtPost } from '../../../src/systems/conflict/tower-post.js';
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
  HOME_TYPE,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  MILL_TYPE,
  makeAiSeat,
  placeHq,
  SEAT,
  TOWER_TYPE,
  VIKING,
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

  it('does not hold for an enemy archer holding his own tower', () => {
    const sim = razedBakerySim();
    place(sim, TOWER_TYPE, FAR_BANK, FOE);
    sim.step();
    const tower = entityOfBuilding(sim, TOWER_TYPE);
    const archer = onlyOne(spawnAt(sim, { x: FAR_BANK.x + 4, y: FAR_BANK.y }, BOWMAN));
    sim.enqueueSetup({ kind: 'assignWorker', entity: archer, building: tower, jobPriority: [BOWMAN] });
    for (let i = 0; i < WALK_IN_TICKS; i++) sim.step();
    expect(standsAtPost(sim.world, archer)).toBe(tower);
    expect(placementOf(decide(sim))?.buildingType).toBe(BAKERY_TYPE);
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
