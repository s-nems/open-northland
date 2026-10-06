import type { SimEvent } from '../core/events.js';
import { isPlainRecord, PROTO_KEY } from '../core/plain-value.js';
import type { DeltaDigest } from './entity-digest.js';
import { clonePlain } from './plain-clone.js';

/**
 * The changes of one stretch of ticks, in the shape a mirror rebuilds the snapshot from and a worker
 * boundary carries whole: plain data, structured-cloneable like the snapshot itself. Stored by column,
 * so a structured clone copies no object per touched entity, and none for a component whose fields are
 * all numbers, booleans, strings or null, which travels as numbers and strings under a key list sent
 * once (`deltaValues` rebuilds it). The
 * per-entity and per-value columns are typed arrays, which a structured clone copies as bytes where it
 * writes and reads a plain array element by element.
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
  /** Every entity created or mutated since the base and still alive, ascending. Entity ids stay
   *  within int32: the save caps them there. */
  readonly touched: Int32Array;
  /** Per `touched` entity, its entry in `changes`. */
  readonly changeOf: Int32Array;
  /** The distinct changes the touched entities made. An entity the base did not hold writes all of
   *  its components. */
  readonly changes: readonly EntityChange[];
  /** Per written component, per `touched` entity in turn and in its change's `written` order: the
   *  entry of `recordKeys` its value is a record of, or {@link WHOLE_VALUE}. */
  readonly valueKinds: Int32Array;
  /** The key lists of the records whose fields are all scalars. */
  readonly recordKeys: readonly (readonly string[])[];
  /** Per `recordKeys` entry, one {@link FIELD} character per key: how its field travels. */
  readonly recordFields: readonly string[];
  /** Those records' number and boolean fields, record after record, each in its key list's order. */
  readonly numbers: Float64Array;
  /** Those records' string fields, in the same order. */
  readonly strings: readonly string[];
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

/** How a scalar record's field travels: a number or a boolean (0 or 1) in `numbers`, a string in
 *  `strings`, a null in neither. */
const FIELD = { NUMBER: 'n', BOOLEAN: 'b', STRING: 's', NULL: 'z' } as const;
type FieldKind = (typeof FIELD)[keyof typeof FIELD];
/** The field kinds by index: the scalar reader keeps a field's kind as its index here. */
const FIELD_KINDS: readonly FieldKind[] = [FIELD.NUMBER, FIELD.BOOLEAN, FIELD.STRING, FIELD.NULL];
const NUMBER_KIND = 0;
const BOOLEAN_KIND = 1;
const STRING_KIND = 2;
const NULL_KIND = 3;

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
  | 'recordFields'
  | 'numbers'
  | 'strings'
  | 'values';

/** A delta listed by entity: what {@link packSnapshotDelta} stores by column. */
export type EntitySnapshotDelta = Omit<SnapshotDelta, DeltaColumnFields> & {
  readonly touched: readonly EntityDelta[];
};

const NO_NAMES: readonly string[] = [];
const NO_CHANGE = -1;
/** Room for a first delta's worth of entries in each column; a column doubles past it. */
const INITIAL_COLUMN = 1024;

/** A growable `Int32Array`. */
class IntColumn {
  private items = new Int32Array(INITIAL_COLUMN);
  private count = 0;

  push(item: number): void {
    if (this.count === this.items.length) {
      const grown = new Int32Array(this.items.length * 2);
      grown.set(this.items);
      this.items = grown;
    }
    this.items[this.count++] = item;
  }

  /** The entries pushed so far, as an array of their own. */
  taken(): Int32Array {
    return this.items.slice(0, this.count);
  }
}

/** A scalar record's keys in order and how each field travels; interned per stream, so its entry in a
 *  delta's `recordKeys` is found without rebuilding the key list. */
interface RecordLayout {
  readonly keys: readonly string[];
  readonly fields: string;
  /** `fields` as {@link FIELD_KINDS} indices, which the hot loop compares. */
  readonly kinds: readonly number[];
  /** Its entry in the `recordKeys` of the delta stamped `epoch`. */
  at: number;
  epoch: number;
}

/** One step of the changes met so far: the names written or dropped after it lead on. */
interface ChangeStep {
  readonly written: Map<string, ChangeStep>;
  readonly dropped: Map<string, ChangeStep>;
  /** The entry in `changes` of the change that ends here in the delta stamped `changeEpoch`. */
  change: number;
  changeEpoch: number;
  /** The layout of the last record written at this step, which the next one usually repeats. */
  lastLayout: RecordLayout | null;
  /** Every layout written at this step: a component whose optional fields come and go has a few. */
  readonly layouts: RecordLayout[];
  /** The change that ends here, the same names in every delta. */
  entityChange: EntityChange | null;
}

