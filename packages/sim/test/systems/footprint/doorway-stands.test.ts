import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Female,
  MoveGoal,
  Owner,
  Position,
  Residence,
} from '../../../src/components/index.js';
import { fx, ONE } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { nodeOfPosition, positionOfNode } from '../../../src/nav/halfcell.js';
import type { NodeId } from '../../../src/nav/terrain/index.js';
import { buildingBlockedCells, buildingDoorwayNodes } from '../../../src/systems/footprint/index.js';
import { spawnLanding } from '../../../src/systems/movement/evict.js';
import { nearestFreeCell, stepOffHomeDoor } from '../../../src/systems/settlers/drives/spacing.js';
import { PlannerSpacing } from '../../../src/systems/settlers/planner/spacing.js';
import { interactionCell } from '../../../src/systems/settlers/targets/index.js';
import { TEST_MANIFEST } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

// Two homes whose door sits in a pocket of their own walls. The sealed one blocks every lattice edge out
// of the door, so the walk block carves a passage through a wall cell: ground under the house's art a
// settler may walk, never stand on. The gapped one, the frank home's shape, leaves the south-west edge
// open, the one way out the original's door has, so nothing is carved and the door alone is a doorway.

const VIKING = 1;
const PLAYER = 0;
const WOMAN = 5;
const SEALED_HOME = 2;
const GAPPED_HOME = 3;
const GRASS = 0;
const MAP_W = 24;
const MAP_H = 16;
/** An even row, so the door's SW edge lands on `(dx - 1, dy + 1)`. */
const ANCHOR = { hx: 10, hy: 6 } as const;
const DOOR = { dx: 0, dy: 2 } as const;

/** Rows above the door, the two wall cells beside it, and the row closing it from below. */
const SEALED_WALLS = [
  ...[-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 1 })),
  { dx: -1, dy: 2 },
  { dx: 1, dy: 2 },
  ...[-1, 0, 1].map((dx) => ({ dx, dy: 3 })),
];
/** The same pocket with the cell south-west of the door open, the SW edge's landing. */
const GAPPED_WALLS = SEALED_WALLS.filter((cell) => !(cell.dx === -1 && cell.dy === 3));

function content(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOMAN, id: 'woman' },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      {
        typeId: SEALED_HOME,
        id: 'home_level_00',
        kind: 'home',
        homeSize: 1,
        footprint: { blocked: SEALED_WALLS, door: DOOR },
      },
      {
        typeId: GAPPED_HOME,
        id: 'home_level_01',
        kind: 'home',
        homeSize: 1,
        footprint: { blocked: GAPPED_WALLS, door: DOOR },
      },
    ],
  });
}

interface Fixture {
  readonly sim: Simulation;
  readonly woman: Entity;
  readonly door: NodeId;
  readonly spacing: PlannerSpacing;
  readonly doorways: ReadonlySet<NodeId>;
}

function mappedSim(): Simulation {
  return new Simulation({ seed: 1, content: content(), map: grassNodeMap(MAP_W, MAP_H) });
}

