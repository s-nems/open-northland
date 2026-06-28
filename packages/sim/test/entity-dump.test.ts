import { beforeEach, describe, expect, it } from 'vitest';
import type { Command } from '../src/commands.js';
import * as components from '../src/components/index.js';
import type { Component } from '../src/ecs/world.js';
import { Simulation, type TerrainMap, dumpEntity, traceEntity } from '../src/index.js';
import type { WorldSnapshot } from '../src/snapshot.js';
import { testContent } from './fixtures/content.js';

/**
 * Tests for `dumpEntity()` / `traceEntity()` — the "dump an entity" third of the time-travel / replay
 * inspector (ROADMAP "Cross-cutting DX"). Both are pure functions of plain `WorldSnapshot` values, so
 * most cases are hand-built snapshots (no sim needed); the last case proves they compose over a real
 * `step()`-driven run so the overlay's actual path is exercised end to end.
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

/** Build a minimal snapshot value with the given entities (already ascending by id). */
function snap(tick: number, entities: { id: number; components: Record<string, unknown> }[]): WorldSnapshot {
  return { tick, entities, events: [] };
}

beforeEach(clearStores);

describe('dumpEntity', () => {
  it('returns the full component view of an entity present at the tick', () => {
    const s = snap(7, [
      { id: 1, components: { Position: { x: 0, y: 0 } } },
      { id: 5, components: { Position: { x: 3, y: 4 }, Health: { hp: 10 } } },
    ]);
    expect(dumpEntity(s, 5)).toEqual({
      tick: 7,
      id: 5,
      components: { Position: { x: 3, y: 4 }, Health: { hp: 10 } },
    });
  });

  it('returns null for an entity absent at the tick', () => {
    const s = snap(7, [{ id: 1, components: { Position: { x: 0, y: 0 } } }]);
    expect(dumpEntity(s, 99)).toBeNull();
  });

  it('finds an entity by binary search regardless of position in the ascending list', () => {
    // Many entities -> exercise the search hitting first / middle / last.
    const s = snap(
      1,
      [10, 20, 30, 40, 50].map((id) => ({ id, components: { P: id } })),
    );
    expect(dumpEntity(s, 10)?.components).toEqual({ P: 10 });
    expect(dumpEntity(s, 30)?.components).toEqual({ P: 30 });
    expect(dumpEntity(s, 50)?.components).toEqual({ P: 50 });
    expect(dumpEntity(s, 25)).toBeNull(); // between two present ids
  });

  it('returns the snapshot components verbatim (sorted-name order preserved)', () => {
    const s = snap(2, [{ id: 1, components: { Aaa: 1, Zzz: 2 } }]);
    const dump = dumpEntity(s, 1);
    // takeSnapshot sorts component names; dumpEntity hands them back unchanged.
    expect(Object.keys(dump?.components ?? {})).toEqual(['Aaa', 'Zzz']);
  });
});

