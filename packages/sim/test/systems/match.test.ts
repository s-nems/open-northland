import { describe, expect, it } from 'vitest';
import {
  Age,
  Female,
  Health,
  MatchRules,
  matchParticipantBits,
  Owner,
  playersOfBits,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { adminCommand, playerCommand, type SimEvent, Simulation } from '../../src/index.js';
import { isAuthorized } from '../../src/systems/command/authority.js';
import { MATCH_DEATH_CHECK_INTERVAL_TICKS, MATCH_DEATH_GRACE_TICKS } from '../../src/systems/match/index.js';
import { SYSTEM_ORDER } from '../../src/systems/schedule.js';
import { testContent } from '../fixtures/content.js';
import { settlerAt } from '../fixtures/settler.js';

const P0 = 0;
const P1 = 1;
const P2 = 2;
/** The first tick the death check can fire on: past the grace minute, on the cadence. */
const FIRST_CHECK_TICK =
  Math.ceil(MATCH_DEATH_GRACE_TICKS / MATCH_DEATH_CHECK_INTERVAL_TICKS) * MATCH_DEATH_CHECK_INTERVAL_TICKS;
/** A trade-less adult: `null` is an adult with no job, never an age class. */
const ADULT = null;
const HITPOINTS = 100;

function fresh(seed = 1): Simulation {
  return new Simulation({ seed, content: testContent() });
}

interface PersonSpec {
  readonly female?: boolean;
  readonly child?: boolean;
}

/** A living, owned person; an adult man unless the spec says otherwise. */
function personOf(sim: Simulation, owner: number, spec: PersonSpec = {}): Entity {
  const e = settlerAt(sim, { jobType: ADULT });
  sim.world.add(e, Owner, { player: owner });
  sim.world.add(e, Health, { hitpoints: HITPOINTS, max: HITPOINTS });
  if (spec.female === true) sim.world.add(e, Female, { female: true });
  if (spec.child === true) sim.world.add(e, Age, { ticks: 0 });
  return e;
}

/** Step to `tick`, collecting the match events with the tick each fired on. */
function runTo(sim: Simulation, tick: number): { tick: number; event: SimEvent }[] {
  const out: { tick: number; event: SimEvent }[] = [];
  while (sim.tick < tick) {
    sim.step();
    for (const event of sim.events.current()) {
      if (event.kind === 'playerDefeated' || event.kind === 'playerWon') out.push({ tick: sim.tick, event });
    }
  }
  return out;
}

function declare(sim: Simulation, players: readonly number[]): void {
  sim.enqueueSetup({ kind: 'setMatchParticipants', players });
}

describe('matchSystem - schedule relationships', () => {
  const names = SYSTEM_ORDER.map((s) => s.name);

  it('is declared after cleanup and before the AI player', () => {
    expect(names.indexOf('cleanup')).toBeLessThan(names.indexOf('match'));
    expect(names.indexOf('match')).toBeLessThan(names.indexOf('aiPlayer'));
  });

  it('counts a man reaped on the check tick itself as already gone', () => {
    const sim = fresh();
    declare(sim, [P0, P1]);
    personOf(sim, P0);
    const doomed = personOf(sim, P1);
    runTo(sim, FIRST_CHECK_TICK - 1);
    // Applied by the command pass of the check tick, reaped by that tick's cleanup, judged the same tick.
    sim.enqueue(adminCommand({ kind: 'debugKill', target: doomed }));
    const decided = runTo(sim, FIRST_CHECK_TICK);
    expect(decided.map((e) => e.event)).toEqual([
      { kind: 'playerDefeated', player: P1 },
      { kind: 'playerWon', player: P0 },
    ]);
  });
});

describe('matchSystem - death and victory over the declared participants', () => {
  it('does nothing at all while no participants are declared', () => {
    const sim = fresh();
    personOf(sim, P0);
    const events = runTo(sim, FIRST_CHECK_TICK + MATCH_DEATH_CHECK_INTERVAL_TICKS);
    expect(events).toEqual([]);
    expect(sim.world.lowestEntityWith(MatchRules)).toBeNull();
    expect(sim.matchOutcome(P0)).toBe('undecided');
    expect(playersOfBits(matchParticipantBits(sim.world))).toEqual([]);
  });

  it('declares the valid slots only, ascending', () => {
    const sim = fresh();
    declare(sim, [P2, 99, P0, -1, P0]);
    sim.step();
    expect(playersOfBits(matchParticipantBits(sim.world))).toEqual([P0, P2]);
  });

  it('decides nothing for a lone participant, who has nobody to beat', () => {
    const sim = fresh();
    declare(sim, [P0]);
    personOf(sim, P1);
    expect(runTo(sim, FIRST_CHECK_TICK + MATCH_DEATH_CHECK_INTERVAL_TICKS)).toEqual([]);
    expect(sim.matchOutcome(P0)).toBe('undecided');
  });

  it('runs no further check once the match is decided, so a winner stays a winner', () => {
    const sim = fresh();
    declare(sim, [P0, P1]);
    const winner = personOf(sim, P0);
    const doomed = personOf(sim, P1);
    sim.enqueueSetup({ kind: 'debugKill', target: doomed });
    runTo(sim, FIRST_CHECK_TICK);
    expect(sim.matchOutcome(P0)).toBe('victory');
    sim.enqueue(adminCommand({ kind: 'debugKill', target: winner }));
    expect(runTo(sim, FIRST_CHECK_TICK + 2 * MATCH_DEATH_CHECK_INTERVAL_TICKS)).toEqual([]);
    expect(sim.matchOutcome(P0)).toBe('victory');
  });

  it('kills a seat whose last man died, exactly once, at the first check after the death', () => {
    const sim = fresh();
    declare(sim, [P0, P1]);
    personOf(sim, P0);
    const doomed = personOf(sim, P1);
    sim.enqueueSetup({ kind: 'debugKill', target: doomed });

    const early = runTo(sim, FIRST_CHECK_TICK - 1);
    expect(early).toEqual([]);
    expect(sim.matchOutcome(P1)).toBe('undecided');

    const decided = runTo(sim, FIRST_CHECK_TICK);
    expect(decided).toEqual([
      { tick: FIRST_CHECK_TICK, event: { kind: 'playerDefeated', player: P1 } },
      { tick: FIRST_CHECK_TICK, event: { kind: 'playerWon', player: P0 } },
    ]);
    expect(sim.matchOutcome(P1)).toBe('defeat');
    expect(sim.matchOutcome(P0)).toBe('victory');

    const later = runTo(sim, FIRST_CHECK_TICK + 3 * MATCH_DEATH_CHECK_INTERVAL_TICKS);
    expect(later).toEqual([]);
  });

  it('holds its fire through the grace minute, even for a seat that never had anyone', () => {
    const sim = fresh();
    declare(sim, [P0, P1]);
    personOf(sim, P0);
    expect(runTo(sim, MATCH_DEATH_GRACE_TICKS - 1)).toEqual([]);
    const decided = runTo(sim, FIRST_CHECK_TICK);
    expect(decided.map((e) => e.event)).toEqual([
      { kind: 'playerDefeated', player: P1 },
      { kind: 'playerWon', player: P0 },
    ]);
  });

  it('counts only adult men: women and children keep nobody alive', () => {
    const sim = fresh();
    declare(sim, [P0, P1, P2]);
    personOf(sim, P0);
    personOf(sim, P1, { female: true });
    personOf(sim, P2, { child: true });
    const decided = runTo(sim, FIRST_CHECK_TICK);
    expect(decided.map((e) => e.event)).toEqual([
      { kind: 'playerDefeated', player: P1 },
      { kind: 'playerDefeated', player: P2 },
      { kind: 'playerWon', player: P0 },
    ]);
  });

  it('a man a non-participant seat owns keeps that seat out of the match entirely', () => {
    const sim = fresh();
    declare(sim, [P0, P2]);
    personOf(sim, P0);
    personOf(sim, P1);
    const decided = runTo(sim, FIRST_CHECK_TICK);
    expect(decided.map((e) => e.event)).toEqual([
      { kind: 'playerDefeated', player: P2 },
      { kind: 'playerWon', player: P0 },
    ]);
    expect(sim.matchOutcome(P1)).toBe('undecided');
  });

  it('two standing seats win together only as mutual friends; a neutral pair keeps fighting', () => {
    const friends = fresh();
    declare(friends, [P0, P1, P2]);
    personOf(friends, P0);
    personOf(friends, P1);
    friends.enqueueSetup({ kind: 'setDiplomacy', from: P0, to: P1, state: 'friend' });
    friends.enqueueSetup({ kind: 'setDiplomacy', from: P1, to: P0, state: 'friend' });
    expect(runTo(friends, FIRST_CHECK_TICK).map((e) => e.event)).toEqual([
      { kind: 'playerDefeated', player: P2 },
      { kind: 'playerWon', player: P0 },
      { kind: 'playerWon', player: P1 },
    ]);

    const rivals = fresh();
    declare(rivals, [P0, P1, P2]);
    personOf(rivals, P0);
    personOf(rivals, P1);
    rivals.enqueueSetup({ kind: 'setDiplomacy', from: P0, to: P1, state: 'friend' });
    rivals.enqueueSetup({ kind: 'setDiplomacy', from: P1, to: P0, state: 'neutral' });
    expect(runTo(rivals, FIRST_CHECK_TICK).map((e) => e.event)).toEqual([
      { kind: 'playerDefeated', player: P2 },
    ]);
    expect(rivals.matchOutcome(P0)).toBe('undecided');
  });

  it('a later peace between the last standing seats decides the match at the next check', () => {
    const sim = fresh();
    declare(sim, [P0, P1, P2]);
    personOf(sim, P0);
    personOf(sim, P1);
    expect(runTo(sim, FIRST_CHECK_TICK).map((e) => e.event)).toEqual([
      { kind: 'playerDefeated', player: P2 },
    ]);
    sim.enqueue(adminCommand({ kind: 'setDiplomacy', from: P0, to: P1, state: 'friend' }));
    sim.enqueue(adminCommand({ kind: 'setDiplomacy', from: P1, to: P0, state: 'friend' }));
    const decided = runTo(sim, FIRST_CHECK_TICK + MATCH_DEATH_CHECK_INTERVAL_TICKS);
    expect(decided.map((e) => e.event)).toEqual([
      { kind: 'playerWon', player: P0 },
      { kind: 'playerWon', player: P1 },
    ]);
  });

  it('never hands friends from the start a win nobody had to earn', () => {
    const sim = fresh();
    declare(sim, [P0, P1]);
    personOf(sim, P0);
    personOf(sim, P1);
    sim.enqueueSetup({ kind: 'setDiplomacy', from: P0, to: P1, state: 'friend' });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: P1, to: P0, state: 'friend' });
    expect(runTo(sim, FIRST_CHECK_TICK + 2 * MATCH_DEATH_CHECK_INTERVAL_TICKS)).toEqual([]);
    expect(sim.matchOutcome(P0)).toBe('undecided');
  });

  it('refuses a dead seat its own orders and lets the standing seat keep commanding', () => {
    const sim = fresh();
    declare(sim, [P0, P1]);
    const winner = personOf(sim, P0);
    const doomed = personOf(sim, P1);
    sim.enqueueSetup({ kind: 'debugKill', target: doomed });
    const survivorOfP1 = personOf(sim, P1, { female: true });
    runTo(sim, FIRST_CHECK_TICK);
    expect(sim.matchOutcome(P1)).toBe('defeat');

    const deadOrder = playerCommand(P1, { kind: 'setStance', entity: survivorOfP1, mode: 0 });
    const liveOrder = playerCommand(P0, { kind: 'setStance', entity: winner, mode: 0 });
    expect(isAuthorized(sim.world, deadOrder)).toBe(false);
    expect(isAuthorized(sim.world, liveOrder)).toBe(true);
  });

  it('decides on the same tick for the same seed', () => {
    const run = (): { tick: number; event: SimEvent }[] => {
      const sim = fresh(11);
      declare(sim, [P0, P1]);
      personOf(sim, P0);
      const doomed = personOf(sim, P1);
      sim.enqueueSetup({ kind: 'debugKill', target: doomed });
      return runTo(sim, FIRST_CHECK_TICK + MATCH_DEATH_CHECK_INTERVAL_TICKS);
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.length).toBe(2);
  });
});
