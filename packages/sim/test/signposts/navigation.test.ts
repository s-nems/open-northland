import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  CARRIER_WALK_RANGE_NODES,
  MoveGoal,
  Owner,
  PlayerOrder,
  Position,
  Resource,
  Settler,
  WALK_RANGE_NODES,
} from '../../src/components/index.js';
import { fx, ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { navigationLimitFor } from '../../src/systems/index.js';
import { CUT_OFF_ANNOUNCE_TICKS } from '../../src/systems/settlers/drives/cut-off.js';
import { TEST_MANIFEST, testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap, waterColumnMap } from '../fixtures/terrain.js';
import { makeWoodcutter, placeFellableTree, VIKING } from '../settlers/gatherer-flag/support.js';
import { stampPost } from './support.js';

/**
 * Signpost navigation confinement (`setSignpostNavigation`): a civilian may only work/walk within its
 * walk range of where it stands, plus that range around every post of a signpost group it catches;
 * scouts and fighters roam globally; the rule defaults OFF so every pre-signpost world (and golden) is
 * untouched. Source basis: the original's guided pathfinder, ranges byte-verified in the owned exe.
 * Distances below are hex node distances: two nodes per tile E/W.
 */

const SCOUT = 27;
const SOLDIER = 31; // a fighter trade - exempt from confinement
const HUNTER = 15; // exempt like the scout - bounded by its work flag, never the signpost network
const CARPENTER = 2;
const CIVILIST = 6;
const CARRIER = 24;
const P0 = 0;

function ownedUnit(sim: Simulation, x: number, y: number, jobType: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
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

/** A long grass strip with confinement switched on. The walk range is 50 nodes = 25 tiles E/W. */
function confinedSim(w = 128): Simulation {
  const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(w, 8) });
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  sim.step();
  return sim;
}

function ordered(sim: Simulation, e: Entity): boolean {
  return sim.world.has(e, MoveGoal) || sim.world.has(e, PlayerOrder);
}

