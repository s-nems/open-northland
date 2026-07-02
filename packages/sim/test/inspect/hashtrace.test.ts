import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import type { Component } from '../../src/ecs/world.js';
import { type Command, HashTrace, Simulation, type TerrainMap } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Tests for `HashTrace` — the per-tick hash (+ bounded snapshot) ring buffer that feeds the
 * "time-travel / replay inspector" (ROADMAP "Cross-cutting DX"). It is the "find tick N" half:
 * cheaply records `{tick, hash}` during a live run so two runs' divergence is detectable WITHOUT
 * re-replaying. `replay()` is the companion "jump to tick N" half. The oracle here is `hashState()`:
 * a real run feeds the trace its own per-tick hashes, and a diverging run is localized to the first
 * mismatching tick — exactly the inspector's "hash diverged at tick N".
 */

const HEADQUARTERS = 1;
const WOODCUTTER = 1;
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

/** Drive a fresh sim through a scripted schedule, feeding each tick's hash into a HashTrace. */
function traceRun(
  seed: number,
  ticks: number,
  schedule: ReadonlyMap<number, readonly Command[]>,
  opts?: { snapshotCapacity?: number; hashCapacity?: number; map?: TerrainMap; snapshots?: boolean },
): HashTrace {
  const sim = new Simulation({
    seed,
    content: testContent(),
    ...(opts?.map !== undefined ? { map: opts.map } : {}),
  });
  const trace = new HashTrace({
    ...(opts?.hashCapacity !== undefined ? { hashCapacity: opts.hashCapacity } : {}),
    ...(opts?.snapshotCapacity !== undefined ? { snapshotCapacity: opts.snapshotCapacity } : {}),
  });
  for (let tick = 1; tick <= ticks; tick++) {
    for (const cmd of schedule.get(tick) ?? []) sim.enqueue(cmd);
    sim.step();
    trace.record(tick, sim.hashState(), opts?.snapshots ? sim.snapshot() : undefined);
  }
  return trace;
}

