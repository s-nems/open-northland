import type { SimEvent } from '../core/events.js';
import { isPlainRecord, PROTO_KEY } from '../core/plain-value.js';
import type { DeltaDigest } from './entity-digest.js';
import { clonePlain } from './plain-clone.js';

/**
 * The changes of one stretch of ticks, in the shape a mirror rebuilds the snapshot from and a worker
 * boundary carries whole: plain data, structured-cloneable like the snapshot itself. Stored by column,
 * so a structured clone copies no object per touched entity, and none for a component whose fields are
 * all numbers, which travels as numbers under a key list sent once (`deltaValues` rebuilds it).
 */
export interface SnapshotDelta {
  /** The tick the delta brings a mirror to. */
  readonly tick: number;
  /** The delta's place in its stream, counting from 0 and including rebuilds: a mirror refuses a
   *  non-rebuild delta that does not directly follow the one it applied last. */
  readonly sequence: number;
  /** The touched log overflowed or the stream just opened: `touched` names every alive entity, each
   *  writing all of its components, and the mirror replaces its whole list. */
  readonly rebuild: boolean;
  /** Every entity created or mutated since the base and still alive, ascending. */
  readonly touched: readonly number[];
  /** Per `touched` entity, its entry in `changes`. */
  readonly changeOf: readonly number[];
  /** The distinct changes the touched entities made. An entity the base did not hold writes all of
   *  its components. */
  readonly changes: readonly EntityChange[];
  /** Per written component, per `touched` entity in turn and in its change's `written` order: the
   *  entry of `recordKeys` its value is a record of, or {@link WHOLE_VALUE}. */
  readonly valueKinds: readonly number[];
  /** The key lists of the records whose fields are all numbers. */
  readonly recordKeys: readonly (readonly string[])[];
  /** Those records' fields, record after record, each in its key list's order. */
  readonly numbers: Float64Array;
  /** The other written values, fresh clones, in turn. */
  readonly values: readonly unknown[];
  /** Ids destroyed since the base, ascending; empty with `rebuild`. May name an entity that was
   *  created and destroyed inside the stretch, which the mirror never held. */
  readonly removed: readonly number[];
  /** The events of `tick`, as the snapshot carries them. */
  readonly events: readonly SimEvent[];
  /** The world at `tick` as a stream opened with `digest` folds it, for `MirrorTruth` to compare. */
  readonly digest?: DeltaDigest;
}

/** A {@link SnapshotDelta.valueKinds} entry for a value carried whole in `values`. */
export const WHOLE_VALUE = -1;

/** What one touched entity changed since the base, shared by every entity that changed the same. */
export interface EntityChange {
  /** The components written since the base, in the order a fresh snapshot lists them. */
  readonly written: readonly string[];
  /** The components the entity no longer carries; may name one it gained and lost again since the
   *  base, which the mirror never held. */
  readonly removed: readonly string[];
}

/** One touched entity's changes, as a hand-made delta lists them and {@link entityDeltas} reads them. */
export interface EntityDelta {
  readonly id: number;
  /** componentName -> a fresh clone, for the components written since the base. */
  readonly components: Readonly<Record<string, unknown>>;
  /** The components the entity carried at the base and no longer does. */
  readonly removed: readonly string[];
}

type DeltaColumnFields =
  | 'touched'
  | 'changeOf'
  | 'changes'
  | 'valueKinds'
  | 'recordKeys'
  | 'numbers'
  | 'values';

/** A delta listed by entity: what {@link packSnapshotDelta} stores by column. */
export type EntitySnapshotDelta = Omit<SnapshotDelta, DeltaColumnFields> & {
  readonly touched: readonly EntityDelta[];
};

const NO_NAMES: readonly string[] = [];
const NO_CHANGE = -1;
/** Room for the numeric fields of a first delta's worth of records; the buffer doubles past it. */
const INITIAL_NUMBERS = 1024;

/** One step of the changes met so far: the names written or dropped after it lead on. */
interface ChangeStep {
  readonly written: Map<string, ChangeStep>;
  readonly dropped: Map<string, ChangeStep>;
  /** The entry in `changes` of a change that ends here, or {@link NO_CHANGE}. */
  change: number;
  /** The `recordKeys` entry of the last value written at this step, which the next one usually
   *  repeats, or {@link WHOLE_VALUE}. */
  lastRecord: number;
}

function changeStep(): ChangeStep {
  return { written: new Map(), dropped: new Map(), change: NO_CHANGE, lastRecord: WHOLE_VALUE };
}

function stepAfter(steps: Map<string, ChangeStep>, name: string): ChangeStep {
  let step = steps.get(name);
  if (step === undefined) {
    step = changeStep();
    steps.set(name, step);
  }
  return step;
}

/** Builds a delta's columns one entity at a time; entities go in ascending id order. */
export class DeltaColumns {
  private readonly touched: number[] = [];
  private readonly changeOf: number[] = [];
  private readonly changes: EntityChange[] = [];
  private readonly firstStep = changeStep();
  private readonly valueKinds: number[] = [];
  private readonly recordKeys: (readonly string[])[] = [];
  private readonly recordKeysAt = new Map<string, number>();
  private numbers = new Float64Array(INITIAL_NUMBERS);
  private numberCount = 0;
  private readonly values: unknown[] = [];
  /** The open entity's change so far, and its names, which a change met for the first time keeps.
   *  Counted rather than truncated, so the name lists keep their storage from entity to entity. */
  private step = this.firstStep;
  private readonly written: string[] = [];
  private writtenCount = 0;
  private readonly dropped: string[] = [];
  private droppedCount = 0;

  begin(id: number): void {
    this.touched.push(id);
    this.step = this.firstStep;
    this.writtenCount = 0;
    this.droppedCount = 0;
  }

