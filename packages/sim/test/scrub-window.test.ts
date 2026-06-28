import { beforeEach, describe, expect, it } from 'vitest';
import type { Command, LoggedCommand } from '../src/commands.js';
import * as components from '../src/components/index.js';
import type { Component } from '../src/ecs/world.js';
import {
  type RunReplay,
  Simulation,
  type TerrainMap,
  diffSnapshots,
  replay,
  scrubWindow,
  traceEntity,
} from '../src/index.js';
import { testContent } from './fixtures/content.js';

/**
 * Tests for `scrubWindow()` — the single-run "free scrubbing" composition: reconstruct a contiguous
 * window of plain snapshots `[fromTick, toTick]` from one command log, ready to feed `traceEntity`
 * (the whole window) and `diffSnapshots` (adjacent pairs). Its oracle is byte-equality with a
 * per-tick `replay()` — the same determinism guarantee `localizeDivergence` leans on.
 *
 * Component stores are module-level singletons SHARED across every `Simulation` (docs/LESSONS.md
 * [56e8d3e]) — so each recording phase and each manual replay clears the stores first, exactly as
 * localize-divergence.test.ts does, and `scrubWindow` supersedes the stores like `replay`.
 */

const HEADQUARTERS = 1;
const SAWMILL = 2;
const WOODCUTTER = 1;
const CARPENTER = 2;
const VIKING = 1;
const GRASS = 0;

/** Clear every component store (shared singletons) so each sim phase starts clean. */
function clearStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c) {
      (c as Component<unknown>).store.clear();
    }
  }
}

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

beforeEach(clearStores);

/** Drive a fresh sim through a scripted schedule, returning its replay inputs (a plain log). */
function recordRun(
  seed: number,
  ticks: number,
  schedule: ReadonlyMap<number, readonly Command[]>,
  map: TerrainMap,
): RunReplay {
  const sim = new Simulation({ seed, content: testContent(), map });
  for (let tick = 1; tick <= ticks; tick++) {
    for (const cmd of schedule.get(tick) ?? []) sim.enqueue(cmd);
    sim.step();
  }
  // The log is a plain value (LoggedCommand[]) — safe to keep after the stores are cleared.
  const log: LoggedCommand[] = [...sim.commands.log];
  return { content: testContent(), seed, map, log };
}

/** A run that spawns a woodcutter at tick 2 and a sawmill at tick 5 — gives the window things to show. */
function sampleRun(): { run: RunReplay; map: TerrainMap } {
  const map = grassMap(6, 1);
  const schedule = new Map<number, Command[]>([
    [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING }]],
    [2, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
    [5, [{ kind: 'placeBuilding', buildingType: SAWMILL, x: 2, y: 0, tribe: VIKING }]],
    [6, [{ kind: 'spawnSettler', jobType: CARPENTER, x: 3, y: 0, tribe: VIKING }]],
  ]);
  clearStores();
  return { run: recordRun(7, 20, schedule, map), map };
}

describe('scrubWindow', () => {
  it('returns a contiguous ascending window with one plain snapshot per tick', () => {
    const { run } = sampleRun();
    clearStores();
    const window = scrubWindow(run, 3, 8);

    // Inclusive on both ends: ticks 3,4,5,6,7,8.
    expect(window.map((s) => s.tick)).toEqual([3, 4, 5, 6, 7, 8]);
    // Plain values (no live Map / Entity brand): entities present, components are plain records.
    for (const snap of window) {
      expect(Array.isArray(snap.entities)).toBe(true);
      for (const e of snap.entities) expect(typeof e.components).toBe('object');
    }
  });

  it('each scrubbed tick is byte-identical to a per-tick replay() (the composition is faithful)', () => {
    const { run } = sampleRun();

    clearStores();
    const window = scrubWindow(run, 4, 7);

    // Hand-reconstruct each tick independently via replay() and compare — the single forward pass must
    // produce exactly what N separate replays would, byte-for-byte.
    for (const snap of window) {
      clearStores();
      const expected = replay({ ...run, untilTick: snap.tick }).snapshot();
      expect(JSON.stringify(snap)).toBe(JSON.stringify(expected));
    }
  });

  it('feeds traceEntity end-to-end: the tick-6 carpenter shows absent → SPAWNED@6', () => {
    const { run } = sampleRun();
    clearStores();
    const window = scrubWindow(run, 4, 8);

    // The carpenter is spawned at tick 6 — find the settler entity present at 6 but absent at 5
    // (the sawmill placed at tick 5 is also "new since 4", so key on the 5→6 edge + a Settler).
    const at5Ids = new Set(window.find((s) => s.tick === 5)?.entities.map((e) => e.id));
    const at6 = window.find((s) => s.tick === 6);
    const carpenterId = at6?.entities.find((e) => !at5Ids.has(e.id) && 'Settler' in e.components)?.id;
    expect(carpenterId).toBeDefined();
    if (carpenterId === undefined) return;

    const trace = traceEntity(window, carpenterId);
    // Window opens at 4 (absent), 5 (absent), 6 (spawned), then alive 7,8.
    expect(trace.map((s) => s.tick)).toEqual([4, 5, 6, 7, 8]);
    expect(trace[0]?.alive).toBe(false);
    expect(trace[1]?.alive).toBe(false);
    expect(trace[2]?.alive).toBe(true);
    expect(trace[2]?.spawned).toBe(true);
    expect(trace[2]?.components).toHaveProperty('Settler');
  });

  it('adjacent pairs feed diffSnapshots: the tick-5→6 step adds exactly the carpenter', () => {
    const { run } = sampleRun();
    clearStores();
    const window = scrubWindow(run, 5, 6);
    expect(window).toHaveLength(2);

    const diff = diffSnapshots(window[0] as never, window[1] as never);
    expect(diff.fromTick).toBe(5);
    expect(diff.toTick).toBe(6);
    expect(diff.removed).toHaveLength(0);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]?.components).toHaveProperty('Settler');
  });

  it('clamps fromTick to 1 (tick 0 is the un-snapshotted initial state)', () => {
    const { run } = sampleRun();
    clearStores();
    const window = scrubWindow(run, 0, 3);
    // from 0 means "from the start" — the first reconstructable tick is 1, not 0.
    expect(window.map((s) => s.tick)).toEqual([1, 2, 3]);
  });

  it('yields an empty window when toTick is below the (clamped) fromTick', () => {
    const { run } = sampleRun();
    clearStores();
    expect(scrubWindow(run, 5, 4)).toEqual([]);
    // from 0 clamps to 1, so to 0 is below it ⇒ empty (no tick 0 snapshot exists).
    clearStores();
    expect(scrubWindow(run, 0, 0)).toEqual([]);
  });

  it('steps deterministically past the last logged command (the tail), like replay()', () => {
    const { run } = sampleRun();
    // The last command is at tick 6; a window past it keeps stepping deterministically.
    clearStores();
    const window = scrubWindow(run, 24, 26);
    expect(window.map((s) => s.tick)).toEqual([24, 25, 26]);
    // And each tail tick still equals an independent replay to it.
    for (const snap of window) {
      clearStores();
      const expected = replay({ ...run, untilTick: snap.tick }).snapshot();
      expect(JSON.stringify(snap)).toBe(JSON.stringify(expected));
    }
  });

  it('throws on a negative tick target (a nonsense caller bug, like replay)', () => {
    const { run } = sampleRun();
    clearStores();
    expect(() => scrubWindow(run, -1, 5)).toThrow(/negative/);
    expect(() => scrubWindow(run, 1, -5)).toThrow(/negative/);
  });
});
