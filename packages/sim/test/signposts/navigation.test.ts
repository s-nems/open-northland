import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  LOCAL_NAV_RADIUS_NODES,
  MoveGoal,
  Owner,
  PlayerOrder,
  Position,
  Resource,
  Settler,
} from '../../src/components/index.js';
import { fx, ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { navigationLimitFor } from '../../src/systems/index.js';
import { CUT_OFF_ANNOUNCE_TICKS } from '../../src/systems/settlers/drives/cut-off.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';
import { makeWoodcutter, placeFellableTree, VIKING } from '../settlers/gatherer-flag/support.js';
import { stampPost } from './support.js';

/**
 * Signpost navigation confinement (`setSignpostNavigation`): a civilian may only work/walk within its
 * LOCAL circle plus a reachable signpost group's circles; scouts and fighters roam globally; the rule
 * defaults OFF so every pre-signpost world (and golden) is untouched. Source basis: observed original
 * guidepost behaviour (the user-specified rule set); radii are named approximations.
 */

const SCOUT = 27;
const SOLDIER = 31; // a fighter trade - exempt from confinement
const HUNTER = 15; // exempt like the scout - bounded by its work flag, never the signpost network
const CARPENTER = 2;
const CIVILIST = 6;
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

/** A long grass strip with confinement switched on. LOCAL radius is 24 nodes = 12 tiles E/W. */
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

  it('ON: a goal beyond the local circle is refused - the settler stays put and is reported lost', () => {
    const sim = confinedSim();
    const u = ownedUnit(sim, 2, 2, 1);
    sim.enqueueSetup({ kind: 'moveUnit', entity: u, x: 4 + 2 * LOCAL_NAV_RADIUS_NODES, y: 4 });
    sim.step();
    expect(ordered(sim, u)).toBe(false);
    expect(sim.events.current()).toContainEqual({ kind: 'settlerGoalUnreachable', entity: u });
    // A goal within the local circle is obeyed, and silently.
    sim.enqueueSetup({ kind: 'moveUnit', entity: u, x: 4 + LOCAL_NAV_RADIUS_NODES, y: 4 });
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

  it('ON: a reachable signpost group extends the walkable area to its circles', () => {
    const sim = confinedSim();
    const u = ownedUnit(sim, 2, 2, 1);
    // Post A at tile 12 (24 nodes east - the local circle's rim) links the settler to the network;
    // post B at tile 26 (28 nodes past A, overlapping at radius 16) carries it further east.
    stampPost(sim, 12, 2, 16);
    stampPost(sim, 26, 2, 16);
    // Tile 32 (node 64) is far beyond the local circle but inside B's circle: allowed.
    sim.enqueueSetup({ kind: 'moveUnit', entity: u, x: 64, y: 4 });
    sim.step();
    expect(ordered(sim, u)).toBe(true);
  });

  it('ON: a disconnected far group does NOT open a corridor', () => {
    const sim = confinedSim(192);
    const u = ownedUnit(sim, 2, 2, 1);
    // A lone far post whose circle covers the goal - but no chain reaches it from the settler.
    stampPost(sim, 60, 2, 16);
    sim.enqueueSetup({ kind: 'moveUnit', entity: u, x: 120, y: 4 });
    sim.step();
    expect(ordered(sim, u)).toBe(false);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const limit = navigationLimitFor(sim.world, sim.content, terrain, u);
    expect(limit).not.toBeNull();
    expect(limit?.allowsNode(terrain.nodeAt(120, 4))).toBe(false);
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
    ownedUnit(sim, 6, 4, 1); // within the local circle of the building: silent
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
    building(sim, 6, 2); // its door sits inside the first post's circle
    const chained = ownedUnit(sim, 34, 4, 1);
    stampPost(sim, 12, 2, 16);
    stampPost(sim, 26, 2, 16); // overlaps the first, and the settler's local circle at tile 34
    const lone = ownedUnit(sim, 60, 4, 1);
    stampPost(sim, 56, 4, 16); // its own circle, linked to nothing
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

    // One tile east is a new half-cell node, so the local circle recentres.
    sim.world.mut(u, Position).x = fx.fromInt(3);
    const moved = navigationLimitFor(sim.world, sim.content, terrain, u);
    expect(moved).not.toBe(first);
    // The shifted rim: two nodes past the OLD east rim is out for the old gate, in for the new one.
    const pastOldRim = terrain.nodeAt(4 + LOCAL_NAV_RADIUS_NODES + 2, 4);
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
    stampPost(sim, 12, 2, 16);
    stampPost(sim, 26, 2, 16);
    const after = navigationLimitFor(sim.world, sim.content, terrain, u);
    expect(after).not.toBe(before);
    const farInPostCircle = terrain.nodeAt(64, 4);
    expect(before?.allowsNode(farInPostCircle)).toBe(false);
    expect(after?.allowsNode(farInPostCircle)).toBe(true);
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
    // A tree 40 tiles east - far beyond the 12-tile local circle.
    const tree = placeFellableTree(sim, 42, 2);
    for (let t = 0; t < 30; t++) sim.step();
    expect(sim.world.has(g, MoveGoal)).toBe(false); // no known way to any work - idles
    expect(sim.world.get(tree, Resource).remaining).toBeGreaterThan(0);

    // A chain of two posts bridges the local circle to the tree's ground.
    stampPost(sim, 12, 2, 24);
    stampPost(sim, 32, 2, 24);
    for (let t = 0; t < 30 && !sim.world.has(g, MoveGoal); t++) sim.step();
    expect(sim.world.has(g, MoveGoal)).toBe(true); // the tree is now a known target
  });
});