describe('setSignpostNavigation + moveUnit - the confinement rule', () => {
  it('defaults OFF: a civilian walks anywhere', () => {
    const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(128, 8) });
    const u = ownedUnit(sim, 2, 2, 1);
    sim.enqueueSetup({ kind: 'moveUnit', entity: u, x: 200, y: 4 });
    sim.step();
    expect(ordered(sim, u)).toBe(true);
  });

  it('ON: a goal beyond the walk range is refused - the settler stays put and is reported lost', () => {
    const sim = confinedSim();
    const u = ownedUnit(sim, 2, 2, 1);
    sim.enqueueSetup({ kind: 'moveUnit', entity: u, x: 4 + 2 * WALK_RANGE_NODES, y: 4 });
    sim.step();
    expect(ordered(sim, u)).toBe(false);
    expect(sim.events.current()).toContainEqual({ kind: 'settlerGoalUnreachable', entity: u });
    // A goal exactly the range away is obeyed, and silently.
    sim.enqueueSetup({ kind: 'moveUnit', entity: u, x: 4 + WALK_RANGE_NODES, y: 4 });
    sim.step();
    expect(ordered(sim, u)).toBe(true);
    expect(sim.events.current()).not.toContainEqual({ kind: 'settlerGoalUnreachable', entity: u });
  });

  it('ON: scouts, fighters and hunters are exempt', () => {
    const sim = confinedSim();
    const scout = ownedUnit(sim, 2, 2, SCOUT);
    const soldier = ownedUnit(sim, 2, 4, SOLDIER);
    const hunter = ownedUnit(sim, 2, 6, HUNTER);
    sim.enqueueSetup({ kind: 'moveUnit', entity: scout, x: 220, y: 4 });
    sim.enqueueSetup({ kind: 'moveUnit', entity: soldier, x: 220, y: 8 });
    sim.enqueueSetup({ kind: 'moveUnit', entity: hunter, x: 220, y: 12 });
    sim.step();
    expect(ordered(sim, scout)).toBe(true);
    expect(ordered(sim, soldier)).toBe(true);
    // The hunter never gets lost, like the scout (design rule, user-specified) - its range is bounded
    // by its own work flag instead of the signpost network.
    expect(ordered(sim, hunter)).toBe(true);
  });

  it('ON: a caught signpost group extends the walkable area to the range around each post', () => {
    const sim = confinedSim();
    const u = ownedUnit(sim, 2, 2, 1);
    // Post A at tile 12 (20 nodes east, inside the walk range) catches the settler; post B at tile 30
    // (36 nodes past A, inside the link range) carries it further east.
    stampPost(sim, 12, 2);
    stampPost(sim, 30, 2);
    // Node 104 is 100 nodes from the settler but 44 from B: allowed.
    sim.enqueueSetup({ kind: 'moveUnit', entity: u, x: 104, y: 4 });
    sim.step();
    expect(ordered(sim, u)).toBe(true);
  });

  it('ON: a post beyond the walk range is not caught, however close the goal is to it', () => {
    const sim = confinedSim(192);
    const u = ownedUnit(sim, 2, 2, 1);
    // A lone post 116 nodes from the settler, 20 from the goal.
    stampPost(sim, 60, 2);
    sim.enqueueSetup({ kind: 'moveUnit', entity: u, x: 140, y: 4 });
    sim.step();
    expect(ordered(sim, u)).toBe(false);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const limit = navigationLimitFor(sim.world, sim.content, terrain, u);
    expect(limit).not.toBeNull();
    expect(limit?.allowsNode(terrain.nodeAt(140, 4))).toBe(false);
  });

  it('ON: the druid roams like the scout, read off its content role', () => {
    const DRUID = 30;
    const content = parseContentSet({
      manifest: TEST_MANIFEST,
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [
        { typeId: 0, id: 'idle' },
        { typeId: 1, id: 'farmer' },
        { typeId: DRUID, id: 'druid' },
      ],
      buildings: [],
      landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    });
    const sim = new Simulation({ seed: 5, content, map: grassMap(128, 8) });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const farmer = ownedUnit(sim, 2, 2, 1);
    const druid = ownedUnit(sim, 2, 4, DRUID);
    sim.enqueueSetup({ kind: 'moveUnit', entity: farmer, x: 220, y: 4 });
    sim.enqueueSetup({ kind: 'moveUnit', entity: druid, x: 220, y: 8 });
    sim.step();
    expect(ordered(sim, farmer)).toBe(false);
    expect(ordered(sim, druid)).toBe(true);
  });

  it('ON: a carrier plans a longer leg than any other trade', () => {
    const sim = confinedSim();
    const farmer = ownedUnit(sim, 2, 2, 1);
    const carrier = ownedUnit(sim, 2, 4, CARRIER);
    // 56 nodes east: past the 50-node range, inside the carrier's 63.
    const goal = 4 + WALK_RANGE_NODES + 6;
    expect(goal).toBeLessThan(4 + CARRIER_WALK_RANGE_NODES);
    sim.enqueueSetup({ kind: 'moveUnit', entity: farmer, x: goal, y: 4 });
    sim.enqueueSetup({ kind: 'moveUnit', entity: carrier, x: goal, y: 8 });
    sim.step();
    expect(ordered(sim, farmer)).toBe(false);
    expect(ordered(sim, carrier)).toBe(true);
  });

  it('ON: a post is caught only strictly inside the range, though a goal may sit exactly on it', () => {
    const sim = confinedSim();
    const u = ownedUnit(sim, 2, 2, 1);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    // The settler stands on node (4, 4); a post 50 nodes east opens nothing, one at 49 opens its range.
    stampPost(sim, 2 + WALK_RANGE_NODES / 2, 2);
    const beyond = terrain.nodeAt(4 + WALK_RANGE_NODES + 20, 4);
    expect(navigationLimitFor(sim.world, sim.content, terrain, u)?.allowsNode(beyond)).toBe(false);
    sim.world.mut(u, Position).x = fx.add(sim.world.get(u, Position).x, fx.div(ONE, fx.fromInt(2)));
    expect(navigationLimitFor(sim.world, sim.content, terrain, u)?.allowsNode(beyond)).toBe(true);
  });

  it('ON: a post across water is not caught, though inside the range', () => {
    const sim = new Simulation({ seed: 5, content: testContent(), map: waterColumnMap(64, 8, 10) });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const u = ownedUnit(sim, 2, 2, 1);
    stampPost(sim, 14, 2); // 24 nodes east, on the far bank
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const limit = navigationLimitFor(sim.world, sim.content, terrain, u);
    // Node 70 lies 42 from the post, inside its range, but 66 from the settler.
    expect(limit?.allowsNode(terrain.nodeAt(70, 4))).toBe(false);
  });
});

