import { describe, expect, it } from 'vitest';
import {
  Armor,
  CurrentAtomic,
  DEFAULT_WORK_FLAG_RADIUS,
  DeliveryFlag,
  Equipment,
  JobAssignment,
  MoveGoal,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
  Stranded,
  SupplyRun,
  Weapon,
  WorkFlag,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, nodeOfPosition } from '../../../src/index.js';
import { setJob } from '../../../src/systems/index.js';
import { ctxOf } from '../../fixtures/context.js';
import { CARPENTER, orderMove, ownedWoodcutter, sim, VIKING, WOOD, WOODCUTTER, woodAt } from './support.js';

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

  it('unsticks a stranded settler and abandons its supply errand (the reset the player reaches for)', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    // A frozen worker: its walk failed (parked by the planner's stranded recovery) mid supply errand.
    s.world.add(e, MoveGoal, { cell: 3 });
    s.world.add(e, PathRequest, { start: 0, goal: 3, failed: true });
    s.world.add(e, Stranded, { retryAt: 9999 });
    s.world.add(e, SupplyRun, { site: 999 as Entity, goodType: WOOD, amount: 1 });

    setJob(s.world, ctxOf(s), { kind: 'setJob', entity: e, jobType: CARPENTER });

    expect(s.world.has(e, MoveGoal)).toBe(false); // the whole nav state resets at once…
    expect(s.world.has(e, PathRequest)).toBe(false);
    expect(s.world.has(e, Stranded)).toBe(false); // …including the stranded-retry pacing
    expect(s.world.has(e, SupplyRun)).toBe(false); // the site stops counting the errand as inbound
  });
});

describe('setJob disarm on leaving the fighter trades', () => {
  const SOLDIER_JOB = 31; // jobtypes.ini soldier band 31..41 — isFighterJob's lower bound
  const SWORD_GOOD = 44;

  it('a soldier converted to a civilian trade sheds its arms (equipment slots + combat components)', () => {
    // The render draws the armed look from the equipped weapon good over the job, so a kept weapon
    // froze an ex-soldier in the warrior skin (the reported soldier→civilian/scout stale-skin bug).
    const s = sim();
    const e = ownedWoodcutter(s, 0, 0);
    s.world.get(e, Settler).jobType = SOLDIER_JOB;
    s.world.add(e, Weapon, { weaponTypeId: 3 });
    s.world.add(e, Armor, { armorClass: 2 });
    s.world.add(e, Equipment, {
      boots: { goodType: 30, degreeOfUse: fx.fromInt(0) },
      tool: null,
      weapon: { goodType: SWORD_GOOD, degreeOfUse: fx.fromInt(0) },
      armor: { goodType: 50, degreeOfUse: fx.fromInt(0) },
      misc: [null, null, null, null],
    });

    s.enqueue({ kind: 'setJob', entity: e, jobType: CARPENTER });
    s.step();
    expect(s.world.get(e, Settler).jobType).toBe(CARPENTER);
    expect(s.world.has(e, Weapon)).toBe(false);
    expect(s.world.has(e, Armor)).toBe(false);
    const equipment = s.world.get(e, Equipment);
    expect(equipment.weapon).toBeNull();
    expect(equipment.armor).toBeNull();
    expect(equipment.boots).toEqual({ goodType: 30, degreeOfUse: fx.fromInt(0) }); // civil kit stays
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

  it('auto-plants on the nearest free field when the gatherer stands on a resource', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 2, 1);
    s.enqueue({ kind: 'setJob', entity: e, jobType: CARPENTER });
    s.step();
    const resource = woodAt(s, 2, 1);

    s.enqueue({ kind: 'setJob', entity: e, jobType: WOODCUTTER });
    s.step();

    const flag = s.world.get(e, WorkFlag).flag;
    const flagPos = s.world.get(flag, Position);
    const resourcePos = s.world.get(resource, Position);
    expect(nodeOfPosition(flagPos.x, flagPos.y)).not.toEqual(nodeOfPosition(resourcePos.x, resourcePos.y));
  });

  it('clears a resource filter that the new gathering trade cannot harvest', () => {
    const s = sim();
    const e = ownedWoodcutter(s, 2, 1);
    s.enqueue({ kind: 'setJob', entity: e, jobType: WOODCUTTER });
    s.step();
    s.enqueue({ kind: 'setGatherGood', entity: e, goodType: 1 });
    s.step();
    expect(s.world.get(e, WorkFlag).goodType).toBe(1);

    s.enqueue({ kind: 'setJob', entity: e, jobType: 5 }); // miner: stone only
    s.step();

    expect(s.world.get(e, WorkFlag).goodType).toBeUndefined();
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
