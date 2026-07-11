import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import type { Component } from '../../src/ecs/world.js';
import {
  type Command,
  diffSnapshots,
  HashTrace,
  type LoggedCommand,
  localizeDivergence,
  type RunReplay,
  replay,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Tests for `localizeDivergence()` — the headless composition that wires the four replay-inspector
 * primitives (`HashTrace.divergedFrom` → `replay` ×2 → `diffSnapshots`) into the inspector's
 * documented "hash diverged at tick N → jump there → inspect what differs" workflow.
 *
 * Component stores are module-level singletons SHARED across every `Simulation` (AGENTS.md
 * [56e8d3e]) — so each recording phase and each manual replay clears the stores first, exactly as
 * replay.test.ts does, and `localizeDivergence` clears between its own two internal replays.
 */

const HEADQUARTERS = 1;
const SAWMILL = 2;
const WOODCUTTER = 1;
const CARPENTER = 2;
const VIKING = 1;
const GRASS = 0;

/** Clear every component store (shared singletons) so each sim phase starts clean. */
function clearComponentStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c) {
      (c as Component<unknown>).store.clear();
    }
  }
}

function grassMap(width: number, height: number): TerrainMap {
  return { resolution: 'half-cell', width, height, typeIds: new Array(width * height).fill(GRASS) };
}

beforeEach(clearComponentStores);

/** Drive a fresh sim through a scripted schedule, recording its log + a per-tick HashTrace (with snapshots). */
function recordRun(
  seed: number,
  ticks: number,
  schedule: ReadonlyMap<number, readonly Command[]>,
  map: TerrainMap,
): { run: RunReplay; trace: HashTrace } {
  const sim = new Simulation({ seed, content: testContent(), map });
  const trace = new HashTrace({ snapshotCapacity: ticks });
  for (let tick = 1; tick <= ticks; tick++) {
    for (const cmd of schedule.get(tick) ?? []) sim.enqueue(cmd);
    sim.step();
    trace.record(sim.tick, sim.hashState(), sim.snapshot());
  }
  // The log is a plain value (LoggedCommand[]) — safe to keep after the stores are cleared.
  const log: LoggedCommand[] = [...sim.commands.log];
  return { run: { content: testContent(), seed, map, log }, trace };
}

describe('localizeDivergence', () => {
  it('localizes the first split tick and diffs the two runs there', () => {
    const map = grassMap(6, 1);
    // Two runs identical except run B spawns an EXTRA settler at tick 7 — so they diverge at tick 7.
    const base = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING }]],
      [2, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 0, tribe: VIKING }]],
    ]);
    const variant = new Map<number, Command[]>([
      ...base,
      [7, [{ kind: 'spawnSettler', jobType: CARPENTER, x: 4, y: 0, tribe: VIKING }]],
    ]);

    clearComponentStores();
    const a = recordRun(7, 20, base, map);
    clearComponentStores();
    const b = recordRun(7, 20, variant, map);

    clearComponentStores();
    const report = localizeDivergence(a.run, a.trace, b.run, b.trace);

    expect(report).not.toBeNull();
    if (report === null) return;
    // The runs are byte-identical through tick 6; tick 7 is where B's extra spawnSettler applies.
    expect(report.tick).toBe(7);
    expect(report.hashA).toBe(a.trace.hashAt(7));
    expect(report.hashB).toBe(b.trace.hashAt(7));
    expect(report.hashA).not.toBe(report.hashB);
    // The diff is over the SAME tick of two runs, so both endpoints are tick 7.
    expect(report.diff.fromTick).toBe(7);
    expect(report.diff.toTick).toBe(7);
    // B has one more entity (the tick-7 carpenter), so it shows up as `added` and nothing else differs.
    expect(report.diff.removed).toHaveLength(0);
    expect(report.diff.changed).toHaveLength(0);
    expect(report.diff.added).toHaveLength(1);
    expect(report.diff.added[0]?.components).toHaveProperty('Settler');
  });

  it('the report diff equals a hand-replayed diffSnapshots at the same tick (the composition is faithful)', () => {
    const map = grassMap(5, 1);
    const base = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 3, y: 0, tribe: VIKING }]],
      [3, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
    ]);
    const variant = new Map<number, Command[]>([
      ...base,
      [5, [{ kind: 'placeBuilding', buildingType: SAWMILL, x: 2, y: 0, tribe: VIKING }]],
    ]);

    clearComponentStores();
    const a = recordRun(2, 15, base, map);
    clearComponentStores();
    const b = recordRun(2, 15, variant, map);

    // Hand-compute the expected diff: replay BOTH runs to the split tick (serially, clearing between),
    // capture each plain snapshot, diff them. This must equal what localizeDivergence produced.
    const splitTick = a.trace.divergedFrom(b.trace)?.tick;
    expect(splitTick).toBe(5);
    if (splitTick === undefined) return;

    clearComponentStores();
    const snapA = replay({ ...a.run, untilTick: splitTick }).snapshot();
    clearComponentStores();
    const snapB = replay({ ...b.run, untilTick: splitTick }).snapshot();
    const expectedDiff = diffSnapshots(snapA, snapB);

    clearComponentStores();
    const report = localizeDivergence(a.run, a.trace, b.run, b.trace);
    expect(report).not.toBeNull();
    // Byte-identical: the composition just wires divergedFrom → replay×2 → diffSnapshots.
    expect(JSON.stringify(report?.diff)).toBe(JSON.stringify(expectedDiff));
  });

  it('returns null when the two runs agree on every overlapping tick (no divergence)', () => {
    const map = grassMap(4, 1);
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 2, y: 0, tribe: VIKING }]],
      [2, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
    ]);

    clearComponentStores();
    const a = recordRun(3, 12, schedule, map);
    clearComponentStores();
    const b = recordRun(3, 12, schedule, map); // same seed + same schedule ⇒ identical run

    clearComponentStores();
    expect(localizeDivergence(a.run, a.trace, b.run, b.trace)).toBeNull();
  });
});
