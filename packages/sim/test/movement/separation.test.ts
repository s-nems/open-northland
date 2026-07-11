import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  MoveGoal,
  Obstructed,
  Owner,
  PathFollow,
  PathRequest,
  Position,
  Settler,
} from '../../src/components/index.js';
import { ZERO, fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  Simulation,
  type TerrainMap,
  halfCellMapFromCells,
  nodeOfPosition,
  positionOfNode,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { clearComponentStores } from '../fixtures/stores.js';

/**
 * Tests for UNIT BODY COLLISION (`systems/movement/separation.ts` + the routing stamp) — a NAMED
 * DEVIATION from the original, which has no unit collision at all (see the system's file header for
 * the model and its rationale). What must hold:
 *  - every OWNED walking settler soft-separates from fellow walkers (civilians included, calm zones
 *    included) — walking units never merge into one sprite, and the nudge never prevents an arrival;
 *  - only OWNED FIGHTERS collide FIRMLY — civilians and neutrals keep the original's pass-through
 *    against every STANDING body, and unowned units feel nothing at all;
 *  - walking fighters shove softly past each other (no mover can ever deadlock a mover);
 *  - a STANDING line is a wall: routing detours around it, physics stops what still walks into it,
 *    and a blocked walker gives up instead of grinding forever;
 *  - a goal occupied by a standing body is re-aimed at the nearest free node (the surround rule);
 *  - inside its own player's calm zone (near own buildings) a walker skips the FIRM tier — town
 *    flow never jams.
 * All scenario coordinates are half-cell NODE coords on an all-grass map.
 */

const GRASS = 0;
const WATER = 1; // walkable: false in the fixture landscape
const VIKING = 1;
const WOODCUTTER = 1; // a civilian trade — never collides
const SOLDIER = 31; // jobtypes.ini soldier band 31..41 — the colliding class
const ANY_BUILDING_TYPE = 999; // no footprint in the fixture content — a pure calm-zone marker
const P0 = 0;
const P1 = 1;

beforeEach(clearComponentStores);

function grassMap(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

/** A 12×6-cell (24×12-node) all-grass sim. */
function sim(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 6) });
}

function settlerAt(s: Simulation, x: number, y: number, jobType: number, owner: number | null): Entity {
  const e = s.world.create();
  s.world.add(e, Position, positionOfNode(x, y));
  s.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  if (owner !== null) s.world.add(e, Owner, { player: owner });
  return e;
}

function orderTo(s: Simulation, e: Entity, x: number, y: number): void {
  const terrain = s.terrain;
  if (terrain === undefined) throw new Error('orderTo needs a mapped sim');
  s.world.add(e, MoveGoal, { cell: terrain.nodeAt(x, y) });
}

/** A hand-built straight path to node (x,y) — bypasses routing, so it can aim THROUGH a wall to
 *  exercise the physical layer alone. */
function walkStraightTo(s: Simulation, e: Entity, x: number, y: number): void {
  s.world.add(e, PathFollow, {
    waypoints: [positionOfNode(x, y)],
    index: 0,
    speed: ZERO,
    hx: ZERO,
    hy: ZERO,
  });
}

function nodeOf(s: Simulation, e: Entity): { x: number; y: number } {
  const p = s.world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return { x: n.hx, y: n.hy };
}

/** A standing enemy line spanning every node row at column `hx` — a sealed wall on this map. */
function wallAt(s: Simulation, hx: number, owner: number): Entity[] {
  const posts: Entity[] = [];
  for (let hy = 0; hy < 12; hy++) posts.push(settlerAt(s, hx, hy, SOLDIER, owner));
  return posts;
}

