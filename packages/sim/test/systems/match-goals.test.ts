import { describe, expect, it } from 'vitest';
import {
  Age,
  Female,
  type MatchGoal,
  markPlayerDead,
  Owner,
  raiseMissionGoal,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type SimEvent,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import {
  MATCH_DEATH_CHECK_INTERVAL_TICKS,
  MATCH_DEATH_GRACE_TICKS,
  MATCH_GOAL_CHECK_TICKS,
  matchSystem,
} from '../../src/systems/match/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { eventsUntil, firingSim, HEADQUARTERS, POINT, SOLDIER, VIKING } from '../missions/support.js';

const WOOD = 1;
/** The fixture headquarters opens with this much wood before any authored stock. */
const HQ_OPENING_WOOD = 10;
const FIRST_CHECK = MATCH_GOAL_CHECK_TICKS;
const SECOND_CHECK = 2 * MATCH_GOAL_CHECK_TICKS;
/** Every setup command has applied by then. */
const PLACED = 2;

function lcm(a: number, b: number): number {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  const both = (a * b) / gcd(a, b);
  if (both < MATCH_DEATH_GRACE_TICKS) throw new Error('the cadences meet inside the grace period');
  return both;
}

function goalsSim(
  players: readonly number[],
  goals: readonly MatchGoal[],
  sim?: Simulation,
  goalSeats: readonly number[] = [],
): Simulation {
  const world = sim ?? new Simulation({ seed: 1, content: testContent() });
  world.enqueueSetup({ kind: 'setMatchParticipants', players, victory: 'goals', goals, goalSeats });
  world.step();
  return world;
}

function check(sim: Simulation, tick: number): readonly SimEvent[] {
  const before = sim.events.current().length;
  matchSystem(sim.world, { ...ctxOf(sim), tick });
  return sim.events.current().slice(before);
}

function verdicts(events: readonly SimEvent[]): readonly SimEvent[] {
  return events.filter((event) => event.kind === 'playerWon' || event.kind === 'playerDefeated');
}

function man(sim: Simulation, player: number, jobType: number | null = null): Entity {
  const e = settlerAt(sim, { jobType });
  sim.world.add(e, Owner, { player });
  return e;
}

function restore(sim: Simulation): Simulation {
  return restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
    content: sim.content,
  });
}

