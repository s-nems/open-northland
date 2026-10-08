import { describe, expect, it } from 'vitest';
import { JINGLE_BIRTH, JINGLE_DEATH, JINGLE_DUCK_HOLD_MS, JINGLE_WON } from '../src/data/bindings.js';
import {
  DEFAULT_CLIP_LENGTH_S,
  GAIN_JITTER_DB,
  KEY_COOLDOWN_S,
  NO_REPEAT_FREE_CHOICES,
  noRepeatDepth,
  POOL_INSTANCE_CAP,
  POOL_RETRIGGER_S,
  RATE_JITTER,
  WORLD_VOICE_CAP,
} from '../src/data/one-shot-ledger.js';
import {
  JINGLE_COOLDOWN_MAX_S,
  JINGLE_PENDING_MAX_AGE_S,
  type OneShot,
  OneShotArbiter,
  SFX_BURST,
  SFX_STARTS_PER_S,
  VOICE_BURST,
  VOICE_STARTS_PER_S,
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

function lane(shots: readonly OneShot[], kind: 'voice' | 'sfx'): OneShot[] {
  return shots.filter((s) => s.lane?.kind === kind);
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
  const FRAME_S = 1 / 60;

  it('counts every scream against the voice budget and every body blow against the sfx budget', () => {
    // The director's own shapes: screams and body blows hold their wav exclusive, and still pay.
    expect(lane(battle, 'voice').length).toBeGreaterThan(VOICE_BURST);
    expect(lane(battle, 'voice').every((s) => s.exclusive === 'wav')).toBe(true);
    expect(lane(battle, 'sfx').some((s) => s.exclusive === 'wav')).toBe(true);
    const arbiter = new OneShotArbiter();
    const started: OneShot[] = [];
    for (let t = 0; t < 1; t += FRAME_S) started.push(...arbiter.decide(battle, t));
    expect(lane(started, 'voice').length).toBeLessThanOrEqual(VOICE_BURST + VOICE_STARTS_PER_S);
    expect(lane(started, 'sfx').length).toBeLessThanOrEqual(SFX_BURST + SFX_STARTS_PER_S);
  });

  it('starts the loudest shot of each pool, and rations voices separately from sfx', () => {
    const started = new OneShotArbiter().decide(battle, 0);
    for (const kind of ['voice', 'sfx'] as const) {
      const pools = new Set(lane(battle, kind).map((s) => s.files));
      expect(lane(started, kind)).toHaveLength(
        Math.min(pools.size, kind === 'voice' ? VOICE_BURST : SFX_BURST),
      );
      for (const shot of lane(started, kind)) {
        const pool = lane(battle, kind).find((s) => s.key === shot.key)?.files;
        const rivals = lane(battle, kind).filter((s) => s.files === pool);
        const offered = rivals.find((s) => s.key === shot.key);
        expect(offered?.gain).toBe(Math.max(...rivals.map((s) => s.gain)));
      }
    }
  });

  it('never rations an order answer: it has no lane and always plays', () => {
    const shots = battleShots(snapshot, battleEvents(40), { responses: [{ members: [2] }] });
    const answers = shots.filter((s) => s.key.startsWith('respond:'));
    expect(answers).toHaveLength(1);
    expect(answers[0]?.lane).toBeUndefined();
    expect(new OneShotArbiter().decide(shots, 0).map((s) => s.key)).toContain(answers[0]?.key);
  });
});

/** A synthetic pool: shots of one group share the array, as the director's do. */
function wavPool(name: string, size: number): readonly string[] {
  return Array.from({ length: size }, (_, i) => `${name}${i + 1}.wav`);
}

function worldShot(
  files: readonly string[],
  key: string,
  gain: number,
  kind: 'voice' | 'sfx' = 'sfx',
): OneShot {
  return { files, gain, pan: 0, key, lane: { kind } };
}