/** An owned woman standing on `node`. */
function womanAt(sim: Simulation, node: NodeId): Entity {
  const terrain = terrainOf(sim);
  const woman = sim.world.create();
  sim.world.add(woman, Position, positionOfNode(terrain.xOf(node), terrain.yOf(node)));
  addPerson(sim.world, woman, {
    tribe: VIKING,
    jobType: WOMAN,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(woman, Owner, { player: PLAYER });
  sim.world.add(woman, Female, { female: true });
  return woman;
}

function nodeOfEntity(sim: Simulation, e: Entity): NodeId {
  const p = sim.world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return terrainOf(sim).nodeAt(n.hx, n.hy);
}

/** One `buildingType` home with its resident standing on the door node. */
function fixture(buildingType: number): Fixture {
  const sim = mappedSim();
  const terrain = terrainOf(sim);
  const house = sim.world.create();
  sim.world.add(house, Position, positionOfNode(ANCHOR.hx, ANCHOR.hy));
  sim.world.add(house, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  const ctx = ctxOf(sim);
  const door = interactionCell(sim.world, ctx, terrain, house, terrain.nodeAt(ANCHOR.hx, ANCHOR.hy));
  const woman = womanAt(sim, door);
  sim.world.add(woman, Residence, { home: house, since: 0 });
  const spacing = PlannerSpacing.forTick(sim.world, ctx, terrain);
  return { sim, woman, door, spacing, doorways: buildingDoorwayNodes(sim.world, ctx, terrain) };
}

function terrainOf(sim: Simulation) {
  if (sim.terrain === undefined) throw new Error('setup: terrain missing');
  return sim.terrain;
}

describe('doorway stands', () => {
  it('carves a passage through the sealed pocket and lists it with the door as doorways', () => {
    const { sim, door, doorways } = fixture(SEALED_HOME);
    expect(doorways.has(door)).toBe(true);
    expect(doorways.size).toBeGreaterThan(1);
    const blocked = buildingBlockedCells(sim.world, ctxOf(sim), terrainOf(sim));
    for (const cell of doorways) expect(blocked.has(cell)).toBe(false);
  });

  it('carves nothing for the gapped pocket, whose door leaves by its south-west edge', () => {
    const { sim, door, doorways } = fixture(GAPPED_HOME);
    const terrain = terrainOf(sim);
    expect([...doorways]).toEqual([door]);
    const blocked = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    const landing = terrain.nodeAt(terrain.xOf(door) - 1, terrain.yOf(door) + 1);
    expect(blocked.has(landing)).toBe(false);
    expect(terrain.steps(door, blocked).map((step) => step.node)).toContain(landing);
  });

  it.each([
    ['sealed', SEALED_HOME],
    ['gapped', GAPPED_HOME],
  ])('steps a resident off the %s home door to a stand outside the doorway', (_label, type) => {
    const { sim, woman, door, spacing, doorways } = fixture(type);
    expect(stepOffHomeDoor(sim.world, ctxOf(sim), terrainOf(sim), woman, door, spacing)).toBe(true);
    const stand = sim.world.get(woman, MoveGoal).cell;
    expect(doorways.has(stand)).toBe(false);
    expect(spacing.blockedCells().has(stand)).toBe(false);
  });

  it.each([
    ['sealed', SEALED_HOME],
    ['gapped', GAPPED_HOME],
  ])('never offers a doorway cell of the %s home as the nearest free stand', (_label, type) => {
    const { sim, door, spacing, doorways } = fixture(type);
    const stand = nearestFreeCell(terrainOf(sim), door, spacing);
    expect(stand).not.toBeNull();
    if (stand !== null) expect(doorways.has(stand)).toBe(false);
  });

  it.each([
    ['sealed', SEALED_HOME],
    ['gapped', GAPPED_HOME],
  ])('lands a settler spawned in the %s home doorway off it', (_label, type) => {
    const { sim, door, doorways } = fixture(type);
    const terrain = terrainOf(sim);
    for (const spawn of doorways) {
      const landing = spawnLanding(sim.world, ctxOf(sim), terrain, spawn, 'land');
      expect(landing, `spawn on ${spawn === door ? 'the door' : 'the passage'}`).not.toBeNull();
      if (landing !== null) expect(doorways.has(landing)).toBe(false);
    }
  });

  it('moves a settler standing on the sealed home passage off it when the home is placed', () => {
    const type = SEALED_HOME;
    const { door, doorways } = fixture(type);
    const passage = [...doorways].find((n) => n !== door);
    if (passage === undefined) throw new Error('setup: no carved passage');
    const sim = mappedSim();
    const stray = womanAt(sim, passage);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: type,
      x: ANCHOR.hx,
      y: ANCHOR.hy,
      tribe: VIKING,
    });
    sim.step();
    expect([...sim.world.query(Building)]).toHaveLength(1);
    const ctx = ctxOf(sim);
    const at = nodeOfEntity(sim, stray);
    expect(buildingDoorwayNodes(sim.world, ctx, terrainOf(sim)).has(at)).toBe(false);
    expect(buildingBlockedCells(sim.world, ctx, terrainOf(sim)).has(at)).toBe(false);
  });
});
