import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Position, Resource, Stranded, UnreachableGoals } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode, type Simulation } from '../../src/index.js';
import { stampResourceFootprintData } from '../../src/systems/index.js';
import { ownedWoodcutter, sim, woodAt } from '../conflict/orders/support.js';

/**
 * The route-aware harvest pick: a clear-but-enclosed node must never win, however many enclosed
 * nodes there are. The failed-goal memo alone could not hold this line — with more enclosed cells
 * than memo entries the pick cycled through them forever (the soaked iron-collector stall this
 * guards against) — so the assertions demand the pick avoids the pocket WITHOUT a single route
 * failure, not that it recovers after some.
 */

/** A walk-blocking wall entity anchored at half-cell NODE (x, y) with the given cell offsets. */
function wallAt(s: Simulation, x: number, y: number, offsets: Array<{ dx: number; dy: number }>): Entity {
  const e = s.world.create();
  s.world.add(e, Position, positionOfNode(x, y));
  stampResourceFootprintData(s.world, e, { walk: offsets, build: [], work: [] });
  return e;
}

function harvestedResource(s: Simulation, e: Entity): Entity | null {
  const atomic = s.world.tryGet(e, CurrentAtomic);
  return atomic?.effect.kind === 'harvest' ? atomic.effect.resource : null;
}

/** Drive the sim until `done`, failing loudly on timeout and on any route failure along the way —
 *  the fix's whole point is that the pick never chooses a doomed goal in the first place. */
function stepUntilWithoutRouteFailure(s: Simulation, e: Entity, limit: number, done: () => boolean): void {
  for (let i = 0; i < limit && !done(); i++) {
    s.step();
    expect(s.world.has(e, UnreachableGoals)).toBe(false);
    expect(s.world.has(e, Stranded)).toBe(false);
  }
  if (!done()) throw new Error(`condition not reached within ${limit} ticks`);
}

describe('the harvest pick against enclosed resource nodes', () => {
  it('picks the farther reachable tree over a nearer clear-but-enclosed one, with no route failure', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    const UNTOUCHED = 5;
    // The near tree's tile (4, 1) sits on node (9, 2); the ring seals exactly that node.
    const near = woodAt(s, 4, 1, UNTOUCHED);
    wallAt(s, 9, 2, [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
      { dx: 1, dy: 2 },
      { dx: 1, dy: -2 },
      { dx: -1, dy: 2 },
      { dx: -1, dy: -2 },
    ]);
    const far = woodAt(s, 8, 0, UNTOUCHED);

    stepUntilWithoutRouteFailure(s, e, 400, () => harvestedResource(s, e) !== null);
    expect(harvestedResource(s, e)).toBe(far);
    expect(s.world.get(near, Resource).remaining).toBe(UNTOUCHED);
  });

  it('skips a hemmed deposit whose stance falls back to its own blocked anchor', () => {
    // A deposit blocking its own anchor with no work cells resolves its stance through
    // resourceStanceCells' fallbacks; with all four anchor neighbours resource-blocked the last
    // fallback returns the bare anchor - statically walkable but overlay-blocked, a goal findPath
    // refuses. The pick must refuse it too (the magiczny_las iron-field stall signature:
    // walkable=true, dynamically blocked, no route ever succeeds).
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    const UNTOUCHED = 5;
    const near = woodAt(s, 4, 1, UNTOUCHED); // anchor node (9, 2)
    stampResourceFootprintData(s.world, near, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
    wallAt(s, 9, 2, [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ]);
    const far = woodAt(s, 8, 0, UNTOUCHED);

    stepUntilWithoutRouteFailure(s, e, 400, () => harvestedResource(s, e) !== null);
    expect(harvestedResource(s, e)).toBe(far);
    expect(s.world.get(near, Resource).remaining).toBe(UNTOUCHED);
  });

  it('walks past a pocket holding more enclosed trees than the failed-goal memo could remember', () => {
    // 12×4 cells = 24×8 nodes. The rectangle wall spans nodes x 3..15, y 1..5, sealing an 11×3-node
    // interior that holds 11 tree anchors — more than UNREACHABLE_GOAL_MEMO_SIZE, the count that made
    // the memo-only pick cycle forever.
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    const UNTOUCHED = 5;
    const wallOffsets: Array<{ dx: number; dy: number }> = [];
    for (let dx = 0; dx <= 12; dx++) wallOffsets.push({ dx, dy: 0 }, { dx, dy: 4 });
    for (let dy = 1; dy <= 3; dy++) wallOffsets.push({ dx: 0, dy }, { dx: 12, dy });
    wallAt(s, 3, 1, wallOffsets);
    const enclosed: Entity[] = [];
    // Tiles (2..6, 1) anchor on nodes (5..13 odd, 2); tiles (2..7, 2) on nodes (4..14 even, 4).
    for (let x = 2; x <= 6; x++) enclosed.push(woodAt(s, x, 1, UNTOUCHED));
    for (let x = 2; x <= 7; x++) enclosed.push(woodAt(s, x, 2, UNTOUCHED));
    const far = woodAt(s, 10, 0, UNTOUCHED);

    stepUntilWithoutRouteFailure(s, e, 800, () => harvestedResource(s, e) !== null);
    expect(harvestedResource(s, e)).toBe(far);
    for (const tree of enclosed) expect(s.world.get(tree, Resource).remaining).toBe(UNTOUCHED);
  });
});
