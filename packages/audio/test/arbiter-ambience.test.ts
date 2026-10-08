import { describe, expect, it } from 'vitest';
import { WORLD_VOICE_CAP } from '../src/data/one-shot-ledger.js';
import {
  AMBIENCE_BURST,
  AMBIENCE_STARTS_PER_S,
  type OneShot,
  OneShotArbiter,
  oneShotBus,
  SFX_BURST,
  SFX_STARTS_PER_S,
} from '../src/index.js';

/** The ambience lane: landscape one-shots ride a small budget of their own on the ambient bus, outside
 *  the world's voice cap. */

/** Long enough that nothing started in a test ends before it does. */
const LONG_CLIP_S = 1000;
const QUIET = 0.1;
const LOUD = 0.9;

function ambience(n: number, gain = LOUD): OneShot {
  return {
    files: [`ambient/bird_${n}.wav`],
    gain,
    pan: 0,
    key: `landscape:${n}`,
    lane: { kind: 'ambience' },
  };
}

function sfx(n: number, gain = QUIET): OneShot {
  return { files: [`static/hit_${n}.wav`], gain, pan: 0, key: `sfx:${n}`, lane: { kind: 'sfx' } };
}

const ambienceRun = (count: number): OneShot[] => Array.from({ length: count }, (_, n) => ambience(n));

describe('ambience lane', () => {
  it('starts a burst at once, then its rate a second', () => {
    const arbiter = new OneShotArbiter();
    const MANY = 10;
    expect(arbiter.decide(ambienceRun(MANY), 0)).toHaveLength(AMBIENCE_BURST);
    const next = Array.from({ length: MANY }, (_, n) => ambience(n + MANY));
    expect(arbiter.decide(next, 1)).toHaveLength(AMBIENCE_STARTS_PER_S);
  });

  it('spends nothing of the sfx budget', () => {
    const arbiter = new OneShotArbiter();
    const hits = Array.from({ length: SFX_BURST }, (_, n) => sfx(n));
    const started = arbiter.decide([...ambienceRun(AMBIENCE_BURST), ...hits], 0);
    expect(started.filter((s) => s.lane?.kind === 'sfx')).toHaveLength(SFX_BURST);
    expect(started.filter((s) => s.lane?.kind === 'ambience')).toHaveLength(AMBIENCE_BURST);
  });

  it('starts while the world is full, and neither steals a world voice nor is stolen', () => {
    const stopped: number[] = [];
    const arbiter = new OneShotArbiter({
      playback: { clipLengthS: () => LONG_CLIP_S, stop: (instance) => stopped.push(instance) },
    });
    // Fill the world one sfx budget at a time, each pool once.
    let pool = 0;
    for (let second = 0; pool < WORLD_VOICE_CAP; second += SFX_BURST / SFX_STARTS_PER_S) {
      const batch = Array.from({ length: SFX_BURST }, () => sfx(pool++));
      arbiter.decide(batch, second);
    }
    const later = WORLD_VOICE_CAP;
    const birds = arbiter.decide(ambienceRun(AMBIENCE_BURST), later);
    expect(birds).toHaveLength(AMBIENCE_BURST);
    expect(stopped).toEqual([]);
    // A louder world shot still finds the full world: it steals a quiet world voice, never a bird.
    const [loud] = arbiter.decide([sfx(pool + 1, LOUD)], later + 1);
    expect(loud?.instance).toBeDefined();
    expect(stopped).toHaveLength(1);
    expect(birds.every((b) => b.instance === undefined)).toBe(true);
  });

  it('varies each start in rate and level', () => {
    const arbiter = new OneShotArbiter({ random: () => 0 });
    const [bird] = arbiter.decide([ambience(1)], 0);
    expect(bird?.rate).toBeLessThan(1);
    expect(bird?.gain).toBeLessThan(LOUD);
  });

  it('plays on the ambient bus', () => {
    expect(oneShotBus(ambience(1))).toBe('ambient');
  });
});