const NO_EPOCH = 0;

function changeStep(): ChangeStep {
  return {
    written: new Map(),
    dropped: new Map(),
    change: NO_CHANGE,
    changeEpoch: NO_EPOCH,
    lastLayout: null,
    layouts: [],
    entityChange: null,
  };
}

function stepAfter(steps: Map<string, ChangeStep>, name: string): ChangeStep {
  let step = steps.get(name);
  if (step === undefined) {
    step = changeStep();
    steps.set(name, step);
  }
  return step;
}

/** The change paths and record layouts one stream met so far, kept from delta to delta so a delta
 *  allocates neither again; each delta numbers its own entries under a new epoch. */
export class DeltaShapes {
  readonly firstStep = changeStep();
  readonly layouts = new Map<string, RecordLayout>();
  epoch = NO_EPOCH;
}

/** Builds a delta's columns one entity at a time; entities go in ascending id order. */
export class DeltaColumns {
  private readonly touched = new IntColumn();
  private readonly changeOf = new IntColumn();
  private readonly changes: EntityChange[] = [];
  private readonly valueKinds = new IntColumn();
  private readonly recordKeys: (readonly string[])[] = [];
  private readonly recordFields: string[] = [];
  private numbers = new Float64Array(INITIAL_COLUMN);
  private numberCount = 0;
  private readonly strings: string[] = [];
  private readonly values: unknown[] = [];
  private readonly epoch: number;
  /** The open entity's change so far, and its names, which a change met for the first time keeps.
   *  Counted rather than truncated, so the name lists keep their storage from entity to entity. */
  private step: ChangeStep;
  private readonly written: string[] = [];
  private writtenCount = 0;
  private readonly dropped: string[] = [];
  private droppedCount = 0;
  /** The keys and field kinds of the record being read, for a layout met for the first time. */
  private readonly recordKeyScratch: string[] = [];
  private readonly recordKindScratch: number[] = [];

  constructor(private readonly shapes = new DeltaShapes()) {
    this.epoch = ++shapes.epoch;
    this.step = shapes.firstStep;
  }

  begin(id: number): void {
    this.touched.push(id);
    this.step = this.shapes.firstStep;
    this.writtenCount = 0;
    this.droppedCount = 0;
  }

  /** Write a value read off the live world: a plain record whose fields are all scalars, a cleared
   *  `undefined` one aside, goes straight into the columns, any other value as its {@link clonePlain}.
   *  Either way the columns end as {@link write} of the clone leaves them. */
  writeLive(name: string, value: unknown): void {
    this.written[this.writtenCount++] = name;
    this.step = stepAfter(this.step.written, name);
    const kind = isPlainRecord(value) ? this.scalarRecordKind(this.step, value, true) : WHOLE_VALUE;
    this.valueKinds.push(kind);
    // A field that fails the scalar test fails it in the clone too, so the clone needs no second look.
    if (kind === WHOLE_VALUE) this.values.push(clonePlain(value));
  }

  /** Write a detached value, kept as the delta's own unless its fields are all scalars. */
  write(name: string, value: unknown): void {
    this.written[this.writtenCount++] = name;
    this.step = stepAfter(this.step.written, name);
    const kind = this.scalarRecordKind(this.step, value, false);
    this.valueKinds.push(kind);
    if (kind === WHOLE_VALUE) this.values.push(value);
  }

  drop(name: string): void {
    this.dropped[this.droppedCount++] = name;
    this.step = stepAfter(this.step.dropped, name);
  }

  end(): void {
    const { step } = this;
    if (step.changeEpoch !== this.epoch) {
      step.changeEpoch = this.epoch;
      step.change = this.changes.length;
      step.entityChange ??= {
        written: this.written.slice(0, this.writtenCount),
        removed: this.droppedCount === 0 ? NO_NAMES : this.dropped.slice(0, this.droppedCount),
      };
      this.changes.push(step.entityChange);
    }
    this.changeOf.push(step.change);
  }

  /** The columns as a delta's fields. */
  columns(): Pick<SnapshotDelta, DeltaColumnFields> {
    return {
      touched: this.touched.taken(),
      changeOf: this.changeOf.taken(),
      changes: this.changes,
      valueKinds: this.valueKinds.taken(),
      recordKeys: this.recordKeys,
      recordFields: this.recordFields,
      numbers: this.numbers.slice(0, this.numberCount),
      strings: this.strings,
      values: this.values,
    };
  }