describe('unit body collision (separation + routing stamp)', () => {
  it('two walking fighters cross head-on and both arrive — movers never deadlock movers', () => {
    const s = sim();
    const east = settlerAt(s, 4, 6, SOLDIER, P0);
    const west = settlerAt(s, 16, 6, SOLDIER, P0);
    orderTo(s, east, 16, 6);
    orderTo(s, west, 4, 6);
    s.run(250);

    expect(nodeOf(s, east)).toEqual({ x: 16, y: 6 });
    expect(nodeOf(s, west)).toEqual({ x: 4, y: 6 });
    expect(s.world.has(east, PathFollow)).toBe(false);
    expect(s.world.has(west, PathFollow)).toBe(false);
  });

  it('a sealed standing line makes the far side unroutable — the order fails cleanly, nobody grinds', () => {
    const s = sim();
    wallAt(s, 10, P1);
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 16, 6);
    s.run(120);

    expect(nodeOf(s, runner)).toEqual({ x: 4, y: 6 }); // never set off — no route exists
    expect(s.world.tryGet(runner, PathRequest)?.failed).toBe(true);
  });

  it('the wall is physically impassable even for a stale route aimed straight through it, and the walker gives up', () => {
    const s = sim();
    const posts = wallAt(s, 10, P1);
    const held = posts.map((p) => {
      const pos = s.world.get(p, Position);
      return { x: pos.x, y: pos.y };
    });
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    walkStraightTo(s, runner, 16, 6); // bypasses routing: the physical layer must hold alone
    s.run(200);

    expect(nodeOf(s, runner).x).toBeLessThan(10); // never crossed the line
    expect(s.world.has(runner, PathFollow)).toBe(false); // Obstructed give-up dropped the route
    expect(s.world.has(runner, Obstructed)).toBe(false); // and the counter was cleaned up with it
    for (const [i, p] of posts.entries()) {
      // No post was displaced an ulp — standing bodies are immovable.
      const pos = s.world.get(p, Position);
      expect({ x: pos.x, y: pos.y }).toEqual(held[i]);
    }
  });

  it('routing detours around a single standing body on the straight line and still arrives', () => {
    const s = sim();
    settlerAt(s, 10, 6, SOLDIER, P0); // a lone post directly on the straight route
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 16, 6);
    s.run(250);

    expect(nodeOf(s, runner)).toEqual({ x: 16, y: 6 });
    expect(s.world.has(runner, PathFollow)).toBe(false);
  });

  it('a line raised MID-WALK is flowed around: the obstructed walker re-routes instead of treadmilling', () => {
    const s = sim();
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 16, 6);
    s.run(30); // en route on the straight line, planned before any wall existed
    // A SHORT enemy line drops across the stale route (standing spawns) — rows 4..8 of column 10,
    // leaving both flanks open. The stale path aims straight into it; the walker must grind only
    // {@link OBSTRUCTED_REROUTE_TICKS}, drop the path, and re-plan around a flank. The old give-up
    // (24 ticks of marching in place, then standing down with the goal dropped) never arrived.
    for (let hy = 4; hy <= 8; hy++) settlerAt(s, 10, hy, SOLDIER, P1);
    s.run(250);

    expect(nodeOf(s, runner)).toEqual({ x: 16, y: 6 }); // arrived — flowed around the flank
    expect(s.world.has(runner, Obstructed)).toBe(false);
  });

  it('a goal occupied by a standing body is re-aimed at the nearest free node (the surround rule)', () => {
    const s = sim();
    const post = settlerAt(s, 12, 6, SOLDIER, P0);
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 12, 6);
    s.run(250);

    const at = nodeOf(s, runner);
    expect(at).not.toEqual({ x: 12, y: 6 }); // the occupied node itself stays the post's
    expect(Math.abs(at.x - 12) + Math.abs(at.y - 6)).toBeLessThanOrEqual(2); // ...but it stood down right beside it
    expect(nodeOf(s, post)).toEqual({ x: 12, y: 6 });
    expect(s.world.has(runner, MoveGoal)).toBe(false); // the re-aimed goal completed — no failed order left
    expect(s.world.has(runner, PathRequest)).toBe(false);
  });

  it('inside its own calm zone a walker is a ghost: it reaches a node its own garrison stands on', () => {
    const s = sim();
    const b = s.world.create();
    s.world.add(b, Position, positionOfNode(10, 6));
    s.world.add(b, Building, {
      buildingType: ANY_BUILDING_TYPE,
      tribe: VIKING,
      built: fx.fromInt(1),
      level: 0,
    });
    s.world.add(b, Owner, { player: P0 });
    const post = settlerAt(s, 12, 6, SOLDIER, P0); // standing in P0's own town
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 12, 6);

    // The idle-spacing drive relocates one of two units RESTING on a shared node afterwards, so
    // assert the pass-through at the moment of arrival: the walker must stand EXACTLY on the
    // occupied node at some tick (physically impossible unless it ghosts through the post).
    let reached = false;
    for (let t = 0; t < 250 && !reached; t++) {
      s.step();
      const at = nodeOf(s, runner);
      reached = at.x === 12 && at.y === 6 && nodeOf(s, post).x === 12;
    }
    expect(reached).toBe(true);
  });

  it('never pushes a body onto unwalkable ground: a shove toward water is clamped', () => {
    // Top CELL row is water (node rows 0–1); the runner walks the first grass node row (hy=2).
    // The post stands OFF-CENTRE between node rows 2 and 3, so the radial resolve points NORTH —
    // straight at the water — and the landing clamp must drop that axis.
    const ids = new Array<number>(12 * 6).fill(GRASS);
    for (let cx = 0; cx < 12; cx++) ids[cx] = WATER;
    const s = new Simulation({
      seed: 1,
      content: testContent(),
      map: halfCellMapFromCells({ width: 12, height: 6, typeIds: ids }),
    });
    const post = settlerAt(s, 10, 2, SOLDIER, P1);
    const postPos = s.world.get(post, Position);
    postPos.y = fx.div(fx.fromInt(6), fx.fromInt(5)); // 1.2 rows: south of the runner's line, radius overlapping it
    const runner = settlerAt(s, 4, 2, SOLDIER, P0);
    walkStraightTo(s, runner, 16, 2);

    for (let t = 0; t < 250; t++) {
      s.step();
      expect(nodeOf(s, runner).y).toBeGreaterThanOrEqual(2); // never on a water node
    }
    expect(nodeOf(s, runner)).toEqual({ x: 16, y: 2 }); // and the brush-past still arrived
  });

  it('civilians never collide: a worker walks straight through an enemy line, untouched', () => {
    const s = sim();
    wallAt(s, 10, P1);
    const worker = settlerAt(s, 4, 6, WOODCUTTER, P0);
    walkStraightTo(s, worker, 16, 6);
    s.run(150);

    expect(nodeOf(s, worker)).toEqual({ x: 16, y: 6 }); // passed the wall as in the original
    expect(s.world.has(worker, Obstructed)).toBe(false);
  });

  it('a ROUTED civilian is never detoured by standing bodies — routing skips the unit overlay', () => {
    // Same wall, but the worker goes through the real planner→routing pipeline (a MoveGoal, not a
    // hand-built path). The wall seals every row, so a detour is impossible: arriving at all proves
    // routing never composed the standing-unit overlay for a non-collider. The physical-layer twin
    // above bypasses routing on purpose; this is the ROUTING half of the civilian pass-through.
    const s = sim();
    wallAt(s, 10, P1);
    const worker = settlerAt(s, 4, 6, WOODCUTTER, P0);
    orderTo(s, worker, 16, 6);
    s.run(150);

    expect(nodeOf(s, worker)).toEqual({ x: 16, y: 6 });
    expect(s.world.has(worker, PathRequest)).toBe(false); // never flagged failed either
  });

  it("a civilian's goal on a fighter-occupied node is never re-aimed — economy targets stay exact", () => {
    // A standing enemy soldier occupies the worker's exact destination. The surround rule re-aims a
    // COLLIDER's goal to a free stand-in; a civilian's goal must survive verbatim (the economy's
    // node-coincidence checks depend on arriving exactly where the goal was set). Asserted at the
    // ARRIVAL tick — the idle-spacing drive legitimately nudges a settler off a shared node later.
    const s = sim();
    settlerAt(s, 16, 6, SOLDIER, P1); // a post exactly on the goal node
    const worker = settlerAt(s, 4, 6, WOODCUTTER, P0);
    orderTo(s, worker, 16, 6);
    let arrived = false;
    for (let t = 0; t < 150 && !arrived; t++) {
      s.run(1);
      arrived = !s.world.has(worker, MoveGoal); // the goal is shed exactly on arrival
    }
    expect(arrived).toBe(true);
    expect(nodeOf(s, worker)).toEqual({ x: 16, y: 6 }); // arrived ON the occupied node, not beside it
  });

  it('unowned fighters never collide — neutral fixtures stay byte-identical to the pre-collision sim', () => {
    const s = sim();
    for (let hy = 0; hy < 12; hy++) settlerAt(s, 10, hy, SOLDIER, null); // an UNOWNED line
    const runner = settlerAt(s, 4, 6, SOLDIER, null); // an UNOWNED walker
    walkStraightTo(s, runner, 16, 6);
    s.run(150);

    expect(nodeOf(s, runner)).toEqual({ x: 16, y: 6 }); // passed straight through
  });

  it('two owned civilians walking the same road are nudged apart — never drawn merged mid-walk', () => {
    const s = sim();
    const a = settlerAt(s, 4, 6, WOODCUTTER, P0);
    const b = settlerAt(s, 4, 6, WOODCUTTER, P0); // spawned exactly stacked — the builders' case
    orderTo(s, a, 20, 6);
    orderTo(s, b, 20, 6);

    // After a short warm-up (route resolution + the first split ticks), the pair must never share an
    // exact position again while BOTH walk — the soft nudge rides them apart and keeps them apart.
    let bothWalkedTicks = 0;
    for (let t = 0; t < 250; t++) {
      s.step();
      if (!s.world.has(a, PathFollow) || !s.world.has(b, PathFollow)) continue;
      bothWalkedTicks++;
      if (bothWalkedTicks <= 5) continue; // the exact-stack split needs a few ticks to open a gap
      const pa = s.world.get(a, Position);
      const pb = s.world.get(b, Position);
      expect(pa.x === pb.x && pa.y === pb.y).toBe(false);
    }
    expect(bothWalkedTicks).toBeGreaterThan(20); // the walk was long enough to prove anything
    // ...and the nudge never prevented the arrivals (both stood down at/next to the shared goal —
    // the idle-spacing drive legitimately parks one beside it).
    expect(s.world.has(a, PathFollow)).toBe(false);
    expect(s.world.has(b, PathFollow)).toBe(false);
    expect(Math.abs(nodeOf(s, a).x - 20) + Math.abs(nodeOf(s, a).y - 6)).toBeLessThanOrEqual(1);
    expect(Math.abs(nodeOf(s, b).x - 20) + Math.abs(nodeOf(s, b).y - 6)).toBeLessThanOrEqual(1);
    expect(s.world.has(a, Obstructed)).toBe(false); // soft-only movers never grind
    expect(s.world.has(b, Obstructed)).toBe(false);
  });

  it('the civilian nudge stays ON inside a calm zone — town walkers spread and still arrive', () => {
    const s = sim();
    const b = s.world.create();
    s.world.add(b, Position, positionOfNode(12, 6));
    s.world.add(b, Building, {
      buildingType: ANY_BUILDING_TYPE,
      tribe: VIKING,
      built: fx.fromInt(1),
      level: 0,
    });
    s.world.add(b, Owner, { player: P0 }); // its calm zone covers the whole walk below
    const w1 = settlerAt(s, 8, 6, WOODCUTTER, P0);
    const w2 = settlerAt(s, 8, 6, WOODCUTTER, P0);
    orderTo(s, w1, 16, 6);
    orderTo(s, w2, 16, 6);

    let bothWalkedTicks = 0;
    for (let t = 0; t < 200; t++) {
      s.step();
      if (!s.world.has(w1, PathFollow) || !s.world.has(w2, PathFollow)) continue;
      bothWalkedTicks++;
      if (bothWalkedTicks <= 5) continue;
      const p1 = s.world.get(w1, Position);
      const p2 = s.world.get(w2, Position);
      expect(p1.x === p2.x && p1.y === p2.y).toBe(false); // nudged apart even in town
    }
    expect(bothWalkedTicks).toBeGreaterThan(10);
    expect(s.world.has(w1, PathFollow)).toBe(false); // and town flow never jammed
    expect(s.world.has(w2, PathFollow)).toBe(false);
  });

  it('UNOWNED civilians walking together stay exactly merged — the Owner gate holds for the soft tier', () => {
    const s = sim();
    const a = settlerAt(s, 4, 6, WOODCUTTER, null);
    const b = settlerAt(s, 4, 6, WOODCUTTER, null);
    walkStraightTo(s, a, 16, 6);
    walkStraightTo(s, b, 16, 6);
    for (let t = 0; t < 150; t++) {
      s.step();
      const pa = s.world.get(a, Position);
      const pb = s.world.get(b, Position);
      expect({ x: pa.x, y: pa.y }).toEqual({ x: pb.x, y: pb.y }); // byte-identical twin walks
    }
    expect(nodeOf(s, a)).toEqual({ x: 16, y: 6 });
  });

  it('is deterministic: the same collision scenario replayed from scratch hashes identically', () => {
    const play = (): string => {
      const s = sim();
      const east = settlerAt(s, 4, 6, SOLDIER, P0);
      const west = settlerAt(s, 16, 6, SOLDIER, P0);
      settlerAt(s, 10, 6, SOLDIER, P1); // an enemy post right on the crossing line
      orderTo(s, east, 16, 6);
      orderTo(s, west, 4, 6);
      s.run(200);
      return s.hashState();
    };
    const first = play();
    clearComponentStores();
    expect(play()).toBe(first);
  });
});
