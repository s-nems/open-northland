import { describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  MoveGoal,
  PathRequest,
  Resource,
  Stranded,
  UnreachableGoals,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import type { NodeId, Simulation } from '../../src/index.js';
import {
  noteUnreachableGoal,
  UNREACHABLE_GOAL_MEMO_SIZE,
  UNREACHABLE_GOAL_MEMO_TICKS,
  unreachableGoals,
} from '../../src/systems/agents/unreachable-goals.js';
import type { SystemContext } from '../../src/systems/index.js';
import { ownedWoodcutter, sim, woodAt } from '../conflict/orders/support.js';
import { ctxOf } from '../fixtures/context.js';

/**
 * The failed-goal memo: a settler whose route fails must not re-choose the same target on its next
 * plan. Without it the planner's deterministic nearest-first pick returns the identical unreachable
 * node every retry, and the settler loops park→re-pick→fail forever — observed on a real map as an AI
 * clay collector idle from tick ~20k with 50 routable deposits inside its own flag radius.
 */

const cell = (id: number): NodeId => id as unknown as NodeId;

/** `ctxOf` reads the sim's live tick; the memo's expiry needs an arbitrary one. */
function ctxAt(s: Simulation, tick: number): SystemContext {
  return { ...ctxOf(s), tick };
}

describe('the failed-goal memo', () => {
  it('remembers a failed goal until it expires', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    noteUnreachableGoal(s.world, ctxAt(s, 0), e, cell(42));

    expect(unreachableGoals(s.world, ctxAt(s, 0), e)?.has(cell(42))).toBe(true);
    expect(unreachableGoals(s.world, ctxAt(s, UNREACHABLE_GOAL_MEMO_TICKS - 1), e)).not.toBeNull();
    expect(unreachableGoals(s.world, ctxAt(s, UNREACHABLE_GOAL_MEMO_TICKS), e)).toBeNull();
  });

  it('remembers several goals, so a settler ringed by walled-off targets cannot cycle between two', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    const ctx = ctxAt(s, 0);
    noteUnreachableGoal(s.world, ctx, e, cell(1));
    noteUnreachableGoal(s.world, ctx, e, cell(2));

    const memo = unreachableGoals(s.world, ctx, e);
    expect(memo?.has(cell(1))).toBe(true);
    expect(memo?.has(cell(2))).toBe(true);
  });

  it('caps the memo, evicting the least recent failure', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    const ctx = ctxAt(s, 0);
    for (let i = 0; i <= UNREACHABLE_GOAL_MEMO_SIZE; i++) noteUnreachableGoal(s.world, ctx, e, cell(i));

    const memo = unreachableGoals(s.world, ctx, e);
    expect(memo?.size).toBe(UNREACHABLE_GOAL_MEMO_SIZE);
    expect(memo?.has(cell(0))).toBe(false); // the oldest went
    expect(memo?.has(cell(UNREACHABLE_GOAL_MEMO_SIZE))).toBe(true); // the newest stayed
  });

  it('refreshes a re-noted goal instead of storing it twice', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    noteUnreachableGoal(s.world, ctxAt(s, 0), e, cell(7));
    noteUnreachableGoal(s.world, ctxAt(s, 10), e, cell(7));

    expect(s.world.get(e, UnreachableGoals).entries).toHaveLength(1);
    // Its deadline moved with the second failure, so it outlives the first note's window.
    expect(unreachableGoals(s.world, ctxAt(s, UNREACHABLE_GOAL_MEMO_TICKS + 5), e)?.has(cell(7))).toBe(true);
  });
});

/** Drive the sim until `done`, or fail loudly — a silent timeout would read as a passing assertion. */
function stepUntil(s: ReturnType<typeof sim>, limit: number, done: () => boolean): void {
  for (let i = 0; i < limit && !done(); i++) s.step();
  if (!done()) throw new Error(`condition not reached within ${limit} ticks`);
}

function harvestedResource(s: ReturnType<typeof sim>, e: Entity): Entity | null {
  const atomic = s.world.tryGet(e, CurrentAtomic);
  return atomic?.effect.kind === 'harvest' ? atomic.effect.resource : null;
}

describe('the gatherer re-plan after a failed route', () => {
  it('moves on to the next tree instead of re-choosing the one it could not reach', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    const near = woodAt(s, 3, 0);
    const far = woodAt(s, 8, 0);

    // Let the planner make its own nearest-first pick, then fail exactly that route — the state
    // routing leaves behind when a goal turns out to be walled off by standing bodies.
    stepUntil(s, 20, () => s.world.has(e, MoveGoal));
    const doomed = s.world.get(e, MoveGoal).cell;
    s.world.add(e, PathRequest, { start: s.world.get(e, MoveGoal).cell, goal: doomed, failed: true });

    stepUntil(s, 400, () => harvestedResource(s, e) !== null);
    expect(harvestedResource(s, e)).toBe(far); // the reachable tree, not the doomed nearer one
    expect(s.world.get(near, Resource).remaining).toBe(5); // the doomed tree was left standing
    expect(s.world.has(e, Stranded)).toBe(false);
  });

  it('takes the skipped target back once the memo expires', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    woodAt(s, 3, 0);

    stepUntil(s, 20, () => s.world.has(e, MoveGoal));
    const doomed = s.world.get(e, MoveGoal).cell;
    s.world.add(e, PathRequest, { start: doomed, goal: doomed, failed: true });
    stepUntil(s, 100, () => s.world.has(e, UnreachableGoals));

    // With no alternative tree the settler idles while the memo holds, then resumes on expiry —
    // a transient blockage (a colleague in the only doorway) must not retire the node forever.
    stepUntil(s, UNREACHABLE_GOAL_MEMO_TICKS + 400, () => harvestedResource(s, e) !== null);
    expect(harvestedResource(s, e)).not.toBeNull();
  });
});