/** A [0,1) source cycling through `values`, so a test can steer the picks. */
function cycling(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

describe('wav picks', () => {
  it('hands the engine one wav and never repeats the pool`s last ones', () => {
    for (const size of [1, 2, 3, 10]) {
      const files = wavPool(`p${size}-`, size);
      const arbiter = new OneShotArbiter({ random: cycling([0, 0.99, 0.5, 0.25, 0.75]) });
      const picks: string[] = [];
      for (let i = 0; i < 40; i++) {
        const [started] = arbiter.decide([{ files, gain: 1, pan: 0, key: `answer:${i}` }], i * 10);
        expect(started?.files).toHaveLength(1);
        picks.push(started?.files[0] ?? '');
      }
      const depth = noRepeatDepth(size);
      expect(depth).toBe(size === 1 ? 0 : size === 2 ? 1 : size - NO_REPEAT_FREE_CHOICES);
      for (let i = 0; i + depth < picks.length; i++) {
        expect(new Set(picks.slice(i, i + depth + 1)).size).toBe(depth + 1);
      }
      expect(new Set(picks).size).toBe(size);
    }
  });

  it('refuses a scream whose wav still sounds before it costs any budget', () => {
    const one = wavPool('scream-a', 1);
    const other = wavPool('scream-b', 1);
    const third = wavPool('scream-c', 1);
    const arbiter = new OneShotArbiter();
    const first = [worldShot(one, 'a:1', 0.9, 'voice'), worldShot(third, 'c:1', 0.8, 'voice')];
    expect(
      arbiter.decide(
        first.map((s) => ({ ...s, exclusive: 'wav' as const })),
        0,
      ),
    ).toHaveLength(VOICE_BURST);
    // Half a second refills one token. The louder scream's wav still sounds, so the quieter one gets it.
    const later = 1 / VOICE_STARTS_PER_S;
    const again = [
      { ...worldShot(one, 'a:2', 0.9, 'voice'), exclusive: 'wav' as const },
      { ...worldShot(other, 'b:1', 0.5, 'voice'), exclusive: 'wav' as const },
    ];
    expect(arbiter.decide(again, later).map((s) => s.key)).toEqual(['b:1']);
  });

  it('holds an answer while any line of its pool sounds, and picks its lines without repeats', () => {
    const pool = wavPool('ok', 3);
    const answer = (key: string): OneShot => ({ files: pool, gain: 0.8, pan: 0, key, exclusive: 'group' });
    const arbiter = new OneShotArbiter({ random: () => 0 });
    const first = arbiter.decide([answer('respond:a')], 0);
    expect(first).toHaveLength(1);
    expect(first[0]?.files).toHaveLength(1);
    expect(arbiter.decide([answer('respond:b')], DEFAULT_CLIP_LENGTH_S / 2)).toHaveLength(0);
    const second = arbiter.decide([answer('respond:c')], DEFAULT_CLIP_LENGTH_S + 0.01);
    expect(second).toHaveLength(1);
    expect(second[0]?.files[0]).not.toBe(first[0]?.files[0]);
  });

  it('holds a key through its cooldown', () => {
    const thud = wavPool('thud', 2);
    const arbiter = new OneShotArbiter();
    expect(arbiter.decide([worldShot(thud, 'thud:1', 1)], 0)).toHaveLength(1);
    expect(arbiter.decide([worldShot(thud, 'thud:1', 1)], KEY_COOLDOWN_S / 2)).toHaveLength(0);
    const cue: OneShot = { files: ['gui/click.wav'], gain: 1, pan: 0, key: 'ui:confirm' };
    expect(arbiter.decide([cue], 0)).toHaveLength(1);
    expect(arbiter.decide([cue], KEY_COOLDOWN_S / 2)).toHaveLength(0);
    expect(arbiter.decide([cue], KEY_COOLDOWN_S)).toHaveLength(1);
  });

  it('rings a jingle on one wav of its pool', () => {
    const files = wavPool('won', 2);
    const won: OneShot = { ...jingle(JINGLE_WON, 'won'), files };
    const [rang] = new OneShotArbiter().decide([won], 0);
    expect(rang?.files).toHaveLength(1);
    expect(files).toContain(rang?.files[0]);
  });

  it('draws an exclusive shot among the wavs not sounding, and refuses it once all sound', () => {
    const pair = wavPool('blow', 2);
    const blow = (key: string): OneShot => ({ ...worldShot(pair, key, 1), exclusive: 'wav' });
    // A source that would pick the first wav every time: the sounding one is skipped instead.
    const arbiter = new OneShotArbiter({ random: () => 0 });
    const first = arbiter.decide([blow('blow:1')], 0)[0]?.files[0];
    const second = arbiter.decide([blow('blow:2')], POOL_RETRIGGER_S)[0]?.files[0];
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(arbiter.decide([blow('blow:3')], 2 * POOL_RETRIGGER_S)).toHaveLength(0);
  });

  it('holds a wav for the length the engine reports', () => {
    const one = wavPool('long', 1);
    const shot = { ...worldShot(one, 'long', 1, 'voice'), exclusive: 'wav' as const };
    const arbiter = new OneShotArbiter({ playback: { clipLengthS: () => 5 } });
    expect(arbiter.decide([shot], 0)).toHaveLength(1);
    expect(arbiter.decide([{ ...shot, key: 'long:2' }], 4)).toHaveLength(0);
    expect(arbiter.decide([{ ...shot, key: 'long:3' }], 5.01)).toHaveLength(1);
  });
});

/** The [0,1) draw that jitters nothing: the middle of the range. */
const UNJITTERED = 0.5;
/** Floating-point slack on a bound the jitter can reach exactly. */
const ROUNDING = 1e-9;

describe('per-play variation', () => {
  it(`varies a world shot's rate within ${RATE_JITTER} and its level within ${GAIN_JITTER_DB} dB`, () => {
    const arbiter = new OneShotArbiter({ random: cycling([0, 0.2, 0.4, 0.6, 0.8, 0.99]) });
    const rates: number[] = [];
    for (let n = 0; n < 60; n++) {
      const [started] = arbiter.decide([worldShot(wavPool(`v${n}-`, 1), `v:${n}`, 0.5, 'voice')], n);
      expect(started).toBeDefined();
      const rate = started?.rate ?? 0;
      rates.push(rate);
      expect(Math.abs(rate - 1)).toBeLessThanOrEqual(RATE_JITTER + ROUNDING);
      const db = 20 * Math.log10((started?.gain ?? 0) / 0.5);
      expect(Math.abs(db)).toBeLessThanOrEqual(GAIN_JITTER_DB + ROUNDING);
    }
    expect(Math.min(...rates)).toBeCloseTo(1 - RATE_JITTER, 9);
    expect(new Set(rates).size).toBeGreaterThan(1);
  });

  it('leaves jingles, answers and GUI cues at their own rate and level', () => {
    const arbiter = new OneShotArbiter({ random: () => 0 });
    const answer: OneShot = {
      files: wavPool('ok', 2),
      gain: 0.6,
      pan: 0,
      key: 'respond:a',
      exclusive: 'group',
    };
    const cue: OneShot = { files: ['gui/click.wav'], gain: 1, pan: 0, key: 'ui:confirm' };
    const out = arbiter.decide([answer, cue, jingle(JINGLE_WON, 'won')], 0);
    expect(out).toHaveLength(3);
    for (const shot of out) expect(shot.rate).toBeUndefined();
    expect(out.map((s) => s.gain).sort()).toEqual([0.6, 0.9, 1]);
  });

  it('holds a slowed wav for its stretched length', () => {
    const one = wavPool('slow', 1);
    const shot = { ...worldShot(one, 'slow:1', 1, 'voice'), exclusive: 'wav' as const };
    // A source of 0 draws the slowest rate, so a one-second clip runs past one second.
    const arbiter = new OneShotArbiter({ random: () => 0, playback: { clipLengthS: () => 1 } });
    expect(arbiter.decide([shot], 0)).toHaveLength(1);
    const end = 1 / (1 - RATE_JITTER);
    expect(arbiter.decide([{ ...shot, key: 'slow:2' }], (1 + end) / 2)).toHaveLength(0);
    expect(arbiter.decide([{ ...shot, key: 'slow:3' }], end + 0.01)).toHaveLength(1);
  });
});

describe('instance caps', () => {
  it(`holds a pool to ${POOL_INSTANCE_CAP} at once and its starts ${POOL_RETRIGGER_S} s apart`, () => {
    const files = wavPool('swing', 10);
    const arbiter = new OneShotArbiter({ playback: { clipLengthS: () => 100 } });
    const starts: number[] = [];
    for (let t = 0; t < 5; t += 0.01) {
      const frame = Array.from({ length: 5 }, (_, i) => worldShot(files, `swing:${t}:${i}`, 1));
      if (arbiter.decide(frame, t).length > 0) starts.push(t);
    }
    expect(starts).toHaveLength(POOL_INSTANCE_CAP);
    for (let i = 1; i < starts.length; i++) {
      expect((starts[i] ?? 0) - (starts[i - 1] ?? 0)).toBeGreaterThanOrEqual(POOL_RETRIGGER_S - 1e-9);
    }
  });

  it('drops a world shot quieter than all that play once the world is full, and steals the quietest for a louder one', () => {
    const stopped: number[] = [];
    // A source at the middle of its range leaves every level unjittered, so the gains compare exactly.
    const arbiter = new OneShotArbiter({
      random: () => UNJITTERED,
      playback: { clipLengthS: () => 1000, stop: (i) => stopped.push(i) },
    });
    const started: OneShot[] = [];
    const firstPool = wavPool('fill0-', 1);
    let t = 0;
    for (let n = 0; started.length < WORLD_VOICE_CAP; n++, t += 1) {
      const files = n === 0 ? firstPool : wavPool(`fill${n}-`, 1);
      started.push(...arbiter.decide([worldShot(files, `fill:${n}`, n === 0 ? 0.3 : 0.5)], t));
    }
    const quietest = started[0]?.instance;
    expect(quietest).toBeDefined();
    expect(arbiter.decide([worldShot(wavPool('soft', 1), 'soft', 0.2)], t)).toHaveLength(0);
    expect(arbiter.decide([worldShot(wavPool('even', 1), 'even', 0.3)], t + 1)).toHaveLength(0);
    const loud = arbiter.decide([worldShot(wavPool('loud', 1), 'loud', 0.9)], t + 2);
    expect(loud.map((s) => s.key)).toEqual(['loud']);
    expect(stopped).toEqual([quietest]);
    // The stolen voice left its pool and its wav: the pool starts again over the next quietest.
    const back = arbiter.decide([{ ...worldShot(firstPool, 'fill:again', 0.9), exclusive: 'wav' }], t + 2.5);
    expect(back.map((s) => s.key)).toEqual(['fill:again']);
    expect(stopped).toHaveLength(2);
    // Answers and jingles are neither counted nor stolen: they start in a full world and stop nothing.
    const answer: OneShot = {
      files: wavPool('ok', 2),
      gain: 0.1,
      pan: 0,
      key: 'respond:x',
      exclusive: 'group',
    };
    const out = arbiter.decide([answer, jingle(JINGLE_DEATH, 'died:1')], t + 3);
    expect(out.map((s) => s.key).sort()).toEqual(['died:1', 'respond:x']);
    expect(stopped).toHaveLength(2);
  });

  it('drops a shot stolen in the decision that started it, without stopping it in the engine', () => {
    const stopped: number[] = [];
    // The lowest draw jitters every level down by the full span, so a started shot can end up quieter
    // than a later candidate of the same frame.
    const arbiter = new OneShotArbiter({
      random: () => 0,
      playback: { clipLengthS: () => 1000, stop: (i) => stopped.push(i) },
    });
    let t = 0;
    for (let n = 1; n < WORLD_VOICE_CAP; n++)
      arbiter.decide([worldShot(wavPool(`f${n}-`, 1), `f:${n}`, 0.9)], ++t);
    const out = arbiter.decide(
      [worldShot(wavPool('first', 1), 'first', 0.5), worldShot(wavPool('second', 1), 'second', 0.45)],
      ++t,
    );
    expect(out.map((s) => s.key)).toEqual(['second']);
    expect(stopped).toEqual([]);
  });

  it('keeps a stolen wav held while the engine cannot stop it', () => {
    const arbiter = new OneShotArbiter({ playback: { clipLengthS: () => 1000 } });
    const victimPool = wavPool('held', 1);
    let t = 0;
    arbiter.decide([{ ...worldShot(victimPool, 'held:1', 0.1), exclusive: 'wav' }], t);
    for (let n = 1; n < WORLD_VOICE_CAP; n++)
      arbiter.decide([worldShot(wavPool(`f${n}-`, 1), `f:${n}`, 0.5)], ++t);
    expect(arbiter.decide([worldShot(wavPool('loud', 1), 'loud', 0.9)], ++t)).toHaveLength(1);
    // Its slot went to the loud shot, but its wav plays on, so a copy of it is still refused.
    expect(arbiter.decide([{ ...worldShot(victimPool, 'held:2', 1), exclusive: 'wav' }], ++t)).toHaveLength(
      0,
    );
  });
});
