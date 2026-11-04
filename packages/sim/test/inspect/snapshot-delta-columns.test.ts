import { describe, expect, it } from 'vitest';
import { clonePlain } from '../../src/inspect/plain-clone.js';
import {
  DeltaColumns,
  DeltaShapes,
  deltaChanges,
  deltaValues,
  type SnapshotDelta,
  touchedIds,
} from '../../src/inspect/snapshot-delta.js';

const ENTITY = 1;

function columnsOf(write: (columns: DeltaColumns) => void): ReturnType<DeltaColumns['columns']> {
  const columns = new DeltaColumns();
  columns.begin(ENTITY);
  write(columns);
  columns.end();
  return columns.columns();
}

const nullProto: Record<string, unknown> = Object.create(null);
nullProto.a = 1;
nullProto.b = 2;

/** Live component values of every shape the clone treats differently. */
const LIVE: ReadonlyArray<readonly [string, unknown]> = [
  ['numbers', { x: 3, y: -4 }],
  ['cleared', { x: 3, cleared: undefined, y: 5 }],
  ['allCleared', { cleared: undefined }],
  ['clearedAndFlag', { index: 1, cleared: undefined, flag: true }],
  ['nested', { at: { x: 1, y: 2 }, list: [1, 2] }],
  [
    'route',
    {
      waypoints: [
        { x: 1, y: 2, node: 3 },
        { x: 4, y: 5, node: 6 },
      ],
      label: 'r',
    },
  ],
  ['mixed', { list: [1, true, 'a', null, [2, [3]], { deep: { on: false } }], empty: [], none: {} }],
  [
    'nestedMap',
    {
      lines: new Map([
        [2, { wanted: 1 }],
        [1, { wanted: 0, cleared: undefined }],
      ]),
    },
  ],
  [
    'unevenRecords',
    {
      cycles: [{ a: 1 }, { a: 2 }, { b: 'x' }],
      pairs: [
        [1, 2],
        [3, 4],
      ],
    },
  ],
  ['holeyList', { list: [1, undefined, 2] }],
  [
    'map',
    new Map([
      [2, 'b'],
      [1, 'a'],
    ]),
  ],
  ['nullProto', nullProto],
  ['scalar', 7],
];

describe('delta columns from live values', () => {
  it('end as writing each value cloned would leave them', () => {
    const live = columnsOf((columns) => {
      for (const [name, value] of LIVE) columns.writeLive(name, value);
    });
    const cloned = columnsOf((columns) => {
      for (const [name, value] of LIVE) columns.write(name, clonePlain(value));
    });
    expect(live).toStrictEqual(cloned);
  });

  it('carry nested records and arrays in the columns and read them back as their clones', () => {
    const carried = LIVE.filter(([name]) =>
      ['nested', 'route', 'mixed', 'nestedMap', 'unevenRecords'].includes(name),
    );
    const columns = columnsOf((c) => {
      for (const [name, value] of carried) c.writeLive(name, value);
    });
    expect(columns.values).toEqual([]);
    const delta: SnapshotDelta = {
      ...columns,
      tick: 0,
      sequence: 0,
      rebuild: false,
      removed: [],
      events: [],
    };
    expect(deltaValues(delta)).toStrictEqual(carried.map(([, value]) => clonePlain(value)));
  });

  it('hand out no live object', () => {
    const nested = { at: { x: 1 } };
    const delta: SnapshotDelta = {
      tick: 0,
      sequence: 0,
      rebuild: false,
      removed: [],
      events: [],
      ...columnsOf((columns) => columns.writeLive('nested', nested)),
    };
    nested.at.x = 2;
    expect(deltaValues(delta)).toStrictEqual([{ at: { x: 1 } }]);
  });

  it('refuse a class instance as the clone does', () => {
    class Shaped {
      x = 1;
    }
    expect(() => columnsOf((columns) => columns.writeLive('shaped', new Shaped()))).toThrow(/uncloneable/);
  });
});