describe('HashTrace', () => {
  it('records ascending {tick, hash} entries and looks them up', () => {
    const trace = new HashTrace();
    trace.record(1, 'aaaa');
    trace.record(2, 'bbbb');
    trace.record(3, 'cccc');

    expect(trace.size).toBe(3);
    expect(trace.oldestTick).toBe(1);
    expect(trace.newestTick).toBe(3);
    expect(trace.hashAt(2)).toBe('bbbb');
    expect(trace.at(3)?.hash).toBe('cccc');
    expect(trace.hashAt(99)).toBeUndefined(); // never recorded
  });

  it('is a BOUNDED ring: once full, recording drops the oldest entry', () => {
    const trace = new HashTrace({ hashCapacity: 3 });
    for (let t = 1; t <= 5; t++) trace.record(t, `h${t}`);

    expect(trace.size).toBe(3); // capped
    expect(trace.oldestTick).toBe(3); // ticks 1,2 aged out
    expect(trace.newestTick).toBe(5);
    expect(trace.hashAt(2)).toBeUndefined(); // dropped
    expect(trace.hashAt(5)).toBe('h5');
    expect(trace.list().map((e) => e.tick)).toEqual([3, 4, 5]);
  });

  it('throws on a non-monotonic record (out-of-order ticks are a caller bug)', () => {
    const trace = new HashTrace();
    trace.record(5, 'a');
    expect(() => trace.record(5, 'b')).toThrow(/not after the last recorded tick/);
    expect(() => trace.record(3, 'c')).toThrow(/not after the last recorded tick/);
  });

  it('rejects nonsense capacities at construction', () => {
    expect(() => new HashTrace({ hashCapacity: 0 })).toThrow(/hashCapacity must be an integer >= 1/);
    expect(() => new HashTrace({ snapshotCapacity: -1 })).toThrow(/snapshotCapacity must be an integer >= 0/);
    expect(() => new HashTrace({ hashCapacity: 2, snapshotCapacity: 3 })).toThrow(
      /can't outlive its hash entry/,
    );
  });

  it('keeps only the most-recent snapshotCapacity snapshots (the heavy payload stays bounded)', () => {
    const trace = new HashTrace({ hashCapacity: 10, snapshotCapacity: 2 });
    const fakeSnap = (tick: number) => ({ tick, entities: [], events: [] });
    for (let t = 1; t <= 5; t++) trace.record(t, `h${t}`, fakeSnap(t));

    // All 5 hashes retained, but only the last 2 ticks keep their snapshot.
    expect(trace.size).toBe(5);
    expect(trace.at(5)?.snapshot?.tick).toBe(5);
    expect(trace.at(4)?.snapshot?.tick).toBe(4);
    expect(trace.at(3)?.snapshot).toBeUndefined(); // aged out of the snapshot window
    expect(trace.at(1)?.snapshot).toBeUndefined();
    expect(trace.at(3)?.hash).toBe('h3'); // ...but its hash is still here
  });

  it('keeps the snapshot window capped while the hash ring is ALSO dropping (shift + age interact)', () => {
    // hashCapacity 4, snapshotCapacity 2, 8 ticks: the hash ring shifts AND snapshots age every tick
    // past warm-up — the O(1) aging must keep exactly the most-recent 2 snapshots throughout.
    const trace = new HashTrace({ hashCapacity: 4, snapshotCapacity: 2 });
    const fakeSnap = (tick: number) => ({ tick, entities: [], events: [] });
    for (let t = 1; t <= 8; t++) {
      trace.record(t, `h${t}`, fakeSnap(t));
      const withSnap = trace.list().filter((e) => e.snapshot !== undefined);
      expect(withSnap.length).toBeLessThanOrEqual(2); // never exceeds the snapshot cap
    }
    expect(trace.list().map((e) => e.tick)).toEqual([5, 6, 7, 8]); // hash ring: last 4
    expect(trace.at(8)?.snapshot?.tick).toBe(8);
    expect(trace.at(7)?.snapshot?.tick).toBe(7);
    expect(trace.at(6)?.snapshot).toBeUndefined(); // aged out, hash still present
    expect(trace.at(6)?.hash).toBe('h6');
  });

  it('drops the snapshot when snapshotCapacity is 0 even if one is passed (hashes only)', () => {
    const trace = new HashTrace({ hashCapacity: 4 }); // snapshotCapacity defaults to 0
    trace.record(1, 'h1', { tick: 1, entities: [], events: [] });
    expect(trace.at(1)?.snapshot).toBeUndefined();
    expect(trace.at(1)?.hash).toBe('h1');
  });

  describe('divergedFrom', () => {
    it('returns undefined for two identical traces', () => {
      const a = new HashTrace();
      const b = new HashTrace();
      for (let t = 1; t <= 5; t++) {
        a.record(t, `h${t}`);
        b.record(t, `h${t}`);
      }
      expect(a.divergedFrom(b)).toBeUndefined();
    });

    it('finds the FIRST mismatching tick', () => {
      const a = new HashTrace();
      const b = new HashTrace();
      a.record(1, 'x');
      b.record(1, 'x');
      a.record(2, 'y');
      b.record(2, 'y');
      a.record(3, 'AAA');
      b.record(3, 'BBB'); // first divergence
      a.record(4, 'CCC');
      b.record(4, 'DDD'); // also differs, but later

      expect(a.divergedFrom(b)).toEqual({ tick: 3, hash: 'AAA', otherHash: 'BBB' });
    });

    it('compares only the overlapping window (a tick only in one trace is skipped)', () => {
      const a = new HashTrace({ hashCapacity: 2 }); // keeps ticks 4,5
      const b = new HashTrace(); // keeps 1..5
      for (let t = 1; t <= 5; t++) {
        a.record(t, t === 5 ? 'DIFF' : `h${t}`);
        b.record(t, `h${t}`);
      }
      // a only retains ticks 4 and 5; tick 5 is the only mismatch in the overlap.
      expect(a.oldestTick).toBe(4);
      expect(a.divergedFrom(b)).toEqual({ tick: 5, hash: 'DIFF', otherHash: 'h5' });
    });

    it('localizes a REAL divergence: a different seed splits from a reference run at the first tick its state differs', () => {
      const schedule = new Map<number, Command[]>([
        [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 3, y: 0, tribe: VIKING }]],
        [3, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
      ]);
      const reference = traceRun(1, 40, schedule, { map: grassMap(5, 1) });

      clearStores();
      // Same commands, DIFFERENT seed: the RNG state is hashed, so the very first tick already
      // differs — divergedFrom must point at tick 1 (the inspector's "hash diverged at tick N").
      const variant = traceRun(2, 40, schedule, { map: grassMap(5, 1) });

      const d = variant.divergedFrom(reference);
      expect(d?.tick).toBe(1);
      expect(d?.hash).not.toBe(d?.otherHash);
    });

    it('agrees with a faithful re-run: same seed + commands never diverge', () => {
      const schedule = new Map<number, Command[]>([
        [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 2, y: 0, tribe: VIKING }]],
        [2, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
      ]);
      const a = traceRun(7, 30, schedule, { map: grassMap(4, 1) });
      clearStores();
      const b = traceRun(7, 30, schedule, { map: grassMap(4, 1) });
      expect(a.divergedFrom(b)).toBeUndefined();
    });
  });

  it('records a real run with a recent-snapshot window the overlay can dump from', () => {
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 0, y: 0, tribe: VIKING }]],
      [2, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
    ]);
    const trace = traceRun(1, 12, schedule, { snapshots: true, snapshotCapacity: 3, hashCapacity: 100 });

    expect(trace.size).toBe(12);
    // The 3 most-recent ticks retain a full snapshot; older ticks keep the hash only.
    expect(trace.at(12)?.snapshot?.tick).toBe(12);
    expect(trace.at(10)?.snapshot?.tick).toBe(10);
    expect(trace.at(9)?.snapshot).toBeUndefined();
    expect(trace.at(9)?.hash).toBeDefined();
    // The retained snapshot carries the live entities (HQ + settler) the overlay would dump.
    expect(trace.at(12)?.snapshot?.entities.length ?? 0).toBeGreaterThan(0);
  });
});