describe('the cut-off note', () => {
  function building(sim: Simulation, x: number, y: number, player: number | null = P0): void {
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
    sim.world.add(e, Building, { buildingType: 1, tribe: VIKING, built: ONE, level: 0 });
    if (player !== null) sim.world.add(e, Owner, { player });
  }

  /** Runs through one announce cadence and lists who it announced as cut off. */
  function cutOffWithinOneCadence(sim: Simulation): Entity[] {
    const seen: Entity[] = [];
    for (let i = 0; i < CUT_OFF_ANNOUNCE_TICKS; i++) {
      sim.step();
      for (const ev of sim.events.current()) if (ev.kind === 'settlerCutOff') seen.push(ev.entity);
    }
    return seen;
  }

  it('an idle civilian with no signpost and no own building in reach is announced, on the cadence', () => {
    const sim = confinedSim();
    building(sim, 2, 2);
    const stranded = ownedUnit(sim, 60, 4, 1);
    ownedUnit(sim, 6, 4, 1); // within its walk range of the building: silent
    expect(cutOffWithinOneCadence(sim)).toEqual([stranded]);
    expect(cutOffWithinOneCadence(sim)).toEqual([stranded]); // repeats while it stays stranded
  });

  it("another seat's or an unowned building nearby does not count as home", () => {
    const sim = confinedSim();
    building(sim, 2, 2);
    const stranded = ownedUnit(sim, 60, 4, 1);
    building(sim, 62, 2, 1);
    building(sim, 58, 2, null);
    expect(cutOffWithinOneCadence(sim)).toEqual([stranded]);
  });

  it('a signpost chain back to a door of its seat keeps the note away; a lone post does not', () => {
    const sim = confinedSim();
    building(sim, 6, 2); // its door sits inside the first post's range
    const chained = ownedUnit(sim, 50, 4, 1);
    stampPost(sim, 12, 2);
    stampPost(sim, 30, 2); // links the first, and the settler at tile 50 catches it
    const lone = ownedUnit(sim, 100, 4, 1);
    stampPost(sim, 96, 4); // caught, but linked to nothing
    expect(cutOffWithinOneCadence(sim)).toEqual([lone]);
    expect(sim.world.has(chained, Settler)).toBe(true);
  });

  it('an exempt trade and a trade with no work to walk for are never announced', () => {
    const sim = confinedSim();
    building(sim, 2, 2);
    ownedUnit(sim, 100, 4, SCOUT);
    ownedUnit(sim, 60, 4, CIVILIST);
    ownedUnit(sim, 62, 4, CARPENTER); // a workshop trade with no workshop walks nowhere
    expect(cutOffWithinOneCadence(sim)).toEqual([]);
  });

  it('a seat without a building has no settlement to be cut off from', () => {
    const sim = confinedSim();
    ownedUnit(sim, 60, 4, 1);
    expect(cutOffWithinOneCadence(sim)).toEqual([]);
  });
});