describe('delta column element types', () => {
  const deltaOf = (columns: DeltaColumns): SnapshotDelta => ({
    ...columns.columns(),
    tick: 0,
    sequence: 0,
    rebuild: false,
    removed: [],
    events: [],
  });

  it('carry 32-bit integer numbers in an Int32Array and any other beside them in a Float64Array', () => {
    const whole = columnsOf((columns) => columns.writeLive('P', { x: 2 ** 31 - 1, y: -(2 ** 31), on: true }));
    expect(Array.from(whole.numbers)).toEqual([2 ** 31 - 1, -(2 ** 31), 1]);
    expect(whole.floats).toHaveLength(0);
    for (const odd of [2 ** 31, 0.5, -0, Number.NaN]) {
      const columns = new DeltaColumns();
      columns.begin(ENTITY);
      columns.writeLive('P', { x: 1, y: odd, list: [2, odd], only: [odd, odd] });
      columns.end();
      const delta = deltaOf(columns);
      expect(delta.floats).toHaveLength(4);
      expect(deltaValues(delta)).toStrictEqual([{ x: 1, y: odd, list: [2, odd], only: [odd, odd] }]);
    }
  });

  it('widen the per-entity and per-value columns once an entry passes 16 bits', () => {
    const narrow = columnsOf((columns) => columns.writeLive('P', { x: 1 }));
    expect(narrow.changes).toBeInstanceOf(Int16Array);
    expect(narrow.changeOf).toBeInstanceOf(Int16Array);
    // Each entity writes a component of its own, so the change entries pass 16 bits.
    const CHANGES = 1 << 15;
    const columns = new DeltaColumns();
    for (let id = 1; id <= CHANGES + 1; id++) {
      columns.begin(id);
      columns.writeLive(`C${id}`, 7);
      columns.end();
    }
    const wide = deltaOf(columns);
    expect(wide.changeOf).toBeInstanceOf(Int32Array);
    expect(wide.changeOf[CHANGES]).toBe(CHANGES);
  });

  it('read touched ids back across gaps past 16 bits, in 16 bits until a gap passes 31', () => {
    const idsOf = (ids: readonly number[]): SnapshotDelta => {
      const columns = new DeltaColumns();
      for (const id of ids) {
        columns.begin(id);
        columns.end();
      }
      return deltaOf(columns);
    };
    const near = [0, 1, 40_000, 40_001, 2 ** 30 - 1];
    expect(idsOf(near).touchedGaps).toBeInstanceOf(Int16Array);
    expect(Array.from(touchedIds(idsOf(near)))).toEqual(near);
    const far = [5, 2 ** 31 - 1];
    expect(idsOf(far).touchedGaps).toBeInstanceOf(Int32Array);
    expect(Array.from(touchedIds(idsOf(far)))).toEqual(far);
    expect(() => idsOf([3, 3])).toThrow(/must ascend/);
  });
});

describe('delta shapes', () => {
  it('lends its column storage to one delta at a time, each delta keeping its own copy', () => {
    const shapes = new DeltaShapes();
    const deltaOf = (columns: DeltaColumns) => ({
      ...columns.columns(),
      tick: 0,
      sequence: 0,
      rebuild: false,
      removed: [],
      events: [],
    });
    // Past the initial storage, so the second delta reuses grown columns.
    const ENTITIES = 3000;
    const first = new DeltaColumns(shapes);
    for (let id = 1; id <= ENTITIES; id++) {
      first.begin(id);
      first.writeLive('P', { x: id, y: -id });
      first.end();
    }
    const firstDelta = deltaOf(first);
    const second = new DeltaColumns(shapes);
    second.begin(7);
    second.writeLive('P', { x: 70, y: 71 });
    second.end();
    const secondDelta = deltaOf(second);
    expect(deltaValues(secondDelta)).toEqual([{ x: 70, y: 71 }]);
    expect(Array.from(touchedIds(secondDelta))).toEqual([7]);
    const values = deltaValues(firstDelta);
    expect(values).toHaveLength(ENTITIES);
    expect(values[0]).toEqual({ x: 1, y: -1 });
    expect(values[ENTITIES - 1]).toEqual({ x: ENTITIES, y: -ENTITIES });
  });

  it('starts over past its bound and still writes exact deltas', () => {
    const shapes = new DeltaShapes();
    // Each entity writes a component of its own: one new change step apiece.
    const MANY = (1 << 16) + 2;
    const filling = new DeltaColumns(shapes);
    for (let id = 1; id <= MANY; id++) {
      filling.begin(id);
      filling.writeLive(`C${id}`, { v: id });
      filling.end();
    }
    const kept = shapes.firstStep;
    const next = new DeltaColumns(shapes);
    expect(shapes.firstStep).not.toBe(kept);
    next.begin(1);
    next.writeLive('C1', { v: 7, on: true });
    next.end();
    const delta = { ...next.columns(), tick: 0, sequence: 0, rebuild: false, removed: [], events: [] };
    expect(deltaValues(delta)).toEqual([{ v: 7, on: true }]);
    expect(deltaChanges(delta)).toEqual([{ written: ['C1'], kinds: [0], removed: [] }]);
  });
});