describe('traceEntity', () => {
  it('emits one alive step per snapshot with no spawn/despawn on the window edges', () => {
    const snaps = [
      snap(1, [{ id: 1, components: { Position: { x: 0, y: 0 } } }]),
      snap(2, [{ id: 1, components: { Position: { x: 1, y: 0 } } }]),
    ];
    const trace = traceEntity(snaps, 1);
    expect(trace.map((s) => s.tick)).toEqual([1, 2]);
    expect(trace.every((s) => s.alive)).toBe(true);
    // The opening step has no `changes` (nothing precedes it) and no spawn edge.
    expect(trace[0]?.changes).toBeUndefined();
    expect(trace[0]?.spawned).toBeUndefined();
    expect(trace[0]?.components).toEqual({ Position: { x: 0, y: 0 } });
  });

  it("reports a survivor's per-component changes vs. the previous step", () => {
    const snaps = [
      snap(1, [{ id: 1, components: { Position: { x: 0, y: 0 } } }]),
      snap(2, [{ id: 1, components: { Position: { x: 1, y: 0 } } }]),
    ];
    const trace = traceEntity(snaps, 1);
    expect(trace[1]?.changes).toEqual([
      { name: 'Position', kind: 'changed', before: { x: 0, y: 0 }, after: { x: 1, y: 0 } },
    ]);
  });

  it('marks the spawn edge when the entity appears mid-window', () => {
    const snaps = [
      snap(1, [{ id: 9, components: { Other: 1 } }]), // entity 1 absent
      snap(2, [
        { id: 1, components: { Position: { x: 5, y: 5 } } }, // entity 1 appears
        { id: 9, components: { Other: 1 } },
      ]),
    ];
    const trace = traceEntity(snaps, 1);
    expect(trace[0]).toEqual({ tick: 1, alive: false });
    expect(trace[1]?.spawned).toBe(true);
    expect(trace[1]?.alive).toBe(true);
    expect(trace[1]?.components).toEqual({ Position: { x: 5, y: 5 } });
    // A spawn has no `changes` (no prior alive state to diff against).
    expect(trace[1]?.changes).toBeUndefined();
  });

  it('marks the despawn edge when the entity vanishes mid-window', () => {
    const snaps = [
      snap(1, [{ id: 1, components: { Position: { x: 0, y: 0 } } }]),
      snap(2, []), // entity 1 gone
    ];
    const trace = traceEntity(snaps, 1);
    expect(trace[0]?.alive).toBe(true);
    expect(trace[1]).toEqual({ tick: 2, alive: false, despawned: true });
  });

  it('reports a plain not-alive step for an entity absent across the whole window', () => {
    const snaps = [snap(1, [{ id: 2, components: {} }]), snap(2, [{ id: 2, components: {} }])];
    const trace = traceEntity(snaps, 1);
    expect(trace).toEqual([
      { tick: 1, alive: false },
      { tick: 2, alive: false },
    ]);
  });

  it('handles a single-snapshot window (one step, no changes)', () => {
    const trace = traceEntity([snap(5, [{ id: 1, components: { P: 1 } }])], 1);
    expect(trace).toEqual([{ tick: 5, alive: true, components: { P: 1 } }]);
  });

  it('handles a respawn (absent again then present again) as a fresh spawn, not a survivor', () => {
    const snaps = [
      snap(1, [{ id: 1, components: { P: 'a' } }]),
      snap(2, []), // despawn
      snap(3, [{ id: 1, components: { P: 'b' } }]), // a NEW entity reusing nothing — id reappears
    ];
    const trace = traceEntity(snaps, 1);
    expect(trace[1]?.despawned).toBe(true);
    expect(trace[2]?.spawned).toBe(true);
    // The re-appearance is a spawn, not a changed survivor: no `changes` bridging across the gap.
    expect(trace[2]?.changes).toBeUndefined();
  });

  it("a survivor's per-tick trace delta equals its slice of the full two-tick diff", () => {
    // The contract that lets the overlay follow ONE entity instead of re-diffing the world.
    const a = snap(1, [{ id: 1, components: { Position: { x: 0, y: 0 }, Carrying: { good: 7 } } }]);
    const b = snap(2, [{ id: 1, components: { Position: { x: 0, y: 0 }, Health: { hp: 10 } } }]);
    const trace = traceEntity([a, b], 1);
    // Carrying removed (< Health), Health added, Position unchanged -> omitted; sorted by name.
    expect(trace[1]?.changes).toEqual([
      { name: 'Carrying', kind: 'removed', before: { good: 7 } },
      { name: 'Health', kind: 'added', after: { hp: 10 } },
    ]);
  });

  it('composes over a real step()-driven run: dumping + tracing the spawned settler', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(6, 1) });
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING }]],
      [3, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
    ]);
    const snaps: WorldSnapshot[] = [];
    for (let tick = 1; tick <= 6; tick++) {
      for (const cmd of schedule.get(tick) ?? []) sim.enqueue(cmd);
      sim.step();
      snaps.push(sim.snapshot());
    }
    // The settler spawned at tick 3 is the highest-id entity in the final snapshot.
    const last = snaps[snaps.length - 1] as WorldSnapshot;
    const settlerId = Math.max(...last.entities.map((e) => e.id));

    // dumpEntity at the final tick yields its real components (a settler has at least a Position).
    const dump = dumpEntity(last, settlerId);
    expect(dump).not.toBeNull();
    expect(Object.keys(dump?.components ?? {}).length).toBeGreaterThan(0);

    // traceEntity over the window: absent before tick 3, spawns at tick 3, alive after.
    const trace = traceEntity(snaps, settlerId);
    expect(trace).toHaveLength(6);
    const spawnStep = trace.find((s) => s.spawned);
    expect(spawnStep?.tick).toBe(3); // schedule put the spawnSettler command on tick 3
    // Before the spawn the entity is not alive; from the spawn on it is.
    expect(trace.slice(0, 2).every((s) => !s.alive)).toBe(true);
    expect(trace.slice(2).every((s) => s.alive)).toBe(true);

    // A pure function: re-tracing the same snapshots is byte-identical.
    expect(traceEntity(snaps, settlerId)).toEqual(trace);
  });
});