  /** Push the fields of a record whose fields are all scalars and answer its key list's entry, or answer
   *  {@link WHOLE_VALUE} for any other value and push nothing. A record is any non-array object: a
   *  structured clone keeps no prototype either. `skipUndefined` leaves out a field holding `undefined`,
   *  as the clone of a live value does. */
  private scalarRecordKind(step: ChangeStep, value: unknown, skipUndefined: boolean): number {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return WHOLE_VALUE;
    const record = value as Record<string, unknown>;
    const numberStart = this.numberCount;
    const stringStart = this.strings.length;
    const last = step.lastLayout;
    // While the record repeats the step's last layout, its keys and kinds are that layout's; the scratch
    // lists are filled only once it parts from it.
    let matched = last === null ? 0 : -1;
    let count = 0;
    for (const key in record) {
      const field = record[key];
      let kind: number;
      if (typeof field === 'number') {
        this.pushNumber(field);
        kind = NUMBER_KIND;
      } else if (typeof field === 'boolean') {
        this.pushNumber(field ? 1 : 0);
        kind = BOOLEAN_KIND;
      } else if (typeof field === 'string') {
        this.strings.push(field);
        kind = STRING_KIND;
      } else if (field === null) kind = NULL_KIND;
      else if (field === undefined && skipUndefined) continue;
      else kind = -1;
      if (kind < 0 || key === PROTO_KEY) {
        this.numberCount = numberStart;
        this.strings.length = stringStart;
        return WHOLE_VALUE;
      }
      if (matched < 0 && last !== null && (last.keys[count] !== key || last.kinds[count] !== kind)) {
        matched = count;
        for (let k = 0; k < count; k++) {
          this.recordKeyScratch[k] = last.keys[k] as string;
          this.recordKindScratch[k] = last.kinds[k] as number;
        }
      }
      if (matched >= 0) {
        this.recordKeyScratch[count] = key;
        this.recordKindScratch[count] = kind;
      }
      count++;
    }
    let layout: RecordLayout;
    if (last !== null && matched < 0 && last.keys.length === count) layout = last;
    else {
      if (matched < 0 && last !== null) {
        // A prefix of the last layout: its keys are still to be copied.
        for (let k = 0; k < count; k++) {
          this.recordKeyScratch[k] = last.keys[k] as string;
          this.recordKindScratch[k] = last.kinds[k] as number;
        }
      }
      layout = this.layoutAt(step, count);
    }
    step.lastLayout = layout;
    if (layout.epoch !== this.epoch) {
      layout.epoch = this.epoch;
      layout.at = this.recordKeys.length;
      this.recordKeys.push(layout.keys);
      this.recordFields.push(layout.fields);
    }
    return layout.at;
  }

  /** The layout of the record just read into the scratch lists, among those met at `step` or else
   *  interned for it. */
  private layoutAt(step: ChangeStep, count: number): RecordLayout {
    for (const layout of step.layouts) {
      if (layout.keys.length !== count) continue;
      let same = true;
      for (let k = 0; k < count && same; k++) {
        same = layout.keys[k] === this.recordKeyScratch[k] && layout.kinds[k] === this.recordKindScratch[k];
      }
      if (same) return layout;
    }
    const layout = this.layoutOf(count);
    step.layouts.push(layout);
    return layout;
  }

  /** The interned layout of the record just read into the scratch lists. */
  private layoutOf(count: number): RecordLayout {
    const keys = this.recordKeyScratch.slice(0, count);
    const kinds = this.recordKindScratch.slice(0, count);
    const fields = kinds.map((kind) => FIELD_KINDS[kind] as FieldKind).join('');
    const name = `${fields}:${keys.join(',')}`;
    let layout = this.shapes.layouts.get(name);
    if (layout === undefined) {
      layout = { keys, fields, kinds, at: WHOLE_VALUE, epoch: NO_EPOCH };
      this.shapes.layouts.set(name, layout);
    }
    return layout;
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
  const { valueKinds, recordKeys, recordFields, numbers, strings, values } = delta;
  const out: unknown[] = new Array(valueKinds.length);
  let number = 0;
  let string = 0;
  let whole = 0;
  for (let i = 0; i < valueKinds.length; i++) {
    const kind = valueKinds[i] ?? WHOLE_VALUE;
    const keys = recordKeys[kind];
    const fields = recordFields[kind];
    if (keys === undefined || fields === undefined) {
      out[i] = values[whole++];
      continue;
    }
    const record: Record<string, unknown> = {};
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k] as string;
      const field = fields[k];
      if (field === FIELD.NUMBER) record[key] = numbers[number++];
      else if (field === FIELD.BOOLEAN) record[key] = numbers[number++] !== 0;
      else if (field === FIELD.STRING) record[key] = strings[string++];
      else record[key] = null;
    }
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
  return Array.from(delta.touched, (id, i) => {
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
