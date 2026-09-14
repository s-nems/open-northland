import { describe, expect, it } from 'vitest';
import {
  isPlayerDead,
  MatchRules,
  markScriptVerdict,
  Owner,
  ScriptMatchRules,
  wonPlayerBits,
} from '../../src/components/index.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import {
  MATCH_DEATH_CHECK_INTERVAL_TICKS,
  MATCH_DEATH_GRACE_TICKS,
  matchSystem,
} from '../../src/systems/match/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';

const CHECK_TICK =
  Math.ceil(MATCH_DEATH_GRACE_TICKS / MATCH_DEATH_CHECK_INTERVAL_TICKS) * MATCH_DEATH_CHECK_INTERVAL_TICKS;

function fresh(players: readonly number[], victory?: 'script' | 'elimination'): Simulation {
  const sim = new Simulation({ seed: 1, content: testContent() });
  sim.enqueueSetup({ kind: 'setMatchParticipants', players, ...(victory === undefined ? {} : { victory }) });
  sim.step();
  return sim;
}

function check(sim: Simulation, tick = CHECK_TICK): void {
  matchSystem(sim.world, { ...ctxOf(sim), tick });
}

function restore(sim: Simulation): Simulation {
  return restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
    content: sim.content,
  }).sim;
}

describe('scripted match participants', () => {
  it('keeps script victory policy out of the elimination match payload and absent unless selected', () => {
    const elimination = fresh([0, 1]);
    const carrier = elimination.world.lowestEntityWith(MatchRules);
    if (carrier === null) throw new Error('declared match');
    expect(elimination.world.get(carrier, MatchRules)).toEqual({ participants: 3, dead: 0, won: 0 });
    expect(elimination.world.lowestEntityWith(ScriptMatchRules)).toBeNull();
    const scripted = fresh([0, 1], 'script');
    const scriptCarrier = scripted.world.lowestEntityWith(MatchRules);
    if (scriptCarrier === null) throw new Error('declared match');
    expect(scripted.world.get(scriptCarrier, MatchRules)).toEqual({ participants: 3, dead: 0, won: 0 });
    expect(scripted.world.lowestEntityWith(ScriptMatchRules)).not.toBeNull();
    scripted.enqueueSetup({ kind: 'setMatchParticipants', players: [0, 1], victory: 'elimination' });
    scripted.step();
    expect(restore(scripted).matchRules().victory).toBe('elimination');
  });

  it('checks one scripted seat for death without changing the elimination single-seat rule', () => {
    const script = fresh([0], 'script');
    check(script, CHECK_TICK - 1);
    expect(isPlayerDead(script.world, 0)).toBe(false);
    check(script);
    expect(isPlayerDead(script.world, 0)).toBe(true);
    expect(script.events.current().filter((event) => event.kind === 'playerDefeated')).toEqual([
      { kind: 'playerDefeated', player: 0 },
    ]);
    const single = fresh([0]);
    check(single);
    expect(isPlayerDead(single.world, 0)).toBe(false);
  });

  it('leaves the surviving seat undecided until the script awards victory', () => {
    const sim = fresh([0, 1], 'script');
    const adult = settlerAt(sim, { jobType: null });
    sim.world.add(adult, Owner, { player: 0 });
    check(sim);
    expect(isPlayerDead(sim.world, 1)).toBe(true);
    expect(wonPlayerBits(sim.world)).toBe(0);
    expect(sim.matchOutcome(0)).toBe('undecided');
    expect(sim.events.current().some((event) => event.kind === 'playerWon')).toBe(false);
    markScriptVerdict(sim.world, 0, 'won');
    expect(sim.matchOutcome(0)).toBe('victory');
    sim.world.destroy(adult);
    check(sim, CHECK_TICK + MATCH_DEATH_CHECK_INTERVAL_TICKS);
    expect(sim.matchOutcome(0)).toBe('defeat');
  });

  it('persists script mode and exposes detached setup while an unscripted world keeps elimination', () => {
    const sim = fresh([2, 0, 2], 'script');
    const view = sim.matchRules();
    expect(view).toEqual({ participants: [0, 2], victory: 'script' });
    Object.assign(view.participants, { 0: 7 });
    expect(sim.matchRules().participants).toEqual([0, 2]);
    const loaded = restore(sim);
    expect(loaded.hashState()).toBe(sim.hashState());
    expect(loaded.matchRules()).toEqual(sim.matchRules());
    check(sim);
    check(loaded);
    expect(loaded.hashState()).toBe(sim.hashState());
    expect(restore(fresh([0, 1])).matchRules()).toEqual({ participants: [0, 1], victory: 'elimination' });
  });
});
