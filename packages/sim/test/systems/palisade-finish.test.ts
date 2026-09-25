import { describe, expect, it } from 'vitest';
import {
  DeliveryFlag,
  MoveGoal,
  Palisade,
  PalisadeBlocking,
  Position,
  SiteAssignment,
  Stockpile,
  setStockAmount,
  UnderConstruction,
  WorkFlag,
} from '../../src/components/index.js';
import {
  type Entity,
  nodeOfPosition,
  positionOfNode,
  type ScriptLandscapeType,
  Simulation,
} from '../../src/index.js';
import type { TerrainGraph } from '../../src/nav/terrain/index.js';
import { advanceConstructionLabor, constructionSystem } from '../../src/systems/economy/construction.js';
import { dynamicBlockOverlay } from '../../src/systems/footprint/index.js';
import { moveUnit } from '../../src/systems/orders/index.js';
import { claimPalisade } from '../../src/systems/palisades/reservation.js';
import { fighterAt } from '../conflict/melee-engagement/support.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const VIKING = 1;
const WOODCUTTER = 1;
const OWNER = 0;
const WOOD = 5;
const WIDTH = 24;
const HEIGHT = 20;

const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [{ dx: 0, dy: 0 }],
  groups: [],
  wall: {
    maxHitpoints: 100,
    repairPerStrike: 3,
    construction: [{ goodType: WOOD, amount: 1 }],
  },
};

/** A line splitting north from south that steps down a half-row between columns 11 and 12, so the joint
 *  (11,9)-(12,10) takes its seal on (12,9). */
const WEST_ROW = 9;
const EAST_ROW = 10;
const STEP_HX = 12;
const SEAL = { hx: STEP_HX, hy: WEST_ROW };
const SITE = { hx: STEP_HX, hy: EAST_ROW };

function lineRow(hx: number): number {
  return hx < STEP_HX ? WEST_ROW : EAST_ROW;
}

function fresh(): { sim: Simulation; terrain: TerrainGraph } {
  const base = grassNodeMap(WIDTH, HEIGHT);
  const sim = new Simulation({
    seed: 1,
    content: testContent(),
    map: { ...base, landscapes: { types: [WALL], placements: [] } },
  });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('expected a mapped simulation');
  return { sim, terrain };
}

function placeWall(sim: Simulation, hx: number, hy: number, underConstruction = false): void {
  sim.enqueueSetup({
    kind: 'placePalisade',
    gfxIndex: WALL.typeId,
    x: hx,
    y: hy,
    tribe: VIKING,
    owner: OWNER,
    ...(underConstruction ? { underConstruction: true } : {}),
  });
}

function siteAt(sim: Simulation, hx: number, hy: number): Entity {
  const centre = positionOfNode(hx, hy);
  for (const e of sim.world.query(Palisade, UnderConstruction, Position)) {
    const p = sim.world.get(e, Position);
    if (p.x === centre.x && p.y === centre.y) return e;
  }
  throw new Error(`expected a wall site at ${hx},${hy}`);
}

/** Deliver the site's wood and land its one strike from a claim holder. */
function hammer(sim: Simulation, site: Entity): void {
  setStockAmount(sim.world, site, WOOD, 1);
  const builder = sim.world.create();
  sim.world.add(builder, SiteAssignment, { site, pinned: false });
  claimPalisade(sim.world, site, builder);
  expect(advanceConstructionLabor(sim.world, ctxOf(sim), site, builder)).toBe(true);
}

function nodeOf(sim: Simulation, e: Entity): { hx: number; hy: number } {
  const p = sim.world.get(e, Position);
  return nodeOfPosition(p.x, p.y);
}

function standing(sim: Simulation, hx: number, hy: number): Entity {
  const e = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: OWNER });
  sim.world.add(e, Position, positionOfNode(hx, hy));
  return e;
}

