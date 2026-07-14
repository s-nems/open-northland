import { describe, expect, it, vi } from 'vitest';
import { WOMAN_JOB } from '../src/data/bindings.js';
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
 * crowd-wide clip rate, the per-settler cooldown, the sex/age→pool match, the refocus dt clamp and
 * the scan-only-at-the-voice-rate gating are all asserted headless — no AudioContext, no Math.random.
 * Assertions are timing invariants (first-emission window, inter-shot gaps), not exact counts at
 * budget boundaries — an exact count sits on a floating-point knife edge and breaks on a rate retune.
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

function settler(entity: number, jobType: number | null = 0, young = false): OnScreenSettler {
  return { entity, pan: 0.25, gain: 0.5, jobType, young };
}

/** ms of emitter time needed to accrue one voice clip at the crowd rate. */
const MS_PER_VOICE = 1000 / VOICE_RATE_PER_SEC;
/** The pump step — the largest dt the emitter integrates per update. */
const STEP = MAX_CHATTER_DT_MS;

/** One emitted voice stamped with the emitter-clock time it fired at. */
interface TimedShot {
  readonly key: string;
  readonly files: readonly string[];
  readonly gain: number;
  readonly pan: number;
  readonly atMs: number;
}

/** Pump the emitter `steps` whole STEPs, collecting every emitted shot with its emission time. */
function pump(emitter: ChatterEmitter, crowd: readonly OnScreenSettler[], steps: number): TimedShot[] {
  const shots: TimedShot[] = [];
  for (let i = 1; i <= steps; i++) {
    for (const s of emitter.update(STEP, () => crowd)) shots.push({ ...s, atMs: i * STEP });
  }
  return shots;
}

describe('ChatterEmitter', () => {
  it('emits the first voice one budget-worth of time in, spatialised from the settler', () => {
    const emitter = new ChatterEmitter(index, { random: () => 0 });
    const shots = pump(emitter, [settler(7)], 20);
    expect(shots.length).toBeGreaterThan(0);
    const first = shots[0] as TimedShot;
    // The budget crosses one clip at MS_PER_VOICE, quantised up to the next whole pump step.
    expect(first.atMs).toBeGreaterThanOrEqual(MS_PER_VOICE - STEP);
    expect(first.atMs).toBeLessThanOrEqual(MS_PER_VOICE + STEP);
    expect(first.key).toBe('voice:7');
    expect(first.files).toEqual(['voice/male_generic.wav']); // random 0 → first male pool group
    expect(first.gain).toBeCloseTo(0.5 * VOICE_GAIN, 5);
    expect(first.pan).toBeCloseTo(0.25, 5);
  });

  it('holds a settler silent for its cooldown even while the crowd budget keeps accruing', () => {
    const emitter = new ChatterEmitter(index, { random: () => 0 });
    // 10s of a one-settler crowd: the budget allows ~16 picks, the cooldown allows a voice only
    // every VOICE_COOLDOWN_MS — so several voices fire and every consecutive gap honours the cooldown.
    const shots = pump(emitter, [settler(7)], Math.ceil(10_000 / STEP));
    expect(shots.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < shots.length; i++) {
      const gap = (shots[i] as TimedShot).atMs - (shots[i - 1] as TimedShot).atMs;
      expect(gap).toBeGreaterThanOrEqual(VOICE_COOLDOWN_MS);
    }
  });

  it('draws each voice from the pool matching that settler’s sex/age', () => {
    const female = new ChatterEmitter(index, { random: () => 0 });
    expect(pump(female, [settler(1, WOMAN_JOB)], 20)[0]?.files).toEqual(['voice/female_generic.wav']);
    // A young settler with the woman job: young wins — pins the age-over-sex precedence.
    const child = new ChatterEmitter(index, { random: () => 0 });
    expect(pump(child, [settler(2, WOMAN_JOB, true)], 20)[0]?.files).toEqual(['voice/child_generic.wav']);
  });

  it('clamps a huge refocus dt instead of bursting a cluster of voices', () => {
    const emitter = new ChatterEmitter(index, { random: () => 0 });
    // A backgrounded-tab frame: 60s elapsed. Clamped to MAX_CHATTER_DT_MS it accrues well under one clip.
    expect(emitter.update(60_000, () => [settler(7)])).toHaveLength(0);
  });

  it('never bursts voices when the crowd scrolls back in after a long empty stretch', () => {
    const emitter = new ChatterEmitter(index, { random: () => 0 });
    for (let i = 0; i < Math.ceil(10_000 / STEP); i++) emitter.update(STEP, () => []);
    // An empty screen banks at most one crossed clip: the first crowded frame fires 0 or 1 voice, never more.
    expect(emitter.update(STEP, () => [settler(7)]).length).toBeLessThanOrEqual(1);
  });

  it('skips the settler scan entirely on a no-dt frame', () => {
    const emitter = new ChatterEmitter(index, { random: () => 0 });
    const scan = vi.fn(() => [settler(7)]);
    expect(emitter.update(0, scan)).toHaveLength(0);
    expect(scan).not.toHaveBeenCalled();
  });

  it('scans the crowd at the voice rate, not once per frame', () => {
    const emitter = new ChatterEmitter(index, { random: () => 0 });
    const scan = vi.fn((): readonly OnScreenSettler[] => [settler(7)]);
    const frames = Math.ceil(5000 / STEP);
    for (let i = 0; i < frames; i++) emitter.update(STEP, scan);
    // ~1.6 budget crossings per second over 5s ≈ 8 scans, against 20 frames pumped.
    expect(scan.mock.calls.length).toBeGreaterThan(0);
    expect(scan.mock.calls.length).toBeLessThan(frames / 2);
  });

  it('spreads voices across the crowd via the injected random source', () => {
    // random cycles 0, 0.9: settler picks alternate between the two, pool-group picks vary too.
    let calls = 0;
    const emitter = new ChatterEmitter(index, { random: () => (calls++ % 2 === 0 ? 0 : 0.9) });
    const shots = pump(emitter, [settler(1), settler(2)], Math.ceil(10_000 / STEP));
    const speakers = new Set(shots.map((s) => s.key));
    expect(speakers.size).toBeGreaterThan(1); // more than one settler spoke
  });
});
