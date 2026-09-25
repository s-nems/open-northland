import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  Engagement,
  Health,
  MoveGoal,
  Owner,
  PathRequest,
  Position,
  Resource,
  Stance,
  UnreachableTargets,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  findPath,
  fx,
  type NodeId,
  nodeOfPosition,
  ONE,
  positionOfNode,
  Simulation,
  type TerrainGraph,
} from '../../../src/index.js';
import { REPATH_CADENCE, SEALED_TARGET_ROUTE_FAILURES } from '../../../src/systems/conflict/chase.js';
import {
  noteUnreachableTarget,
  UNREACHABLE_TARGET_MEMO_TICKS,
} from '../../../src/systems/conflict/unreachable-targets.js';
import { dynamicBlockOverlay } from '../../../src/systems/footprint/index.js';
import {
  anchorOnlyFootprint,
  combatSystem,
  type SystemContext,
  stampResourceFootprintData,
} from '../../../src/systems/index.js';
import { MILITARY_MODE, type MilitaryMode } from '../../../src/systems/readviews/index.js';
import { testContent } from '../../fixtures/content.js';
import { addSettlerOfTribe } from '../../fixtures/settler.js';
import { ctxOf, fighterAt, grassMap, HARVEST_ATOMIC, P0, P1, VIKING, WOOD, WOODCUTTER } from './support.js';

// A chase whose target the walk-block overlay seals off inside the chaser's own static walk component, so only
// routing can refuse it: an enemy ringed by buildings, which never shift, or by standing bodies, which do.

const WALL = 90; // appended: a plain, low-priority building blocking one node
const SOLDIER = 31; // `soldier_unarmed`: a collider, so standing bodies block its routes and it blocks theirs
const MACE = 12; // appended: the soldier's melee weapon, a strict one-node band

/** The shared fixture plus the wall post and the soldier's mace. */
function siegeContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: WALL,
        id: 'wall_post',
        kind: 'home',
        hitpoints: 1000,
        footprint: { blocked: [{ dx: 0, dy: 0 }] },
      },
    ],
    weapons: [
      ...base.weapons,
      {
        typeId: MACE,
        id: 'test_mace',
        tribeType: VIKING,
        jobType: SOLDIER,
        minRange: 1,
        maxRange: 1,
        damage: { '0': 50 },
      },
    ],
  });
}

/** Chebyshev radius of a ring in half-cell nodes: the 5×5 ring leaves a 3×3 pocket holding every cell of the
 *  axe's [1, 2] and the mace's [1, 1] band that is not itself part of the ring. */
const RING_RADIUS = 2;

function ringAround(hx: number, hy: number): Array<{ hx: number; hy: number }> {
  const ring: Array<{ hx: number; hy: number }> = [];
  for (let dy = -RING_RADIUS; dy <= RING_RADIUS; dy++) {
    for (let dx = -RING_RADIUS; dx <= RING_RADIUS; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === RING_RADIUS) ring.push({ hx: hx + dx, hy: hy + dy });
    }
  }
  return ring;
}

/** A wall post on every ring node around (hx, hy). Routing is 4-connected, so the ring seals the pocket; an
 *  ownerless post is never a target itself, an owned one is a plain enemy building. */
