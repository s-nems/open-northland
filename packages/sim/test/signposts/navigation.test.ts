import { describe, expect, it } from 'vitest';
import {
  LOCAL_NAV_RADIUS_NODES,
  MoveGoal,
  Owner,
  PlayerOrder,
  Position,
  Resource,
  Settler,
} from '../../src/components/index.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { navigationLimitFor } from '../../src/systems/index.js';
import { makeWoodcutter, placeFellableTree, VIKING } from '../agents/gatherer-flag/support.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';
import { stampPost } from './support.js';

/**
 * Signpost navigation confinement (`setSignpostNavigation`): a civilian may only work/walk within its
 * LOCAL circle plus a reachable signpost group's circles; scouts and fighters roam globally; the rule
 * defaults OFF so every pre-signpost world (and golden) is untouched. Source basis: observed original
 * guidepost behaviour (the user-specified rule set); radii are named approximations.
 */

const SCOUT = 27;
const SOLDIER = 31; // a fighter-band job — exempt from confinement
const P0 = 0;

function ownedUnit(sim: Simulation, x: number, y: number, jobType: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player: P0 });
  return e;
}

/** A long grass strip with confinement switched on. LOCAL radius is 24 nodes = 12 tiles E/W. */
function confinedSim(w = 128): Simulation {
  const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(w, 8) });
  sim.enqueue({ kind: 'setSignpostNavigation', enabled: true });
  sim.step();
  return sim;
}

function ordered(sim: Simulation, e: Entity): boolean {
  return sim.world.has(e, MoveGoal) || sim.world.has(e, PlayerOrder);
}

describe('setSignpostNavigation + moveUnit — the confinement rule', () => {
  it('defaults OFF: a civilian walks anywhere', () => {
    const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(128, 8) });
    const u = ownedUnit(sim, 2, 2, 1);
    sim.enqueue({ kind: 'moveUnit', entity: u, x: 200, y: 4 });
    sim.step();
    expect(ordered(sim, u)).toBe(true);
  });

  it('ON: a goal beyond the local circle is refused — the settler stays put', () => {
    const sim = confinedSim();
    const u = ownedUnit(sim, 2, 2, 1);
    sim.enqueue({ kind: 'moveUnit', entity: u, x: 4 + 2 * LOCAL_NAV_RADIUS_NODES, y: 4 });
    sim.step();
    expect(ordered(sim, u)).toBe(false);
    // A goal within the local circle is obeyed.
    sim.enqueue({ kind: 'moveUnit', entity: u, x: 4 + LOCAL_NAV_RADIUS_NODES, y: 4 });
    sim.step();
    expect(ordered(sim, u)).toBe(true);
  });

  it('ON: scouts and fighters are exempt', () => {
    const sim = confinedSim();
    const scout = ownedUnit(sim, 2, 2, SCOUT);
    const soldier = ownedUnit(sim, 2, 4, SOLDIER);
    sim.enqueue({ kind: 'moveUnit', entity: scout, x: 220, y: 4 });
    sim.enqueue({ kind: 'moveUnit', entity: soldier, x: 220, y: 8 });
    sim.step();
    expect(ordered(sim, scout)).toBe(true);
    expect(ordered(sim, soldier)).toBe(true);
  });

  it('ON: a reachable signpost group extends the walkable area to its circles', () => {
    const sim = confinedSim();
    const u = ownedUnit(sim, 2, 2, 1);
    // Post A at tile 12 (24 nodes east — the local circle's rim) links the settler to the network;
    // post B at tile 26 (28 nodes past A, overlapping at radius 16) carries it further east.
    stampPost(sim, 12, 2, 16);
    stampPost(sim, 26, 2, 16);
    // Tile 32 (node 64) is far beyond the local circle but inside B's circle: allowed.
    sim.enqueue({ kind: 'moveUnit', entity: u, x: 64, y: 4 });
    sim.step();
    expect(ordered(sim, u)).toBe(true);
  });

  it('ON: a disconnected far group does NOT open a corridor', () => {
    const sim = confinedSim(192);
    const u = ownedUnit(sim, 2, 2, 1);
    // A lone far post whose circle covers the goal — but no chain reaches it from the settler.
    stampPost(sim, 60, 2, 16);
    sim.enqueue({ kind: 'moveUnit', entity: u, x: 120, y: 4 });
    sim.step();
    expect(ordered(sim, u)).toBe(false);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const limit = navigationLimitFor(sim.world, terrain, u);
    expect(limit).not.toBeNull();
    expect(limit?.allowsNode(terrain.nodeAt(120, 4))).toBe(false);
  });
});

describe('confinement gates the gatherer scan', () => {
  it('a woodcutter ignores a tree beyond its area and harvests it once a signpost links it', () => {
    const sim = confinedSim(192);
    sim.enqueue({ kind: 'setNeedsEnabled', enabled: false });
    const g = makeWoodcutter(sim, 2, 2);
    sim.world.add(g, Owner, { player: P0 });
    // A tree 40 tiles east — far beyond the 12-tile local circle.
    const tree = placeFellableTree(sim, 42, 2);
    for (let t = 0; t < 30; t++) sim.step();
    expect(sim.world.has(g, MoveGoal)).toBe(false); // no known way to any work — idles
    expect(sim.world.get(tree, Resource).remaining).toBeGreaterThan(0);

    // A chain of two posts bridges the local circle to the tree's ground.
    stampPost(sim, 12, 2, 24);
    stampPost(sim, 32, 2, 24);
    for (let t = 0; t < 30 && !sim.world.has(g, MoveGoal); t++) sim.step();
    expect(sim.world.has(g, MoveGoal)).toBe(true); // the tree is now a known target
  });
});
