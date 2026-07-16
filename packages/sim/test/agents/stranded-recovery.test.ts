import { describe, expect, it } from 'vitest';
import { CurrentAtomic, MoveGoal, PathRequest, PlayerOrder, Stranded } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, type Simulation } from '../../src/index.js';
import { aiSystem } from '../../src/systems/index.js';
import { orderMove, ownedWoodcutter, sim, woodAt } from '../conflict/orders/support.js';
import { ctxOf } from '../fixtures/context.js';

/**
 * The planner's stranded-route recovery (see the block in systems/agents/ai.ts): a failed walk is
 * parked (Stranded — paced, not per-tick), then shed and re-planned; drives with their own failure
 * protocol keep their signal; an authoritative order ends the park at once.
 */

/** The cell id of visual tile (x, y)'s anchor node. */
function anchorCell(s: Simulation, x: number, y: number): number {
  const n = cellAnchorNode(x, y);
  return s.terrain?.nodeAt(n.hx, n.hy) as number;
}

/** Stamp a walk that already failed (the state routing leaves after an unroutable request). */
function strandOn(s: Simulation, e: Entity, goalTile: number): void {
  const goal = anchorCell(s, goalTile, 0);
  s.world.add(e, MoveGoal, { cell: goal });
  s.world.add(e, PathRequest, { start: anchorCell(s, 0, 0), goal, failed: true });
}

describe('aiSystem — stranded-route recovery (a failed walk no longer freezes a settler)', () => {
  it('parks the failed route first (no per-tick retry), then sheds it and re-plans', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    woodAt(s, 5, 0);
    strandOn(s, e, 3);

    s.step();
    expect(s.world.has(e, Stranded)).toBe(true); // parked…
    expect(s.world.get(e, PathRequest).failed).toBe(true); // …with the dead route kept as the marker

    for (let i = 0; i < 10; i++) s.step();
    expect(s.world.has(e, Stranded)).toBe(true); // still parked mid-pace — no thrashing retries
    expect(s.world.has(e, CurrentAtomic)).toBe(false);

    // After the retry pace it re-plans: the woodcutter walks off and starts chopping the tree.
    let harvesting = false;
    for (let i = 0; i < 200 && !harvesting; i++) {
      s.step();
      harvesting = s.world.tryGet(e, CurrentAtomic)?.effect.kind === 'harvest';
    }
    expect(harvesting).toBe(true);
    expect(s.world.has(e, Stranded)).toBe(false);
  });

  it('a fresh move order ends the park at once — the marker never outlives the cancel', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    strandOn(s, e, 3);
    s.step();
    expect(s.world.has(e, Stranded)).toBe(true); // parked

    orderMove(s, e, 2, 0); // moveUnit clears PathRequest directly (keeps PathFollow) — Stranded must go too
    s.step();
    expect(s.world.has(e, Stranded)).toBe(false); // no stale pacing left to skip the NEXT park
    expect(s.world.has(e, MoveGoal)).toBe(true); // and the ordered walk starts immediately
  });

  it("leaves the failure signal of a drive with its own protocol alone (a player order's walk)", () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    woodAt(s, 5, 0);
    s.world.add(e, PlayerOrder, {});
    strandOn(s, e, 3);

    aiSystem(s.world, ctxOf(s));

    expect(s.world.has(e, Stranded)).toBe(false); // not parked —
    expect(s.world.get(e, PathRequest).failed).toBe(true); // the playerOrderSystem reads this itself
  });
});