describe('a wall site that rises', () => {
  it('pushes a settler off the joint seal it makes, so the finished line holds it', () => {
    const { sim, terrain } = fresh();
    for (let hx = 0; hx < WIDTH; hx++) placeWall(sim, hx, lineRow(hx), hx === SITE.hx);
    sim.step();
    const site = siteAt(sim, SITE.hx, SITE.hy);
    const fighter = standing(sim, SEAL.hx, SEAL.hy);

    hammer(sim, site);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(site, PalisadeBlocking)).toBe(true);
    const blocked = dynamicBlockOverlay(sim.world, ctxOf(sim), terrain);
    expect(blocked.has(terrain.nodeAt(SEAL.hx, SEAL.hy))).toBe(true);
    const landed = nodeOf(sim, fighter);
    expect(blocked.has(terrain.nodeAt(landed.hx, landed.hy))).toBe(false);

    const north = landed.hy < lineRow(landed.hx);
    const goal = north ? { hx: STEP_HX - 1, hy: HEIGHT - 4 } : { hx: STEP_HX - 1, hy: 2 };
    moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', entity: fighter, x: goal.hx, y: goal.hy });
    for (let tick = 0; tick < 300; tick++) {
      sim.step();
      const here = nodeOf(sim, fighter);
      expect(here.hy < lineRow(here.hx), `tick ${tick}`).toBe(north);
    }
  });

  it('pushes an idle occupant off its body and stands', () => {
    const { sim, terrain } = fresh();
    placeWall(sim, 6, 6, true);
    sim.step();
    const site = siteAt(sim, 6, 6);
    const idler = standing(sim, 6, 6);

    hammer(sim, site);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(site, PalisadeBlocking)).toBe(true);
    const landed = nodeOf(sim, idler);
    expect(
      dynamicBlockOverlay(sim.world, ctxOf(sim), terrain).has(terrain.nodeAt(landed.hx, landed.hy)),
    ).toBe(false);
  });

  it('moves the loose goods and the work flag it would bury', () => {
    const { sim, terrain } = fresh();
    const gatherer = standing(sim, 2, 2);
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: gatherer, x: 6, y: 6 });
    sim.enqueueSetup({ kind: 'dropGood', good: WOOD, x: 6, y: 6, amount: 2 });
    sim.step();
    const flag = sim.world.get(gatherer, WorkFlag).flag;
    expect(nodeOf(sim, flag)).toEqual({ hx: 6, hy: 6 });
    placeWall(sim, 6, 6, true);
    sim.step();
    const site = siteAt(sim, 6, 6);

    hammer(sim, site);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(site, PalisadeBlocking)).toBe(true);
    const blocked = dynamicBlockOverlay(sim.world, ctxOf(sim), terrain);
    const piles = [...sim.world.query(Stockpile, Position)].filter(
      (e) => !sim.world.has(e, Palisade) && (sim.world.get(e, Stockpile).amounts.get(WOOD) ?? 0) > 0,
    );
    expect(piles).toHaveLength(1);
    expect(sim.world.has(flag, DeliveryFlag)).toBe(true);
    for (const e of [...piles, flag]) {
      const at = nodeOf(sim, e);
      expect(blocked.has(terrain.nodeAt(at.hx, at.hy)), `entity ${e}`).toBe(false);
    }
  });

  it('waits out a traveller crossing its cells, then stands', () => {
    const { sim, terrain } = fresh();
    placeWall(sim, 6, 6, true);
    sim.step();
    const site = siteAt(sim, 6, 6);
    const walker = standing(sim, 6, 6);
    sim.world.add(walker, MoveGoal, { cell: terrain.nodeAt(2, 2) });

    hammer(sim, site);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(site, UnderConstruction)).toBe(true);
    expect(nodeOf(sim, walker)).toEqual({ hx: 6, hy: 6 });

    sim.world.remove(walker, MoveGoal);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(site, UnderConstruction)).toBe(false);
  });
});
