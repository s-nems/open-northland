import { describe, expect, it } from 'vitest';
import {
  Building,
  MoveGoal,
  Obstructed,
  Owner,
  PathFollow,
  PathRequest,
  Position,
} from '../../../src/components/index.js';
import { fx } from '../../../src/core/fixed.js';
import { positionOfNode } from '../../../src/index.js';
import {
  ANY_BUILDING_TYPE,
  nodeOf,
  orderTo,
  P0,
  P1,
  SOLDIER,
  settlerAt,
  sim,
  VIKING,
  WOODCUTTER,
  walkStraightTo,
  wallAt,
} from './support.js';

describe('unit body collision — soft and civilian traffic', () => {
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

  it('same-lane walkers form a COLUMN: the follower falls in behind, nobody is shoved off the lane', () => {
    // Two owned civilians share one eastbound lane (a pure E walk keeps the row constant, so ANY
    // lateral shove would show as a y change). The convoy rule must (a) never push either off the
    // lane, (b) open a fore/aft gap, and (c) keep the column order stable — the reported jostle was
    // the pair swapping/shoving sideways on every step.
    const s = sim();
    const a = settlerAt(s, 4, 6, WOODCUTTER, P0);
    const b = settlerAt(s, 4, 6, WOODCUTTER, P0);
    orderTo(s, a, 20, 6);
    orderTo(s, b, 20, 6);

    let bothWalkedTicks = 0;
    let order: 1 | -1 | null = null;
    for (let t = 0; t < 250; t++) {
      s.step();
      if (!s.world.has(a, PathFollow) || !s.world.has(b, PathFollow)) continue;
      bothWalkedTicks++;
      const pa = s.world.get(a, Position);
      const pb = s.world.get(b, Position);
      expect(pa.y).toBe(pb.y); // never shoved off the shared lane
      if (bothWalkedTicks <= 6) continue; // the tie-brake needs a few ticks to open the gap
      expect(pa.x === pb.x).toBe(false); // a real fore/aft gap
      const now: 1 | -1 = pa.x > pb.x ? 1 : -1;
      if (order !== null) expect(now).toBe(order); // the column never flips (no per-step shoving)
      order = now;
    }
    expect(bothWalkedTicks).toBeGreaterThan(20);
    expect(order).not.toBeNull();
    // The nudge still never prevents the arrivals (idle spacing may park one beside the goal).
    expect(s.world.has(a, PathFollow)).toBe(false);
    expect(s.world.has(b, PathFollow)).toBe(false);
    expect(Math.abs(nodeOf(s, a).x - 20) + Math.abs(nodeOf(s, a).y - 6)).toBeLessThanOrEqual(1);
    expect(Math.abs(nodeOf(s, b).x - 20) + Math.abs(nodeOf(s, b).y - 6)).toBeLessThanOrEqual(1);
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
});