  /** Write a value read off the live world: a plain record whose fields are all numbers, a cleared
   *  `undefined` one aside, goes straight into the numbers column, any other value as its
   *  {@link clonePlain}. Either way the columns end as {@link write} of the clone leaves them. */
  writeLive(name: string, value: unknown): void {
    this.written[this.writtenCount++] = name;
    this.step = stepAfter(this.step.written, name);
    const kind = isPlainRecord(value) ? this.numericRecordKind(this.step, value, true) : WHOLE_VALUE;
    this.valueKinds.push(kind);
    // A field that fails the numeric test fails it in the clone too, so the clone needs no second look.
    if (kind === WHOLE_VALUE) this.values.push(clonePlain(value));
  }

  /** Write a detached value, kept as the delta's own unless its fields are all numbers. */
  write(name: string, value: unknown): void {
    this.written[this.writtenCount++] = name;
    this.step = stepAfter(this.step.written, name);
    const kind = this.numericRecordKind(this.step, value, false);
    this.valueKinds.push(kind);
    if (kind === WHOLE_VALUE) this.values.push(value);
  }

  drop(name: string): void {
    this.dropped[this.droppedCount++] = name;
    this.step = stepAfter(this.step.dropped, name);
  }

  end(): void {
    const { step } = this;
    if (step.change === NO_CHANGE) {
      step.change = this.changes.length;
      this.changes.push({
        written: this.written.slice(0, this.writtenCount),
        removed: this.droppedCount === 0 ? NO_NAMES : this.dropped.slice(0, this.droppedCount),
      });
    }
    this.changeOf.push(step.change);
  }

  /** The columns as a delta's fields. */
  columns(): Pick<SnapshotDelta, DeltaColumnFields> {
    return {
      touched: this.touched,
      changeOf: this.changeOf,
      changes: this.changes,
      valueKinds: this.valueKinds,
      recordKeys: this.recordKeys,
      numbers: this.numbers.slice(0, this.numberCount),
      values: this.values,
    };
  }

  /** Push the fields of a record whose fields are all numbers and answer its key list's entry, or answer
   *  {@link WHOLE_VALUE} for any other value and push nothing. A record is any non-array object: a
   *  structured clone keeps no prototype either. `skipUndefined` leaves out a field holding `undefined`,
   *  as the clone of a live value does. */
  private numericRecordKind(step: ChangeStep, value: unknown, skipUndefined: boolean): number {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return WHOLE_VALUE;
    const record = value as Record<string, unknown>;
    const start = this.numberCount;
    const last = step.lastRecord;
    const lastKeys = this.recordKeys[last];
    let matchesLast = lastKeys !== undefined;
    let count = 0;
    let skipped = false;
    for (const key in record) {
      const field = record[key];
      if (field === undefined && skipUndefined) {
        skipped = true;
        continue;
      }
      if (typeof field !== 'number' || key === PROTO_KEY) {
        this.numberCount = start;
        return WHOLE_VALUE;
      }
      this.pushNumber(field);
      if (matchesLast && lastKeys?.[count] !== key) matchesLast = false;
      count++;
    }
    if (matchesLast && lastKeys?.length === count) return last;
    const keys = skipped
      ? Object.keys(record).filter((key) => record[key] !== undefined)
      : Object.keys(record);
    const joined = keys.join(',');
    let at = this.recordKeysAt.get(joined);
    if (at === undefined) {
      at = this.recordKeys.length;
      this.recordKeys.push(keys);
      this.recordKeysAt.set(joined, at);
    }
    step.lastRecord = at;
    return at;
  }

  private pushNumber(field: number): void {
    if (this.numberCount === this.numbers.length) {
      const grown = new Float64Array(this.numbers.length * 2);
      grown.set(this.numbers);
      this.numbers = grown;
    }
    this.numbers[this.numberCount++] = field;
  }
}

/** The written values of `delta` in turn, per touched entity in its change's `written` order. */
export function deltaValues(delta: SnapshotDelta): unknown[] {
  const { valueKinds, recordKeys, numbers, values } = delta;
  const out: unknown[] = new Array(valueKinds.length);
  let field = 0;
  let whole = 0;
  for (let i = 0; i < valueKinds.length; i++) {
    const keys = recordKeys[valueKinds[i] ?? WHOLE_VALUE];
    if (keys === undefined) {
      out[i] = values[whole++];
      continue;
    }
    const record: Record<string, unknown> = {};
    for (const key of keys) record[key] = numbers[field++];
    out[i] = record;
  }
  return out;
}

/** Store a delta listed by entity by column, the shape a stream emits. */
export function packSnapshotDelta(delta: EntitySnapshotDelta): SnapshotDelta {
  const columns = new DeltaColumns();
  for (const entry of delta.touched) {
    columns.begin(entry.id);
    for (const name in entry.components) columns.write(name, entry.components[name]);
    for (const name of entry.removed) columns.drop(name);
    columns.end();
  }
  return { ...delta, ...columns.columns() };
}

/** The delta's touched entities one by one, as {@link packSnapshotDelta} took them. */
export function entityDeltas(delta: SnapshotDelta): EntityDelta[] {
  const values = deltaValues(delta);
  let at = 0;
  return delta.touched.map((id, i) => {
    const change = changeAt(delta, i);
    const components: Record<string, unknown> = {};
    for (const name of change.written) components[name] = values[at++];
    return { id, components, removed: change.removed };
  });
}

/** The change of the delta's `i`th touched entity. */
export function changeAt(delta: SnapshotDelta, i: number): EntityChange {
  const change = delta.changes[delta.changeOf[i] ?? -1];
  if (change === undefined) throw new Error(`snapshot delta ${delta.sequence}: entity ${i} has no change`);
  return change;
}