describe('navigationLimitFor, the per-settler memo', () => {
  it('re-serves one limit object while inputs hold; a node crossing or job change recomputes', () => {
    const sim = confinedSim();
    const u = ownedUnit(sim, 2, 2, 1);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const first = navigationLimitFor(sim.world, sim.content, terrain, u);
    expect(first).not.toBeNull();
    // Identity, not equality: the memo must hand back the SAME gate, not an equivalent re-derivation.
    expect(navigationLimitFor(sim.world, sim.content, terrain, u)).toBe(first);

    // One tile east is a new half-cell node, so the range recentres.
    sim.world.mut(u, Position).x = fx.fromInt(3);
    const moved = navigationLimitFor(sim.world, sim.content, terrain, u);
    expect(moved).not.toBe(first);
    // The shifted rim: two nodes past the OLD east rim is out for the old gate, in for the new one.
    const pastOldRim = terrain.nodeAt(4 + WALK_RANGE_NODES + 2, 4);
    expect(first?.allowsNode(pastOldRim)).toBe(false);
    expect(moved?.allowsNode(pastOldRim)).toBe(true);

    // A trade change to a fighter lifts the confinement: jobType is part of the memo key.
    const uState = sim.world.get(u, Settler);
    addPerson(sim.world, u, {
      ...uState,
      learned: { job: [...(uState.learned?.job ?? [])], good: [...(uState.learned?.good ?? [])] },
      experience: new Map(uState.experience),
      jobType: SOLDIER,
    });
    expect(navigationLimitFor(sim.world, sim.content, terrain, u)).toBeNull();
  });

  it('an erected signpost invalidates held limits through the Signpost store generation', () => {
    const sim = confinedSim();
    const u = ownedUnit(sim, 2, 2, 1);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const before = navigationLimitFor(sim.world, sim.content, terrain, u);
    stampPost(sim, 12, 2);
    stampPost(sim, 30, 2);
    const after = navigationLimitFor(sim.world, sim.content, terrain, u);
    expect(after).not.toBe(before);
    const farInPostRange = terrain.nodeAt(104, 4);
    expect(before?.allowsNode(farInPostRange)).toBe(false);
    expect(after?.allowsNode(farInPostRange)).toBe(true);
  });

  it('toggling the rule off is honoured immediately: the flag is read live, never memoized', () => {
    const sim = confinedSim();
    const u = ownedUnit(sim, 2, 2, 1);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const first = navigationLimitFor(sim.world, sim.content, terrain, u);
    expect(first).not.toBeNull();
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: false });
    sim.step();
    expect(navigationLimitFor(sim.world, sim.content, terrain, u)).toBeNull();
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    // Re-enabling serves the held entry again: the toggle never invalidates, it only gates.
    expect(navigationLimitFor(sim.world, sim.content, terrain, u)).toBe(first);
  });
});

describe('confinement gates the gatherer scan', () => {
  it('a woodcutter ignores a tree beyond its area and harvests it once a signpost links it', () => {
    const sim = confinedSim(192);
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    const g = makeWoodcutter(sim, 2, 2);
    sim.world.add(g, Owner, { player: P0 });
    // A tree 40 tiles east - far beyond the 25-tile walk range.
    const tree = placeFellableTree(sim, 42, 2);
    for (let t = 0; t < 30; t++) sim.step();
    expect(sim.world.has(g, MoveGoal)).toBe(false); // no known way to any work - idles
    expect(sim.world.get(tree, Resource).remaining).toBeGreaterThan(0);

    // A chain of two posts bridges the walk range to the tree's ground.
    stampPost(sim, 12, 2);
    stampPost(sim, 30, 2);
    for (let t = 0; t < 30 && !sim.world.has(g, MoveGoal); t++) sim.step();
    expect(sim.world.has(g, MoveGoal)).toBe(true); // the tree is now a known target
  });
});