describe('multiplayer goal table', () => {
  it('decides only on a check tick, and only the seat a raised row names', () => {
    const sim = goalsSim([0, 1], [{ kind: 'wonByMission' }]);
    raiseMissionGoal(sim.world, 0, 'won');
    expect(verdicts(check(sim, FIRST_CHECK - 1))).toEqual([]);
    expect(sim.matchOutcome(0)).toBe('undecided');
    expect(verdicts(check(sim, FIRST_CHECK))).toEqual([{ kind: 'playerWon', player: 0 }]);
    expect(sim.matchOutcome(0)).toBe('victory');
    expect(sim.matchOutcome(1)).toBe('undecided');
    expect(sim.matchEnded()).toBe(false);
    expect(verdicts(check(sim, SECOND_CHECK))).toEqual([]);
  });

  it('loses a seat its script failed, and ignores a verdict no row waits for', () => {
    const sim = goalsSim([0, 1], [{ kind: 'lostByMission' }]);
    raiseMissionGoal(sim.world, 1, 'lost');
    raiseMissionGoal(sim.world, 0, 'won');
    expect(verdicts(check(sim, FIRST_CHECK))).toEqual([{ kind: 'playerDefeated', player: 1 }]);
    expect(sim.matchOutcome(1)).toBe('defeat');
    expect(sim.matchOutcome(0)).toBe('undecided');
  });

  it('loses a dead seat before any row, and keeps a won seat won after it dies', () => {
    const sim = goalsSim([0, 1], [{ kind: 'wonByMission' }]);
    raiseMissionGoal(sim.world, 0, 'won');
    raiseMissionGoal(sim.world, 1, 'won');
    markPlayerDead(sim.world, 1);
    expect(verdicts(check(sim, FIRST_CHECK))).toEqual([
      { kind: 'playerWon', player: 0 },
      { kind: 'playerDefeated', player: 1 },
    ]);
    markPlayerDead(sim.world, 0);
    check(sim, SECOND_CHECK);
    expect(sim.matchOutcome(0)).toBe('victory');
    expect(sim.matchEnded()).toBe(true);
  });

  it('announces a death only through the table, on its next check', () => {
    const sim = goalsSim([0, 1], []);
    man(sim, 0);
    // The first tick past the death check's grace that both cadences land on.
    const both = lcm(MATCH_DEATH_CHECK_INTERVAL_TICKS, MATCH_GOAL_CHECK_TICKS);
    expect(verdicts(check(sim, both))).toEqual([{ kind: 'playerDefeated', player: 1 }]);
    expect(sim.matchOutcome(0)).toBe('undecided');
  });

  it('wins on goods the seat holds in its houses, every listed good at once', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    for (const [owner, amount, at] of [
      [0, 6, POINT],
      [0, 4, { hx: POINT.hx + 8, hy: POINT.hy }],
      [1, 9, { hx: POINT.hx, hy: POINT.hy + 8 }],
    ] as const) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HEADQUARTERS,
        tribe: VIKING,
        x: at.hx,
        y: at.hy,
        force: true,
        owner,
        initialGoods: [{ good: WOOD, amount }],
      });
    }
    sim.run(PLACED);
    // Seat 0 holds exactly the amount over its two houses; seat 1's one house falls short.
    const amount = 2 * HQ_OPENING_WOOD + 6 + 4;
    goalsSim([0, 1, 2], [{ kind: 'goods', goods: [{ good: WOOD, amount }] }], sim);
    expect(verdicts(check(sim, FIRST_CHECK))).toEqual([{ kind: 'playerWon', player: 0 }]);

    const empty = goalsSim([0], [{ kind: 'goods', goods: [] }]);
    expect(verdicts(check(empty, FIRST_CHECK))).toEqual([{ kind: 'playerWon', player: 0 }]);
  });

  it('counts every inhabitant, or the adult men in a soldier job', () => {
    const populate = (sim: Simulation): void => {
      man(sim, 0, SOLDIER);
      sim.world.add(man(sim, 0, SOLDIER), Female, { female: true });
      sim.world.add(man(sim, 0, SOLDIER), Age, { ticks: 0, asOf: null });
      man(sim, 1, SOLDIER);
      man(sim, 1, SOLDIER);
    };
    const soldiers = goalsSim([0, 1], [{ kind: 'inhabitants', count: 2, soldiers: true }]);
    populate(soldiers);
    expect(verdicts(check(soldiers, FIRST_CHECK))).toEqual([{ kind: 'playerWon', player: 1 }]);
    const everyone = goalsSim([0, 1], [{ kind: 'inhabitants', count: 3, soldiers: false }]);
    populate(everyone);
    expect(verdicts(check(everyone, FIRST_CHECK))).toEqual([{ kind: 'playerWon', player: 0 }]);
    const never = goalsSim([0], [{ kind: 'inhabitants', count: -1, soldiers: false }]);
    populate(never);
    expect(verdicts(check(never, FIRST_CHECK))).toEqual([]);
  });

  it('lets the seats left standing win once a rival is out, when every one of them is a friend', () => {
    const sim = goalsSim([0, 1, 2], [{ kind: 'lastStanding' }]);
    for (const [a, b] of [
      [0, 1],
      [1, 0],
    ] as const) {
      sim.enqueueSetup({ kind: 'setDiplomacy', from: a, to: b, state: 'friend' });
    }
    sim.step();
    expect(verdicts(check(sim, FIRST_CHECK))).toEqual([]);
    markPlayerDead(sim.world, 2);
    expect(verdicts(check(sim, SECOND_CHECK))).toEqual([
      { kind: 'playerWon', player: 0 },
      { kind: 'playerWon', player: 1 },
      { kind: 'playerDefeated', player: 2 },
    ]);
    expect(sim.matchRules()).toEqual({ participants: [0, 1, 2], victory: 'goals', lastStanding: true });
  });

  it('takes a script verdict as the row it raises, announced at the next check', () => {
    const waiting = firingSim([{ opcode: 'MissionWon', player: 0 }]);
    goalsSim([0, 1], [{ kind: 'wonByMission' }], waiting);
    const won = eventsUntil(waiting, SECOND_CHECK, ['playerWon']);
    expect(won.map(({ event }) => event)).toEqual([{ kind: 'playerWon', player: 0 }]);
    expect(won[0]?.tick).toBe(FIRST_CHECK);
    expect(waiting.matchOutcome(0)).toBe('victory');

    const unread = firingSim([{ opcode: 'MissionWon', player: 0 }]);
    goalsSim([0, 1], [{ kind: 'lostByMission' }], unread);
    expect(eventsUntil(unread, SECOND_CHECK, ['playerWon', 'playerDefeated'])).toEqual([]);
    expect(unread.matchOutcome(0)).toBe('undecided');
  });

  it('decides a seat that cannot die by its rows alone, and ends the match on the participants', () => {
    const sim = goalsSim([1], [{ kind: 'wonByMission' }], undefined, [0]);
    man(sim, 1);
    raiseMissionGoal(sim.world, 0, 'won');
    expect(verdicts(check(sim, lcm(MATCH_DEATH_CHECK_INTERVAL_TICKS, MATCH_GOAL_CHECK_TICKS)))).toEqual([
      { kind: 'playerWon', player: 0 },
    ]);
    expect(sim.matchEnded()).toBe(false);
    const lonely = goalsSim([1], [{ kind: 'lastStanding' }], undefined, [0]);
    markPlayerDead(lonely.world, 1);
    expect(verdicts(check(lonely, FIRST_CHECK))).toEqual([{ kind: 'playerDefeated', player: 1 }]);
    expect(lonely.matchEnded()).toBe(true);
  });

  it('checks a table whose only seats cannot die', () => {
    const sim = goalsSim([], [{ kind: 'wonByMission' }], undefined, [0]);
    raiseMissionGoal(sim.world, 0, 'won');
    expect(verdicts(check(sim, FIRST_CHECK))).toEqual([{ kind: 'playerWon', player: 0 }]);
  });

  it('saves the table, its raised rows and its verdicts', () => {
    const sim = goalsSim(
      [0, 1],
      [{ kind: 'wonByMission' }, { kind: 'goods', goods: [{ good: WOOD, amount: 5 }] }],
    );
    raiseMissionGoal(sim.world, 1, 'won');
    markPlayerDead(sim.world, 0);
    const loaded = restore(sim);
    expect(loaded.hashState()).toBe(sim.hashState());
    expect(loaded.matchRules()).toEqual({ participants: [0, 1], victory: 'goals', lastStanding: false });
    check(sim, FIRST_CHECK);
    check(loaded, FIRST_CHECK);
    expect(loaded.hashState()).toBe(sim.hashState());
    expect([loaded.matchOutcome(0), loaded.matchOutcome(1)]).toEqual(['defeat', 'victory']);
    expect(restore(loaded).matchEnded()).toBe(true);
  });

  it('drops the table when the match switches to another rule', () => {
    const sim = goalsSim([0, 1], [{ kind: 'wonByMission' }]);
    raiseMissionGoal(sim.world, 0, 'won');
    sim.enqueueSetup({ kind: 'setMatchParticipants', players: [0, 1], victory: 'script' });
    sim.step();
    check(sim, FIRST_CHECK);
    expect(sim.matchOutcome(0)).toBe('undecided');
    expect(sim.matchRules().victory).toBe('script');
  });
});
