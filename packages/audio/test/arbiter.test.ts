import { describe, expect, it } from 'vitest';
import { JINGLE_BIRTH, JINGLE_DEATH, JINGLE_DUCK_HOLD_MS, JINGLE_WON } from '../src/data/bindings.js';
import {
  JINGLE_COOLDOWN_MAX_S,
  JINGLE_PENDING_MAX_AGE_S,
  type OneShot,
  OneShotArbiter,
  SFX_BURST,
  SFX_STARTS_PER_S,
  VOICE_BURST,
} from '../src/index.js';
import { battleEvents, battleShots, battleSnapshot } from './helpers/battle.js';

/**
 * The arbiter rations a frame's one-shots by lane: jingles one at a time with a cooldown that grows
 * while a type keeps firing, voices and SFX from a rate budget loudest first, and everything without a
 * lane untouched. Time is the audio clock, passed in. Voice and SFX shots come from the director's
 * fixture battle, so the tests meet the shapes play produces.
 */

function jingle(musicType: number, key: string): OneShot {
  const duckMusicMs = JINGLE_DUCK_HOLD_MS.get(musicType);
  return {
    files: [`jingles/${musicType}.wav`],
    gain: 0.9,
    pan: 0,
    key,
    lane: { kind: 'jingle', musicType },
    ...(duckMusicMs === undefined ? {} : { duckMusicMs }),
  };
}

const BIRTH_S = (JINGLE_DUCK_HOLD_MS.get(JINGLE_BIRTH) ?? 0) / 1000;

