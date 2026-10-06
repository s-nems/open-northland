import { describe, expect, it } from 'vitest';
import { clonePlain } from '../../src/inspect/plain-clone.js';
import {
  DeltaColumns,
  DeltaShapes,
  deltaValues,
  type SnapshotDelta,
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

describe('delta shapes', () => {
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
    const columns = next.columns();
    expect(
      deltaValues({ ...columns, tick: 0, sequence: 0, rebuild: false, removed: [], events: [] }),
    ).toEqual([{ v: 7, on: true }]);
    expect(columns.changes).toEqual([{ written: ['C1'], removed: [] }]);
  });
});
