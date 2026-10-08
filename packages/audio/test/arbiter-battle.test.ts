import { describe, expect, it } from 'vitest';
import { POOL_INSTANCE_CAP, POOL_RETRIGGER_S, WORLD_VOICE_CAP } from '../src/data/one-shot-ledger.js';
import {
  type OneShot,
  OneShotArbiter,
  SFX_BURST,
  SFX_STARTS_PER_S,
  VOICE_BURST,
  VOICE_STARTS_PER_S,
} from '../src/index.js';
import { battleEvents, battleIndex, battleShots, battleSnapshot } from './helpers/battle.js';

/**
 * A sustained 1000-unit melee, every fighter swinging and landing a blow each frame, with their idle
 * chatter on top: what reaches the engine stays inside every cap, and the arbiter's own work is one
 * linear pass over the frame's shots plus a little per pool, however many shots it drops.
 */

const FRAME_S = 1 / 60;
/** Seconds of battle: enough for every budget, cooldown and cap to saturate. */
const BATTLE_S = 4;
/** Seconds the scaling comparison runs: its first frames start every pool, the costliest frames. */
const COMPARED_S = 0.25;
/** Shot property reads one offered shot may cost: the lane switch, its key, pool, gain and exclusivity. */
const READS_PER_SHOT = 8;
/** Reads a frame may spend beyond the linear pass: sorting and starting the pool candidates. */
const READS_PER_FRAME = 100;

/** The pool each wav belongs to, so a started shot's single wav maps back to its group. */
const poolOfWav = new Map<string, string>();
for (const [name, files] of battleIndex.groupsByName) for (const file of files) poolOfWav.set(file, name);

/** Clip lengths spread across the bank's range, by wav. */
function clipLengthS(file: string): number {
  let hash = 0;
  for (const ch of file) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return 0.3 + (hash % 25) / 10;
}

interface Playing {
  readonly instance: number;
  readonly file: string;
  readonly pool: string;
  readonly endsAt: number;
}

/** Each shot behind a proxy counting property reads: the arbiter's work, measured without a clock. */
function counted(shots: readonly OneShot[], reads: { n: number }): OneShot[] {
  return shots.map(
    (shot) =>
      new Proxy(shot, {
        get(target, prop, receiver) {
          reads.n++;
          return Reflect.get(target, prop, receiver);
        },
      }),
  );
}

function runBattle(units: number, seconds = BATTLE_S) {
  const snapshot = battleSnapshot(units);
  const shots = battleShots(snapshot, battleEvents(units), { chatterTicks: 1 });
  const stopped = new Set<number>();
  let picks = 0;
  const arbiter = new OneShotArbiter({
    random: () => {
      picks++;
      return (picks * 0.618) % 1;
    },
    playback: { clipLengthS, stop: (instance) => stopped.add(instance) },
  });
  const reads = { n: 0 };
  const frame = counted(shots, reads);
  let playing: Playing[] = [];
  const lastPoolStart = new Map<string, number>();
  const starts = { voice: 0, sfx: 0 };
  let maxReadsPerFrame = 0;
  let maxPicksPerFrame = 0;
  for (let t = 0; t < seconds; t += FRAME_S) {
    const readsBefore = reads.n;
    const picksBefore = picks;
    const started = arbiter.decide(frame, t);
    maxReadsPerFrame = Math.max(maxReadsPerFrame, reads.n - readsBefore);
    maxPicksPerFrame = Math.max(maxPicksPerFrame, picks - picksBefore);
    playing = playing.filter((p) => p.endsAt > t && !stopped.has(p.instance));
    for (const shot of started) {
      const file = shot.files[0] ?? '';
      expect(shot.files).toHaveLength(1);
      const pool = poolOfWav.get(file) ?? '';
      if (shot.exclusive !== undefined) expect(playing.some((p) => p.file === file)).toBe(false);
      if (shot.lane === undefined) continue;
      expect(t - (lastPoolStart.get(pool) ?? Number.NEGATIVE_INFINITY)).toBeGreaterThanOrEqual(
        POOL_RETRIGGER_S,
      );
      lastPoolStart.set(pool, t);
      if (shot.lane.kind === 'voice') starts.voice++;
      if (shot.lane.kind === 'sfx') starts.sfx++;
      playing.push({ instance: shot.instance ?? 0, file, pool, endsAt: t + clipLengthS(file) });
    }
    expect(playing.length).toBeLessThanOrEqual(WORLD_VOICE_CAP);
    const perPool = new Map<string, number>();
    for (const p of playing) perPool.set(p.pool, (perPool.get(p.pool) ?? 0) + 1);
    expect(Math.max(0, ...perPool.values())).toBeLessThanOrEqual(POOL_INSTANCE_CAP);
  }
  return { shots: shots.length, starts, maxReadsPerFrame, maxPicksPerFrame };
}

describe('a 1000-unit battle', () => {
  it('reaches the engine inside every cap, at a cost linear in the frame`s shots', () => {
    const run = runBattle(1000);
    expect(run.shots).toBeGreaterThan(2000);
    expect(run.starts.voice).toBeGreaterThan(0);
    expect(run.starts.voice).toBeLessThanOrEqual(VOICE_BURST + VOICE_STARTS_PER_S * BATTLE_S);
    expect(run.starts.sfx).toBeLessThanOrEqual(SFX_BURST + SFX_STARTS_PER_S * BATTLE_S);
    // One wav pick per sound pool a frame at most, however many shots the pool's fighters raise.
    expect(run.maxPicksPerFrame).toBeLessThanOrEqual(battleIndex.groupsByName.size);
    expect(run.maxReadsPerFrame).toBeLessThanOrEqual(READS_PER_SHOT * run.shots + READS_PER_FRAME);
  });

  it('spends the same per-pool work on ten times the shots', () => {
    const small = runBattle(1000, COMPARED_S);
    const large = runBattle(10_000, COMPARED_S);
    expect(large.shots).toBeGreaterThan(5 * small.shots);
    expect(large.maxPicksPerFrame).toBe(small.maxPicksPerFrame);
    expect(large.maxReadsPerFrame).toBeLessThanOrEqual(READS_PER_SHOT * large.shots + READS_PER_FRAME);
  });
});
