import { describe, expect, it, vi } from 'vitest';
import type { OnScreenSettler, SoundIndex } from '../src/index.js';
import {
  ChatterEmitter,
  MAX_CHATTER_DT_MS,
  VOICE_COOLDOWN_MS,
  VOICE_GAIN,
  VOICE_RATE_PER_SEC,
} from '../src/index.js';

/**
 * The stochastic voice-chatter emitter, made deterministic through the injected random source: the
 * crowd-wide clip rate, the per-settler cooldown, the sex/age→pool match and the refocus dt clamp
 * are all asserted headless — no AudioContext, no Math.random.
 */

/** An index whose groups cover all three default viking voice pools (one clip each). */
const index: SoundIndex = {
  groupsByName: new Map([
    ['generic viking male', ['voice/male_generic.wav']],
    ['talk viking male', ['voice/male_talk.wav']],
    ['socialtalk male', ['voice/male_social.wav']],
    ['generic viking female', ['voice/female_generic.wav']],
    ['talk viking female', ['voice/female_talk.wav']],
    ['socialtalk female', ['voice/female_social.wav']],
    ['generic viking children', ['voice/child_generic.wav']],
  ]),
  jinglesByMusicType: new Map(),
  ambientLoopByName: new Map(),
  ambientByTerrainType: new Map(),
};

const WOMAN_JOB = 5; // the mod's viking woman job — the one adult female voice (see bindings.ts)

function settler(entity: number, jobType: number | null = 0, young = false): OnScreenSettler {
  return { entity, pan: 0.25, gain: 0.5, jobType, young };
}

/** ms of update() calls needed to accrue one voice clip at the crowd rate. */
const MS_PER_VOICE = 1000 / VOICE_RATE_PER_SEC;

/** Pump the emitter in max-size steps for `totalMs`, collecting every emitted shot. */
function pump(emitter: ChatterEmitter, crowd: readonly OnScreenSettler[], totalMs: number) {
  const shots = [];
  for (let t = 0; t < totalMs; t += MAX_CHATTER_DT_MS) {
    shots.push(...emitter.update(MAX_CHATTER_DT_MS, () => crowd));
  }
  return shots;
}

describe('ChatterEmitter', () => {
  it('emits a spatialised voice from the settler once the crowd budget reaches one clip', () => {
    const emitter = new ChatterEmitter(index, { random: () => 0 });
    const crowd = [settler(7)];
    const shots = pump(emitter, crowd, MS_PER_VOICE + MAX_CHATTER_DT_MS);
    expect(shots).toHaveLength(1);
    expect(shots[0]?.key).toBe('voice:7');
    expect(shots[0]?.files).toEqual(['voice/male_generic.wav']); // random 0 → first male pool group
    expect(shots[0]?.gain).toBeCloseTo(0.5 * VOICE_GAIN, 5);
    expect(shots[0]?.pan).toBeCloseTo(0.25, 5);
  });

  it('holds a settler silent for its cooldown even while the crowd budget keeps accruing', () => {
    const emitter = new ChatterEmitter(index, { random: () => 0 });
    const crowd = [settler(7)];
    // 5s at 1.6 clips/s = 8 budgeted picks, but ONE settler with a 4s cooldown → exactly 2 voices.
    const shots = pump(emitter, crowd, VOICE_COOLDOWN_MS + 4 * MAX_CHATTER_DT_MS);
    expect(shots).toHaveLength(2);
  });

  it('draws each voice from the pool matching that settler’s sex/age', () => {
    const female = new ChatterEmitter(index, { random: () => 0 });
    const femaleShots = pump(female, [settler(1, WOMAN_JOB)], MS_PER_VOICE + MAX_CHATTER_DT_MS);
    expect(femaleShots[0]?.files).toEqual(['voice/female_generic.wav']);

    const child = new ChatterEmitter(index, { random: () => 0 });
    const childShots = pump(child, [settler(2, 4, true)], MS_PER_VOICE + MAX_CHATTER_DT_MS);
    expect(childShots[0]?.files).toEqual(['voice/child_generic.wav']);
  });

  it('clamps a huge refocus dt instead of bursting a cluster of voices', () => {
    const emitter = new ChatterEmitter(index, { random: () => 0 });
    // A backgrounded-tab frame: 60s elapsed. Clamped to MAX_CHATTER_DT_MS it accrues well under one clip.
    expect(emitter.update(60_000, () => [settler(7)])).toHaveLength(0);
  });

  it('accrues no budget while the crowd is off screen', () => {
    const emitter = new ChatterEmitter(index, { random: () => 0 });
    // A long empty stretch, then the crowd scrolls in: no stored-up burst on the first crowded frame.
    for (let t = 0; t < 10_000; t += MAX_CHATTER_DT_MS) emitter.update(MAX_CHATTER_DT_MS, () => []);
    expect(emitter.update(MAX_CHATTER_DT_MS, () => [settler(7)])).toHaveLength(0);
  });

  it('skips the settler scan entirely on a no-dt frame', () => {
    const emitter = new ChatterEmitter(index, { random: () => 0 });
    const scan = vi.fn(() => [settler(7)]);
    expect(emitter.update(0, scan)).toHaveLength(0);
    expect(scan).not.toHaveBeenCalled();
  });

  it('spreads voices across the crowd via the injected random source', () => {
    // random cycles 0, 0.9: settler picks alternate between the two, pool-group picks vary too.
    let calls = 0;
    const emitter = new ChatterEmitter(index, { random: () => (calls++ % 2 === 0 ? 0 : 0.9) });
    const crowd = [settler(1), settler(2)];
    const shots = pump(emitter, crowd, 4 * MS_PER_VOICE + MAX_CHATTER_DT_MS);
    const speakers = new Set(shots.map((s) => s.key));
    expect(speakers.size).toBeGreaterThan(1); // more than one settler spoke
  });
});