describe('jingle lane', () => {
  it('swallows a repeat of a type still ringing and rings it again once its cooldown has passed', () => {
    const arbiter = new OneShotArbiter();
    expect(arbiter.decide([jingle(JINGLE_BIRTH, 'born:1')], 0)).toHaveLength(1);
    expect(arbiter.decide([jingle(JINGLE_BIRTH, 'born:2')], 1)).toHaveLength(0);
    expect(arbiter.decide([], 2)).toHaveLength(0); // a swallowed repeat never rings late
    expect(arbiter.decide([jingle(JINGLE_BIRTH, 'born:3')], BIRTH_S + 0.1)).toHaveLength(1);
  });

  it('thins a steady stream of births to a reminder a minute, and rings the first after a quiet spell at once', () => {
    const arbiter = new OneShotArbiter();
    const rang: number[] = [];
    const period = 4;
    for (let t = 0; t <= 600; t += period) {
      if (arbiter.decide([jingle(JINGLE_BIRTH, `born:${t}`)], t).length > 0) rang.push(t);
    }
    // The gaps grow from the jingle's own length towards the cap and then hold there.
    const gaps = rang.slice(1).map((t, i) => t - (rang[i] ?? 0));
    expect(gaps.slice(0, 3)).toEqual([4, 8, 16]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(JINGLE_COOLDOWN_MAX_S + period);
    expect(gaps.slice(-3).every((gap) => gap >= JINGLE_COOLDOWN_MAX_S)).toBe(true);
    expect(rang.length).toBeLessThan(20);
    // Quiet for a long while: the next birth rings at once, back at the short cooldown.
    const quiet = 600 + 3 * JINGLE_COOLDOWN_MAX_S;
    expect(arbiter.decide([jingle(JINGLE_BIRTH, 'born:late')], quiet)).toHaveLength(1);
    expect(arbiter.decide([jingle(JINGLE_BIRTH, 'born:later')], quiet + BIRTH_S + 0.1)).toHaveLength(1);
  });

  it('rings a death over a birth still sounding, and a birth waits for a death to end', () => {
    const arbiter = new OneShotArbiter();
    expect(arbiter.decide([jingle(JINGLE_BIRTH, 'born:1')], 0)).toHaveLength(1);
    const over = arbiter.decide([jingle(JINGLE_DEATH, 'died:1')], 1);
    expect(over.map((s) => s.key)).toEqual(['died:1']);
    // A fresh birth arrives while the death rings: it waits, then rings when the lane frees.
    expect(arbiter.decide([jingle(JINGLE_BIRTH, 'born:2')], BIRTH_S + 0.2)).toHaveLength(0);
    const deathEnd = 1 + (JINGLE_DUCK_HOLD_MS.get(JINGLE_DEATH) ?? 0) / 1000;
    expect(arbiter.decide([], deathEnd - 0.1)).toHaveLength(0);
    expect(arbiter.decide([], deathEnd + 0.1).map((s) => s.key)).toEqual(['born:2']);
  });

  it('orders one frame by rank, so the verdict rings first and the lesser ones wait', () => {
    const arbiter = new OneShotArbiter();
    const frame = [jingle(JINGLE_BIRTH, 'born:1'), jingle(JINGLE_WON, 'won'), jingle(JINGLE_DEATH, 'died:1')];
    expect(arbiter.decide(frame, 0).map((s) => s.key)).toEqual(['won']);
    const wonEnd = (JINGLE_DUCK_HOLD_MS.get(JINGLE_WON) ?? 0) / 1000;
    // Both waited too long for the lane: the won jingle outlives the pending age, so neither rings.
    expect(JINGLE_PENDING_MAX_AGE_S).toBeLessThan(wonEnd);
    expect(arbiter.decide([], wonEnd + 0.1)).toHaveLength(0);
  });

  it('rings the highest-ranked waiting jingle first once the lane frees', () => {
    const arbiter = new OneShotArbiter();
    expect(arbiter.decide([jingle(JINGLE_WON, 'won')], 0)).toHaveLength(1);
    const wonEnd = (JINGLE_DUCK_HOLD_MS.get(JINGLE_WON) ?? 0) / 1000;
    const late = wonEnd - 1;
    expect(
      arbiter.decide([jingle(JINGLE_BIRTH, 'born:1'), jingle(JINGLE_DEATH, 'died:1')], late),
    ).toHaveLength(0);
    expect(arbiter.decide([], wonEnd + 0.1).map((s) => s.key)).toEqual(['died:1']);
    const deathEnd = wonEnd + 0.1 + (JINGLE_DUCK_HOLD_MS.get(JINGLE_DEATH) ?? 0) / 1000;
    expect(arbiter.decide([], deathEnd + 0.1).map((s) => s.key)).toEqual(['born:1']);
  });

  it('keeps only the latest waiting instance of a type', () => {
    const arbiter = new OneShotArbiter();
    expect(arbiter.decide([jingle(JINGLE_DEATH, 'died:1')], 0)).toHaveLength(1);
    arbiter.decide([jingle(JINGLE_BIRTH, 'born:1')], 1);
    arbiter.decide([jingle(JINGLE_BIRTH, 'born:2')], 2);
    const deathEnd = (JINGLE_DUCK_HOLD_MS.get(JINGLE_DEATH) ?? 0) / 1000;
    expect(arbiter.decide([], deathEnd + 0.1).map((s) => s.key)).toEqual(['born:2']);
  });
});

describe('sfx and voice lanes', () => {
  const snapshot = battleSnapshot(40);
  const battle = battleShots(snapshot, battleEvents(40));
  const lane = (shots: readonly OneShot[], kind: 'voice' | 'sfx') =>
    shots.filter((s) => s.lane?.kind === kind);

  it('counts every scream against the voice budget and every body blow against the sfx budget', () => {
    // The director's own shapes: screams and body blows hold their wav exclusive, and still pay.
    expect(lane(battle, 'voice').length).toBeGreaterThan(VOICE_BURST);
    expect(lane(battle, 'voice').every((s) => s.exclusive === 'wav')).toBe(true);
    expect(lane(battle, 'sfx').some((s) => s.exclusive === 'wav')).toBe(true);
    const started = new OneShotArbiter().decide(battle, 0);
    expect(lane(started, 'voice').length).toBeLessThanOrEqual(VOICE_BURST);
    expect(lane(started, 'sfx').length).toBeLessThanOrEqual(SFX_BURST);
  });

  it('starts the loudest of a burst and refills by the rate, no more', () => {
    const arbiter = new OneShotArbiter();
    const started = lane(arbiter.decide(battle, 0), 'sfx');
    const gains = lane(battle, 'sfx')
      .map((s) => s.gain)
      .sort((a, b) => b - a);
    expect(Math.min(...started.map((s) => s.gain))).toBeGreaterThanOrEqual(gains[SFX_BURST - 1] ?? 0);
    const later = 0.5;
    expect(lane(arbiter.decide(battle, later), 'sfx').length).toBeLessThanOrEqual(
      Math.floor(SFX_STARTS_PER_S * later),
    );
  });

  it('rations voices separately from sfx', () => {
    const started = new OneShotArbiter().decide(battle, 0);
    expect(lane(started, 'voice').length).toBeGreaterThan(0);
    expect(lane(started, 'sfx').length).toBeGreaterThan(VOICE_BURST);
  });

  it('never rations an order answer: it has no lane and always plays', () => {
    const shots = battleShots(snapshot, battleEvents(40), { responses: [2] });
    const answers = shots.filter((s) => s.key.startsWith('respond:'));
    expect(answers).toHaveLength(1);
    expect(answers[0]?.lane).toBeUndefined();
    expect(new OneShotArbiter().decide(shots, 0).map((s) => s.key)).toContain(answers[0]?.key);
  });
});
