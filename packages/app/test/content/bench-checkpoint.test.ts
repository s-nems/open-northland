import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  benchSession,
  type MapBenchWorldOptions,
  mapBenchWorld,
  markCheckpointPath,
} from '../../bench/map-world.js';
import { sessionRoles } from '../../src/game/session-roles.js';
import { hasRealIr } from './helpers.js';

/**
 * The benchmark checkpoints (`ON_BENCH_CHECKPOINT`, `ON_BENCH_CHECKPOINTS`): a restored world must be
 * the world the run reached at that tick, not merely a world of the same shape. A drifting restore
 * would move every late-game measurement off the run it claims to describe.
 */

const MAP_ID = 'magiczny_las';
/** The map's own computer seat, which the browser session runs beside every `?ai=` seat. */
const MAP_COMPUTER_SEAT = 6;
/** Enough ticks for the placement drain and the first commands to land in the checkpoint. */
const SKIP_TICKS = 12;
/** Ticks run after the checkpoint on both sides of the comparison. */
const AFTER_TICKS = 5;
/** Absolute ticks for the marks, past the boot ticks a fresh world stands at. */
const MARKS = [10, 16] as const;
const [FIRST_MARK, LAST_MARK] = MARKS;

const dir = mkdtempSync(join(tmpdir(), 'on-bench-checkpoint-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function options(overrides: Partial<MapBenchWorldOptions> = {}): MapBenchWorldOptions {
  return {
    mapId: MAP_ID,
    seats: [0],
    progression: null,
    needs: null,
    syncDigest: false,
    checkpointPath: join(dir, 'world.checkpoint'),
    skipTicks: SKIP_TICKS,
    checkpointMarks: [],
    ...overrides,
  };
}

describe('markCheckpointPath', () => {
  it('names a mark from the base stem, including when the base is itself a mark', () => {
    expect(markCheckpointPath('/tmp/late.checkpoint', 30000)).toBe('/tmp/late.t30000.checkpoint');
    expect(markCheckpointPath('/tmp/late.t30000.checkpoint', 40000)).toBe('/tmp/late.t40000.checkpoint');
    expect(markCheckpointPath('/tmp/late', 300)).toBe('/tmp/late.t300.checkpoint');
  });
});

describe.runIf(hasRealIr())('benchmark map checkpoint', () => {
  it('restores the state the skipped ticks reached and keeps stepping identically', async () => {
    const built = await mapBenchWorld(options(), AFTER_TICKS);
    expect(built.source).toBe('built');
    expect(built.aiSeats).toEqual([0, MAP_COMPUTER_SEAT]);

    const restored = await mapBenchWorld(options(), AFTER_TICKS);
    expect(restored.source).toBe('checkpoint');
    expect(restored.startTick).toBe(built.startTick);
    expect(restored.mapCells).toEqual(built.mapCells);
    expect(restored.sim.hashState()).toBe(built.sim.hashState());

    built.sim.run(AFTER_TICKS);
    restored.sim.run(AFTER_TICKS);
    expect(restored.sim.hashState()).toBe(built.sim.hashState());
  });

  it('refuses a checkpoint taken on another map, other seats or other rules', async () => {
    await mapBenchWorld(options(), 0);
    await expect(mapBenchWorld(options({ seats: [0, 1] }), 0)).rejects.toThrow(/AI seats 0,6, not 0-1,6/);
    await expect(mapBenchWorld(options({ progression: true }), 0)).rejects.toThrow(
      /progression the map default, not on/,
    );
    await expect(mapBenchWorld(options({ mapId: 'specjalna_forteca' }), 0)).rejects.toThrow(
      /map 'magiczny_las', not 'specjalna_forteca'/,
    );
  });

  it('writes one checkpoint per mark, each restoring to the continuous run at that tick', async () => {
    const base = join(dir, 'marks.checkpoint');
    const marked = options({ checkpointPath: base, skipTicks: 0, checkpointMarks: MARKS, needs: true });
    const continuous = await mapBenchWorld(marked, LAST_MARK);
    const hashAt = new Map<number, string>();
    while (continuous.sim.tick < LAST_MARK) {
      continuous.sim.step();
      continuous.afterStep();
      if ((MARKS as readonly number[]).includes(continuous.sim.tick)) {
        hashAt.set(continuous.sim.tick, continuous.sim.hashState());
      }
    }

    for (const mark of MARKS) {
      const restored = await mapBenchWorld(
        { ...marked, checkpointPath: markCheckpointPath(base, mark), checkpointMarks: [] },
        0,
      );
      expect(restored.source).toBe('checkpoint');
      expect(restored.startTick).toBe(mark);
      expect(restored.sim.hashState()).toBe(hashAt.get(mark));
    }

    // Stepping on from the first mark reaches the second, and so does a run that wrote no marks: the
    // writes change nothing the run goes on to simulate.
    const span = LAST_MARK - FIRST_MARK;
    const resumed = await mapBenchWorld(
      { ...marked, checkpointPath: markCheckpointPath(base, FIRST_MARK), checkpointMarks: [] },
      span,
    );
    resumed.sim.run(span);
    expect(resumed.sim.hashState()).toBe(hashAt.get(LAST_MARK));
    const unmarked = await mapBenchWorld({ ...marked, checkpointPath: null, checkpointMarks: [] }, LAST_MARK);
    unmarked.sim.run(LAST_MARK - unmarked.startTick);
    expect(unmarked.sim.hashState()).toBe(hashAt.get(LAST_MARK));

    // A mark at or before the restored tick can never be written, so it is refused before any step.
    const again = { ...marked, checkpointPath: markCheckpointPath(base, FIRST_MARK) };
    await expect(mapBenchWorld(again, span)).rejects.toThrow(
      `checkpoint mark(s) ${FIRST_MARK} fall outside this run's ticks ${FIRST_MARK + 1}..${LAST_MARK}`,
    );
    // The run's last tick is the latest mark it can write.
    const atEnd = await mapBenchWorld({ ...again, checkpointMarks: [LAST_MARK] }, span);
    expect(atEnd.startTick).toBe(FIRST_MARK);
    await expect(mapBenchWorld({ ...again, checkpointMarks: [LAST_MARK + 1] }, span)).rejects.toThrow(
      `checkpoint mark(s) ${LAST_MARK + 1} fall outside this run's ticks ${FIRST_MARK + 1}..${LAST_MARK}`,
    );
  });

  it('prints a session whose assistants are the AI seats it builds, also without seat 0', () => {
    // The bench grants assistants to its AI seats alone; the session it names must do the same, which
    // an overseer's claim on seat 0 would not.
    const session = benchSession(options({ seats: [1] }));
    expect(sessionRoles(session, []).assistantSeats).toEqual([1, MAP_COMPUTER_SEAT]);
    expect(sessionRoles(session, []).matchParticipants).toEqual([1, MAP_COMPUTER_SEAT]);
  });
});
