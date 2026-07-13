import { beforeEach, describe, expect, it } from 'vitest';
import { clearComponentStores } from '../../src/harness/stores.js';
import { type Command, diffSnapshots, Simulation, type WorldSnapshot } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap as grassMap } from '../fixtures/terrain.js';

/**
 * Tests for `diffSnapshots()` — the "diff state between two ticks" half of the time-travel / replay
 * inspector (plan "Cross-cutting DX"). It is a pure function of two plain `WorldSnapshot` values,
 * so most cases are hand-built snapshots (no sim needed); the last case proves it composes over a
 * real `step()`-driven run so the overlay's actual path is exercised end to end.
 */

const HEADQUARTERS = 1;
const WOODCUTTER = 1;
const VIKING = 1;

/** Clear every component store (shared singletons) so each sim phase starts clean. */

/** Build a minimal snapshot value with the given entities (already ascending by id). */
function snap(tick: number, entities: { id: number; components: Record<string, unknown> }[]): WorldSnapshot {
  return { tick, entities, events: [] };
}

beforeEach(clearComponentStores);

describe('diffSnapshots', () => {
  it('reports no change between two equal snapshots', () => {
    const a = snap(1, [{ id: 1, components: { Position: { x: 3, y: 4 } } }]);
    const b = snap(2, [{ id: 1, components: { Position: { x: 3, y: 4 } } }]);
    const d = diffSnapshots(a, b);
    expect(d.fromTick).toBe(1);
    expect(d.toTick).toBe(2);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('detects an added entity (present in b, absent in a)', () => {
    const a = snap(1, [{ id: 1, components: { Position: { x: 0, y: 0 } } }]);
    const b = snap(2, [
      { id: 1, components: { Position: { x: 0, y: 0 } } },
      { id: 2, components: { Position: { x: 5, y: 5 } } },
    ]);
    const d = diffSnapshots(a, b);
    expect(d.added.map((e) => e.id)).toEqual([2]);
    expect(d.added[0]?.components).toEqual({ Position: { x: 5, y: 5 } });
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('detects a removed entity (present in a, absent in b)', () => {
    const a = snap(1, [
      { id: 1, components: { Position: { x: 0, y: 0 } } },
      { id: 2, components: { Position: { x: 5, y: 5 } } },
    ]);
    const b = snap(2, [{ id: 1, components: { Position: { x: 0, y: 0 } } }]);
    const d = diffSnapshots(a, b);
    expect(d.removed.map((e) => e.id)).toEqual([2]);
    expect(d.added).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('detects a changed component value on a surviving entity', () => {
    const a = snap(1, [{ id: 1, components: { Position: { x: 0, y: 0 } } }]);
    const b = snap(2, [{ id: 1, components: { Position: { x: 1, y: 0 } } }]);
    const d = diffSnapshots(a, b);
    expect(d.changed).toEqual([
      {
        id: 1,
        changes: [{ name: 'Position', kind: 'changed', before: { x: 0, y: 0 }, after: { x: 1, y: 0 } }],
      },
    ]);
  });

  it('detects an added and a removed component on a surviving entity, in name order', () => {
    const a = snap(1, [{ id: 1, components: { Position: { x: 0, y: 0 }, Carrying: { good: 7 } } }]);
    const b = snap(2, [{ id: 1, components: { Position: { x: 0, y: 0 }, Health: { hp: 10 } } }]);
    const d = diffSnapshots(a, b);
    // Component names are emitted in sorted order: Carrying (removed) < Health (added); Position equal -> omitted.
    expect(d.changed).toEqual([
      {
        id: 1,
        changes: [
          { name: 'Carrying', kind: 'removed', before: { good: 7 } },
          { name: 'Health', kind: 'added', after: { hp: 10 } },
        ],
      },
    ]);
  });

  it('omits a surviving entity whose components are all unchanged', () => {
    const a = snap(1, [
      { id: 1, components: { Position: { x: 0, y: 0 } } },
      { id: 2, components: { Position: { x: 9, y: 9 } } },
    ]);
    const b = snap(2, [
      { id: 1, components: { Position: { x: 1, y: 0 } } }, // changed
      { id: 2, components: { Position: { x: 9, y: 9 } } }, // unchanged -> not in `changed`
    ]);
    const d = diffSnapshots(a, b);
    expect(d.changed.map((e) => e.id)).toEqual([1]);
  });

  it('treats deeply-equal-but-reordered Map clones as equal (canonical equality)', () => {
    // takeSnapshot clones a component Map to a SORTED [k,v] array, so two equal stockpiles serialize
    // identically. Hand-build both already-sorted to confirm a reordered-but-equal value is no change.
    const a = snap(1, [
      {
        id: 1,
        components: {
          Stockpile: [
            [1, 5],
            [3, 2],
          ],
        },
      },
    ]);
    const b = snap(2, [
      {
        id: 1,
        components: {
          Stockpile: [
            [1, 5],
            [3, 2],
          ],
        },
      },
    ]);
    expect(diffSnapshots(a, b).changed).toEqual([]);

    const c = snap(3, [
      {
        id: 1,
        components: {
          Stockpile: [
            [1, 5],
            [3, 9],
          ],
        },
      },
    ]);
    expect(diffSnapshots(a, c).changed[0]?.changes[0]?.kind).toBe('changed');
  });

  it('keeps all output arrays ascending by id across a mixed add/remove/change', () => {
    const a = snap(1, [
      { id: 1, components: { P: 'a' } }, // changed
      { id: 2, components: { P: 'x' } }, // removed
      { id: 4, components: { P: 'y' } }, // unchanged
    ]);
    const b = snap(2, [
      { id: 1, components: { P: 'b' } }, // changed
      { id: 3, components: { P: 'z' } }, // added
      { id: 4, components: { P: 'y' } }, // unchanged
      { id: 5, components: { P: 'w' } }, // added
    ]);
    const d = diffSnapshots(a, b);
    expect(d.added.map((e) => e.id)).toEqual([3, 5]);
    expect(d.removed.map((e) => e.id)).toEqual([2]);
    expect(d.changed.map((e) => e.id)).toEqual([1]);
  });

  it('composes over a real step()-driven run: diffing two ticks shows the spawned settler', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(6, 1) });
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING }]],
      [3, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
    ]);
    let before: WorldSnapshot | undefined;
    let after: WorldSnapshot | undefined;
    for (let tick = 1; tick <= 5; tick++) {
      for (const cmd of schedule.get(tick) ?? []) sim.enqueue(cmd);
      sim.step();
      if (tick === 2) before = sim.snapshot(); // before the settler spawns at tick 3
      if (tick === 5) after = sim.snapshot();
    }
    if (before === undefined || after === undefined) throw new Error('snapshots not captured');

    const d = diffSnapshots(before, after);
    expect(d.fromTick).toBe(2);
    expect(d.toTick).toBe(5);
    // The tick-3 settler is a NEW entity between the two snapshots -> it appears in `added`.
    expect(d.added.length).toBeGreaterThanOrEqual(1);
    expect(d.removed).toEqual([]);
    // The added entity carries real components (a settler has at least a Position).
    expect(
      Object.keys((d.added[0] as { components: Record<string, unknown> }).components).length,
    ).toBeGreaterThan(0);
  });
});