function wallIn(sim: Simulation, hx: number, hy: number, owner?: number): Entity[] {
  return ringAround(hx, hy).map((node) => {
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(node.hx, node.hy));
    sim.world.add(e, Building, { buildingType: WALL, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(e, Health, { hitpoints: 1000, max: 1000 });
    if (owner !== undefined) sim.world.add(e, Owner, { player: owner });
    return e;
  });
}

/** An owned fighter standing exactly on node (hx, hy). */
function fighterOnNode(
  sim: Simulation,
  hx: number,
  hy: number,
  jobType: number,
  owner: number,
  mode: MilitaryMode,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  addSettlerOfTribe(sim, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Health, { hitpoints: 1000, max: 1000 });
  sim.world.add(e, Owner, { player: owner });
  sim.world.add(e, Stance, { mode, anchorCell: null });
  return e;
}

/** Allied soldiers standing on every ring node around (hx, hy): bodies that block their own side's routes. */
function crowdIn(sim: Simulation, hx: number, hy: number): Entity[] {
  return ringAround(hx, hy).map((node) =>
    fighterOnNode(sim, node.hx, node.hy, SOLDIER, P0, MILITARY_MODE.IGNORE),
  );
}

const BESIEGER_CELL = { x: 2, y: 4 };
const ENEMY_CELL = { x: 8, y: 4 }; // 12 nodes off on an even row, inside SIGHT_RADIUS_NODES

/** `ctxOf` reads the sim's live tick; the memo's expiry needs an arbitrary one. */
function ctxAt(sim: Simulation, tick: number): SystemContext {
  return { ...ctxOf(sim), tick };
}

interface Standoff {
  readonly sim: Simulation;
  readonly terrain: TerrainGraph;
  readonly besieger: Entity;
  readonly enemy: Entity;
  readonly at: { hx: number; hy: number };
  /** The pocket's nodes: the enemy's and its ring of eight. */
  readonly pocket: ReadonlySet<NodeId>;
}

/** A besieger of player 0 in sight of an IGNORE-stance enemy of player 1 that holds still, so one chase is
 *  measured. */
function standoff(opts: { besiegerJob?: number; enemyCell?: { x: number; y: number } } = {}): Standoff {
  const sim = new Simulation({ seed: 1, content: siegeContent(), map: grassMap(12, 9) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture: the standoff needs a map');
  const enemyCell = opts.enemyCell ?? ENEMY_CELL;
  const besieger = fighterAt(sim, BESIEGER_CELL.x, BESIEGER_CELL.y, VIKING, opts.besiegerJob ?? WOODCUTTER, {
    owner: P0,
  });
  const enemy = fighterAt(sim, enemyCell.x, enemyCell.y, VIKING, SOLDIER, { owner: P1 });
  sim.world.add(enemy, Stance, { mode: MILITARY_MODE.IGNORE, anchorCell: null });
  const at = nodeOfPosition(fx.fromInt(enemyCell.x), fx.fromInt(enemyCell.y));
  const pocket = new Set<NodeId>();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) pocket.add(terrain.nodeAt(at.hx + dx, at.hy + dy));
  }
  return { sim, terrain, besieger, enemy, at, pocket };
}

/** The standoff with the enemy walled in by finished buildings, the seal proven by the pathfinder. */
function siege(opts: { wallOwner?: number; enemyCell?: { x: number; y: number } } = {}): Standoff & {
  readonly walls: readonly Entity[];
} {
  const scene = standoff({ ...(opts.enemyCell === undefined ? {} : { enemyCell: opts.enemyCell }) });
  const { sim, terrain, at } = scene;
  const walls = wallIn(sim, at.hx, at.hy, opts.wallOwner);
  const from = nodeOfPosition(fx.fromInt(BESIEGER_CELL.x), fx.fromInt(BESIEGER_CELL.y));
  const overlay = dynamicBlockOverlay(sim.world, ctxOf(sim), terrain);
  expect(
    findPath(terrain, terrain.nodeAt(from.hx, from.hy), terrain.nodeAt(at.hx, at.hy), overlay),
  ).toBeNull();
  return { ...scene, walls };
}

function nodeOf(sim: Simulation, terrain: TerrainGraph, e: Entity): NodeId {
  const p = sim.world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return terrain.nodeAt(n.hx, n.hy);
}

function swingsAt(sim: Simulation, e: Entity, target: Entity): boolean {
  const effect = sim.world.tryGet(e, CurrentAtomic)?.effect;
  return effect?.kind === 'attack' && effect.target === target;
}

/** Counted probe: the planner turns a goal into exactly one PathRequest, so a fresh request standing after
 *  the planner pass is a route the besieger asked for. Counts the ones aimed into the pocket. */
function countPocketRequests(scene: Standoff, ticks: number): number {
  const { sim, besieger, pocket } = scene;
  let issued = 0;
  sim.setInstrument((name, run) => {
    run();
    if (name !== 'planner') return;
    const req = sim.world.tryGet(besieger, PathRequest);
    if (req !== undefined && !req.failed && pocket.has(req.goal)) issued++;
  });
  for (let i = 0; i < ticks; i++) sim.step();
  return issued;
}

/** The tick by which a release has landed: a refused route is seen the tick after each cadence's request. */
const RELEASED_BY = SEALED_TARGET_ROUTE_FAILURES * (REPATH_CADENCE + 1);

describe('a chase whose target is walled in by buildings', () => {
  it('asks for a route into the pocket once per cadence, then gives the target up', () => {
    const scene = siege();

    const issued = countPocketRequests(scene, 200);

    // One request per cadence until the release, never one per tick.
    expect(issued).toBe(SEALED_TARGET_ROUTE_FAILURES);
    expect(scene.sim.world.has(scene.besieger, Engagement)).toBe(false);
    const memo = scene.sim.world.get(scene.besieger, UnreachableTargets).entries.map((entry) => entry.target);
    expect(memo).toEqual([scene.enemy]);
  });

  it('announces the give-up once per stand-off, not once per refused route', () => {
    const scene = siege();
    const raised: Entity[] = [];
    for (let i = 0; i < RELEASED_BY + REPATH_CADENCE; i++) {
      scene.sim.step();
      for (const ev of scene.sim.events.current()) {
        if (ev.kind === 'settlerLost') raised.push(ev.entity);
      }
    }
    expect(raised).toEqual([scene.besieger]);
  });

  it('hands the besieger back to the economy and keeps it there', () => {
    const scene = siege();
    const wood = scene.sim.world.create();
    scene.sim.world.add(wood, Position, { x: fx.fromInt(1), y: fx.fromInt(BESIEGER_CELL.y) });
    scene.sim.world.add(wood, Resource, { goodType: WOOD, remaining: 100, harvestAtomic: HARVEST_ATOMIC });
    stampResourceFootprintData(scene.sim.world, wood, anchorOnlyFootprint());

    // The first chase starts once the harvest walk the planner issued at tick 0 ends, so the release is
    // detected rather than dated: the first tick the marker drops after having stood.
    let releasedAt = -1;
    let engagedAfterRelease = 0;
    let stood = false;
    for (let i = 0; i < 200; i++) {
      scene.sim.step();
      const engaged = scene.sim.world.has(scene.besieger, Engagement);
      if (releasedAt >= 0 && engaged) engagedAfterRelease++;
      if (stood && !engaged && releasedAt < 0) releasedAt = i;
      stood ||= engaged;
    }

    expect(releasedAt).toBeGreaterThan(0);
    expect(engagedAfterRelease).toBe(0); // the memo keeps it off the walled-in enemy between atomics
    expect(scene.sim.world.get(wood, Resource).remaining).toBeLessThan(100);
  });

  it('keeps the chase through a seal that clears within the hold', () => {
    const scene = siege();
    // Two refused routes in and one short of the release, the walls come down.
    const clearAt = REPATH_CADENCE + 4;

    let engagedThroughout = true;
    let swingTick = -1;
    for (let i = 0; i < 120 && swingTick < 0; i++) {
      if (i === clearAt) for (const post of scene.walls) scene.sim.world.destroy(post);
      scene.sim.step();
      if (!scene.sim.world.has(scene.besieger, Engagement)) engagedThroughout = false;
      if (swingsAt(scene.sim, scene.besieger, scene.enemy)) swingTick = i;
    }

    expect(engagedThroughout).toBe(true);
    expect(swingTick).toBeGreaterThan(clearAt);
  });

  it('strikes a given-up enemy that steps into reach', () => {
    const scene = siege();
    for (let i = 0; i < RELEASED_BY; i++) scene.sim.step();
    expect(scene.sim.world.has(scene.besieger, Engagement)).toBe(false);
    // Out of its compound and into the axe's band: the memo refuses the walk, never the swing.
    const p = scene.sim.world.get(scene.besieger, Position);
    const here = nodeOfPosition(p.x, p.y);
    const beside = positionOfNode(here.hx + 1, here.hy);
    const enemyPosition = scene.sim.world.mut(scene.enemy, Position);
    enemyPosition.x = beside.x;
    enemyPosition.y = beside.y;

    combatSystem(scene.sim.world, ctxOf(scene.sim));

    expect(swingsAt(scene.sim, scene.besieger, scene.enemy)).toBe(true);
  });

  it('gives the man up and batters the ring that owns him', () => {
    const scene = siege({ wallOwner: P1 });

    let struck: Entity | null = null;
    for (let i = 0; i < 150 && struck === null; i++) {
      scene.sim.step();
      struck = scene.walls.find((post) => swingsAt(scene.sim, scene.besieger, post)) ?? null;
    }

    // Units outrank plain buildings, so the walls are struck only once the man inside is given up.
    expect(struck).not.toBeNull();
    const memo = scene.sim.world.get(scene.besieger, UnreachableTargets).entries.map((entry) => entry.target);
    expect(memo).toEqual([scene.enemy]);
  });

  it('a DEFEND guard gives the walled-in enemy up and stays on its post', () => {
    const scene = siege({ enemyCell: { x: 5, y: 4 } }); // 6 nodes off, inside DEFEND_RADIUS_NODES
    const anchor = nodeOf(scene.sim, scene.terrain, scene.besieger);
    scene.sim.world.add(scene.besieger, Stance, { mode: MILITARY_MODE.DEFEND, anchorCell: anchor });

    for (let i = 0; i < 60; i++) scene.sim.step();

    expect(scene.sim.world.has(scene.besieger, Engagement)).toBe(false);
    expect(nodeOf(scene.sim, scene.terrain, scene.besieger)).toBe(anchor);
    const memo = scene.sim.world.get(scene.besieger, UnreachableTargets).entries.map((entry) => entry.target);
    expect(memo).toEqual([scene.enemy]);
  });

  it('re-acquires a given-up enemy once its memo lapses', () => {
    // No walls: the memo alone keeps the besieger off the enemy, until the entry lapses.
    const { sim, besieger, enemy } = standoff();
    noteUnreachableTarget(sim.world, ctxAt(sim, 0), besieger, enemy);

    combatSystem(sim.world, ctxAt(sim, 1));
    expect(sim.world.has(besieger, Engagement)).toBe(false);

    combatSystem(sim.world, ctxAt(sim, UNREACHABLE_TARGET_MEMO_TICKS));
    expect(sim.world.has(besieger, Engagement)).toBe(true);
    expect(sim.world.has(besieger, UnreachableTargets)).toBe(false); // reaped as it lapsed
  });
});

describe('a chase whose target is ringed by standing bodies', () => {
  it('holds at the cadence for as long as the ring stands and takes the gap when a body steps off', () => {
    const scene = standoff({ besiegerJob: SOLDIER });
    const crowd = crowdIn(scene.sim, scene.at.hx, scene.at.hy);

    // Well past the release threshold, the chase still stands: a seal of bodies is never given up.
    let engagedThroughout = true;
    for (let i = 0; i < 6 * REPATH_CADENCE; i++) {
      scene.sim.step();
      if (!scene.sim.world.has(scene.besieger, Engagement)) engagedThroughout = false;
    }
    expect(engagedThroughout).toBe(true);
    expect(scene.sim.world.has(scene.besieger, UnreachableTargets)).toBe(false);
    // Held by the count and the probe, not by a swing: still outside, refusals well past the threshold.
    expect(scene.pocket.has(nodeOf(scene.sim, scene.terrain, scene.besieger))).toBe(false);
    expect(scene.sim.world.get(scene.besieger, Engagement).stall?.routes).toBeGreaterThanOrEqual(
      SEALED_TARGET_ROUTE_FAILURES,
    );

    // The body on the ring's west edge steps off, opening a 4-connected passage (a corner would not): the
    // next cadence's route resolves and the chase walks in.
    const ring = ringAround(scene.at.hx, scene.at.hy);
    const gap = crowd[ring.findIndex((n) => n.hx === scene.at.hx - RING_RADIUS && n.hy === scene.at.hy)];
    if (gap === undefined) throw new Error('fixture: the ring has no west edge');
    scene.sim.world.destroy(gap);
    let reached = false;
    for (let i = 0; i < 120 && !reached; i++) {
      scene.sim.step();
      reached =
        scene.pocket.has(nodeOf(scene.sim, scene.terrain, scene.besieger)) ||
        swingsAt(scene.sim, scene.besieger, scene.enemy);
    }
    expect(reached).toBe(true);
  });

  it('drops the refusal count while it stands in the second rank', () => {
    // A corridor two nodes high: the mace's band around the enemy is four in-bounds cells, each held by
    // an allied body, so the subject, already a map point outside that band, waits there and routing is
    // never asked.
    const sim = new Simulation({ seed: 1, content: siegeContent(), map: grassMap(9, 1) });
    const enemy = fighterOnNode(sim, 10, 0, SOLDIER, P1, MILITARY_MODE.IGNORE);
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
    ] as const) {
      fighterOnNode(sim, 10 + dx, dy, SOLDIER, P0, MILITARY_MODE.IGNORE);
    }
    const subject = fighterOnNode(sim, 8, 0, SOLDIER, P0, MILITARY_MODE.ATTACK);
    sim.world.add(subject, Engagement, { repathAt: 0, stall: { target: enemy, routes: 2 } });

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(subject, Engagement)).toMatchObject({ stall: undefined, target: enemy });
    expect(sim.world.has(subject, MoveGoal)).toBe(false);
  });
});
