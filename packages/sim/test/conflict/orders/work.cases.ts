import { describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  DEFAULT_WORK_FLAG_RADIUS,
  DeliveryFlag,
  JobAssignment,
  MoveGoal,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
  WorkFlag,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx } from '../../../src/index.js';
import { CARPENTER, orderMove, ownedWoodcutter, sim, VIKING, WOODCUTTER } from './support.js';

describe('setJob order', () => {
  it("changes an owned settler's profession and re-idles it (drops binding/action/order)", () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    // Simulate a working, bound, ordered unit, then change its job.
    s.world.add(e, JobAssignment, { workplace: 999 as Entity });
    orderMove(s, e, 3, 0);
    s.step();
    expect(s.world.has(e, PlayerOrder)).toBe(true);

    s.enqueue({ kind: 'setJob', entity: e, jobType: CARPENTER });
    s.step();
    expect(s.world.get(e, Settler).jobType).toBe(CARPENTER);
    expect(s.world.has(e, JobAssignment)).toBe(false); // re-employed at the new job by the JobSystem
    expect(s.world.has(e, PlayerOrder)).toBe(false); // profession change hands it back to the economy
    expect(s.world.has(e, CurrentAtomic)).toBe(false);
  });

  it('is skipped for an unknown job, a neutral unit, or a growing child', () => {
    const s = sim();
    const owned = ownedWoodcutter(s, 0, 0);
    s.enqueue({ kind: 'setJob', entity: owned, jobType: 999 }); // unknown job id
    s.step();
    expect(s.world.get(owned, Settler).jobType).toBe(WOODCUTTER); // unchanged

    const neutral = s.world.create();
    s.world.add(neutral, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
    s.world.add(neutral, Settler, {
      tribe: VIKING,
      jobType: WOODCUTTER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    s.enqueue({ kind: 'setJob', entity: neutral, jobType: CARPENTER }); // unowned — skipped
    s.step();
    expect(s.world.get(neutral, Settler).jobType).toBe(WOODCUTTER); // unchanged
  });
});

describe('setJob work-flag lifecycle', () => {
  it('plants a bound drop-off flag when a settler becomes a gatherer', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 2, 1);
    // A carpenter never harvests, so it carries no flag — the switch below is a real change INTO the
    // gatherer trade (the user's "zmiana zawodu na zbieracza → pojawia się flaga").
    s.enqueue({ kind: 'setJob', entity: e, jobType: CARPENTER });
    s.step();
    expect(s.world.has(e, WorkFlag)).toBe(false);

    s.enqueue({ kind: 'setJob', entity: e, jobType: WOODCUTTER });
    s.step();
    expect(s.world.has(e, WorkFlag)).toBe(true);
    const wf = s.world.get(e, WorkFlag);
    expect(wf.radius).toBe(DEFAULT_WORK_FLAG_RADIUS);
    expect(s.world.isAlive(wf.flag)).toBe(true);
    expect(s.world.has(wf.flag, DeliveryFlag)).toBe(true); // a pure marker …
    expect(s.world.has(wf.flag, Position)).toBe(true); // … planted on a tile the player can relocate
  });

  it('destroys the flag when a gatherer switches to a non-gathering trade', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 2, 1);
    s.enqueue({ kind: 'setJob', entity: e, jobType: WOODCUTTER }); // a woodcutter gets its flag
    s.step();
    const flag = s.world.get(e, WorkFlag).flag;
    expect(s.world.isAlive(flag)).toBe(true);

    s.enqueue({ kind: 'setJob', entity: e, jobType: CARPENTER }); // leaving the trade drops the flag
    s.step();
    expect(s.world.has(e, WorkFlag)).toBe(false); // binding dropped
    expect(s.world.isAlive(flag)).toBe(false); // marker destroyed — no owner-less flag left behind
  });

  it('keeps the same flag when the profession stays a gathering trade', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 2, 1);
    s.enqueue({ kind: 'setWorkFlag', entity: e, x: 6, y: 2 }); // the player plants/relocates it explicitly
    s.step();
    const flag = s.world.get(e, WorkFlag).flag;

    s.enqueue({ kind: 'setJob', entity: e, jobType: WOODCUTTER }); // re-assert the gatherer trade
    s.step();
    expect(s.world.get(e, WorkFlag).flag).toBe(flag); // same flag — no re-plant, the player's spot stands
    expect(s.world.isAlive(flag)).toBe(true);
  });
});

describe('PlayerOrder abandonment', () => {
  it('abandons the order and clears the dead nav state when the route fails (unreachable target)', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    // A target the pathfinder can never reach leaves a failed PathRequest that is never retried;
    // playerOrderSystem must free the unit rather than let it freeze forever. Set that state up
    // directly (an all-grass fixture can't produce an unreachable cell through normal routing).
    s.world.add(e, MoveGoal, { cell: 3 });
    s.world.add(e, PlayerOrder, {});
    s.world.add(e, PathRequest, { start: 0, goal: 3, failed: true });

    s.step();
    expect(s.world.has(e, PlayerOrder)).toBe(false); // order abandoned
    expect(s.world.has(e, MoveGoal)).toBe(false); // dead nav state cleared
    expect(s.world.has(e, PathRequest)).toBe(false);
  });
});
