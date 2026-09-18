import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type MapBenchWorldOptions, mapBenchWorld } from '../../bench/map-world.js';
import { hasRealIr } from './helpers.js';

/**
 * The benchmark checkpoint (`ON_BENCH_CHECKPOINT`): a restored world must be the world the skipped
 * ticks produced, not merely a world of the same shape. A drifting restore would move every
 * late-game measurement off the run it claims to describe.
 */

const MAP_ID = 'magiczny_las';
/** Enough ticks for the placement drain and the first commands to land in the checkpoint. */
const SKIP_TICKS = 12;
/** Ticks run after the checkpoint on both sides of the comparison. */
const AFTER_TICKS = 5;

const dir = mkdtempSync(join(tmpdir(), 'on-bench-checkpoint-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function options(overrides: Partial<MapBenchWorldOptions> = {}): MapBenchWorldOptions {
  return {
    mapId: MAP_ID,
    aiSeats: 1,
    syncDigest: false,
    checkpointPath: join(dir, 'world.checkpoint'),
    skipTicks: SKIP_TICKS,
    ...overrides,
  };
}

describe.runIf(hasRealIr())('benchmark map checkpoint', () => {
  it('restores the state the skipped ticks reached and keeps stepping identically', async () => {
    const built = await mapBenchWorld(options());
    expect(built.source).toBe('built');

    const restored = await mapBenchWorld(options());
    expect(restored.source).toBe('checkpoint');
    expect(restored.startTick).toBe(built.startTick);
    expect(restored.mapCells).toEqual(built.mapCells);
    expect(restored.sim.hashState()).toBe(built.sim.hashState());

    built.sim.run(AFTER_TICKS);
    restored.sim.run(AFTER_TICKS);
    expect(restored.sim.hashState()).toBe(built.sim.hashState());
  });

  it('refuses a checkpoint taken on another map or another seat count', async () => {
    await mapBenchWorld(options());
    await expect(mapBenchWorld(options({ aiSeats: 2 }))).rejects.toThrow(/1 AI seat\(s\), not 2/);
    await expect(mapBenchWorld(options({ mapId: 'specjalna_forteca' }))).rejects.toThrow(
      /map 'magiczny_las', not 'specjalna_forteca'/,
    );
  });
});
