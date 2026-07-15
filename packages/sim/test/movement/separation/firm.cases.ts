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
import { halfCellMapFromCells, positionOfNode, Simulation } from '../../../src/index.js';
import { testContent } from '../../fixtures/content.js';
import {
  ANY_BUILDING_TYPE,
  GRASS,
  nodeOf,
  orderTo,
  P0,
  P1,
  SOLDIER,
  settlerAt,
  sim,
  VIKING,
  WATER,
  walkStraightTo,
  wallAt,
} from './support.js';

describe('unit body collision — firm routing and resolution', () => {
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
});
