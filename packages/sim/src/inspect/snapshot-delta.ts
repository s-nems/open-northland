import type { SimEvent } from '../core/events.js';
import { isPlainRecord, PROTO_KEY, sortedMapEntries } from '../core/plain-value.js';
import type { DeltaDigest } from './entity-digest.js';
import { addField } from './fast-record.js';
import { clonePlain } from './plain-clone.js';

/**
 * The changes of one stretch of ticks, in the shape a mirror rebuilds the snapshot from and a worker
 * boundary carries whole: plain data, structured-cloneable like the snapshot itself. Stored by column,
 * so a structured clone copies no object per touched entity, and none for a component that is a plain
 * record of numbers, booleans, strings, null and nested records and arrays of those, which travels as
 * numbers and strings under key lists sent once (`deltaValues` rebuilds it). The
 * per-entity and per-value columns are typed arrays, which a structured clone copies as bytes where it
 * writes and reads a plain array element by element, each in the narrowest element type its entries fit.
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
  readonly changeOf: SmallIntColumn;
  /** The distinct changes the touched entities made. An entity the base did not hold writes all of
   *  its components. */
  readonly changes: readonly EntityChange[];
  /** Per written component, per `touched` entity in turn and in its change's `written` order: the
   *  entry of `recordKeys` its value is a record of, or {@link WHOLE_VALUE}. */
  readonly valueKinds: SmallIntColumn;
  /** The key lists of the records whose fields are all scalars. */
  readonly recordKeys: readonly (readonly string[])[];
  /** Per `recordKeys` entry, one {@link FIELD} character per key: how its field travels. */
  readonly recordFields: readonly string[];
  /** Those records' number and boolean fields and the framing of their nested values, record after
   *  record, each in its key list's order: 32-bit integers, as fixed-point state is, unless one of them
   *  is not. */
  readonly numbers: Int32Array | Float64Array;
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

/** A column of small integers: 16-bit while every entry fits, which halves its bytes on the wire. */
export type SmallIntColumn = Int16Array | Int32Array;

const INT16_MIN = -0x8000;
const INT16_MAX = 0x7fff;

/** A {@link SnapshotDelta.valueKinds} entry for a value carried whole in `values`. */
const WHOLE_VALUE = -1;

/** How a record's field travels: a number or a boolean (0 or 1) in `numbers`, a string in `strings`, a
 *  null in neither. A nested record puts its layout's `recordKeys` entry in `numbers`, then its fields;
 *  an array puts its length, then, unless empty, its elements' kind as an index in {@link FIELD_KINDS}
 *  or one of the array kinds below, then each element as a field of that kind travels. */
const FIELD = { NUMBER: 'n', BOOLEAN: 'b', STRING: 's', NULL: 'z', RECORD: 'r', ARRAY: 'a' } as const;
type FieldKind = (typeof FIELD)[keyof typeof FIELD];
/** The field kinds by index: the writer keeps a field's kind as its index here. */
const FIELD_KINDS: readonly FieldKind[] = [
  FIELD.NUMBER,
  FIELD.BOOLEAN,
  FIELD.STRING,
  FIELD.NULL,
  FIELD.RECORD,
  FIELD.ARRAY,
];
const NUMBER_KIND = 0;
const BOOLEAN_KIND = 1;
const STRING_KIND = 2;
const NULL_KIND = 3;
const RECORD_KIND = 4;
const ARRAY_KIND = 5;
/** After an array's length: its elements are records of one layout, whose entry follows once. */
const SAME_LAYOUT_ELEMENTS = 6;
/** After an array's length: each element goes after its own kind. Any other kind there is every
 *  element's. */
const MIXED_ELEMENTS = 7;
/** A field or element the columns cannot carry: its whole value travels cloned. */
const NO_KIND = -1;

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
/** The column storage a stream keeps between deltas: several busy ticks' worth, while a rebuild's
 *  whole-world columns are let go. */
const RETAINED_COLUMN = 1 << 17;

/** A growable `Int32Array`, its storage kept from delta to delta. */
class IntColumn {
  private items = new Int32Array(INITIAL_COLUMN);
  private count = 0;

  /** Empty the column, dropping storage grown past `retained` entries. */
  clear(retained: number): void {
    this.count = 0;
    if (this.items.length > retained) this.items = new Int32Array(INITIAL_COLUMN);
  }

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

  /** {@link taken} in 16 bits when every entry fits. */
  takenSmall(): SmallIntColumn {
    const { items, count } = this;
    for (let i = 0; i < count; i++) {
      const item = items[i] as number;
      if (item < INT16_MIN || item > INT16_MAX) return this.taken();
    }
    const small = new Int16Array(count);
    small.set(items.subarray(0, count));
    return small;
  }
}

/** Whether `value` survives a trip through an `Int32Array`; -0 does not, and the digest tells it apart. */
function isInt32(value: number): boolean {
  return (value | 0) === value && (value !== 0 || 1 / value > 0);
}

/** How an array element travels, or {@link NO_KIND}; a record is checked once it is read. A live `Map`
 *  travels as its entries, as its clone does. */
function kindOfElement(element: unknown, skipUndefined: boolean): number {
  if (typeof element === 'number') return NUMBER_KIND;
  if (typeof element === 'boolean') return BOOLEAN_KIND;
  if (typeof element === 'string') return STRING_KIND;
  if (element === null) return NULL_KIND;
  if (typeof element !== 'object') return NO_KIND;
  return Array.isArray(element) || (skipUndefined && element instanceof Map) ? ARRAY_KIND : RECORD_KIND;
}

/** The kind every element of a non-empty array shares, {@link MIXED_ELEMENTS}, or {@link NO_KIND}. */
function elementsKind(array: readonly unknown[], skipUndefined: boolean): number {
  const kind = kindOfElement(array[0], skipUndefined);
  for (let i = 1; i < array.length && kind !== NO_KIND; i++) {
    const next = kindOfElement(array[i], skipUndefined);
    if (next === NO_KIND) return NO_KIND;
    if (next !== kind) return MIXED_ELEMENTS;
  }
  return kind;
}

/** A record's keys in order and how each field travels; interned per stream, so its entry in a delta's
 *  `recordKeys` is found without rebuilding the key list. */
interface RecordLayout {
  readonly keys: readonly string[];
  readonly fields: string;
  /** `fields` as {@link FIELD_KINDS} indices, which the hot loop compares. */
  readonly kinds: readonly number[];
  /** Its entry in the `recordKeys` of the delta stamped `epoch`. */
  at: number;
  epoch: number;
}

/** The record layouts met at one place in a value: a component's, or a nested field's below it. */
interface LayoutSlot {
  /** The layout of the last record written here, which the next one usually repeats. */
  lastLayout: RecordLayout | null;
  /** Every layout written here: a record whose optional fields come and go has a few. */
  readonly layouts: RecordLayout[];
  /** The slots of the records and arrays under each key of the records written here, made on first
   *  use; an array's elements share its slot. */
  nested: Map<string, LayoutSlot> | null;
}

/** One step of the changes met so far: the names written or dropped after it lead on. Its layouts are
 *  those of the component whose write leads here. */
interface ChangeStep extends LayoutSlot {
  readonly written: Map<string, ChangeStep>;
  readonly dropped: Map<string, ChangeStep>;
  /** The entry in `changes` of the change that ends here in the delta stamped `changeEpoch`. */
  change: number;
  changeEpoch: number;
  /** The change that ends here, the same names in every delta. */
  entityChange: EntityChange | null;
  /** The last name written at this step and the step it led to, which the next entity here usually
   *  writes too: met without hashing the name. */
  nextName: string | null;
  nextStep: ChangeStep | null;
}

const NO_EPOCH = 0;
/** The change steps, nested slots and layouts a stream keeps before it starts over, far above what a long
 *  match meets. */
const MAX_CHANGE_STEPS = 1 << 16;

function changeStep(): ChangeStep {
  return {
    written: new Map(),
    dropped: new Map(),
    change: NO_CHANGE,
    changeEpoch: NO_EPOCH,
    lastLayout: null,
    layouts: [],
    nested: null,
    entityChange: null,
    nextName: null,
    nextStep: null,
  };
}

/** The change paths, record layouts and column storage one stream met so far, kept from delta to
 *  delta so a delta allocates none of them again; each delta numbers its own entries under a new epoch.
 *  The layouts are bounded by the components' field sets; the paths by the combinations of components
 *  entities write together, which keep turning up slowly: magiczny_las at t120000 holds 1000 steps
 *  after the opening rebuild and 2900 after 3000 ticks, with 116 layouts. */
export class DeltaShapes {
  firstStep = changeStep();
  readonly layouts = new Map<string, RecordLayout>();
  epoch = NO_EPOCH;
  private steps = 0;
  /** The typed columns a delta fills before it copies them out: grown once to a busy delta's size. */
  readonly touched = new IntColumn();
  readonly changeOf = new IntColumn();
  readonly valueKinds = new IntColumn();
  numbers = new Float64Array(INITIAL_COLUMN);

  /** The step `name` leads to from `steps`, made on first use. */
  stepAfter(steps: Map<string, ChangeStep>, name: string): ChangeStep {
    let step = steps.get(name);
    if (step === undefined) {
      step = changeStep();
      steps.set(name, step);
      this.steps++;
    }
    return step;
  }

  /** The slot of the value under `key` in the records written at `slot`, made on first use. */
  slotUnder(slot: LayoutSlot, key: string): LayoutSlot {
    slot.nested ??= new Map();
    let nested = slot.nested.get(key);
    if (nested === undefined) {
      nested = { lastLayout: null, layouts: [], nested: null };
      slot.nested.set(key, nested);
      this.steps++;
    }
    return nested;
  }

  /** The interned layout named `name`, made by `make` on first use. */
  layoutNamed(name: string, make: () => RecordLayout): RecordLayout {
    let layout = this.layouts.get(name);
    if (layout === undefined) {
      layout = make();
      this.layouts.set(name, layout);
      this.steps++;
    }
    return layout;
  }

  /** The step writing `name` leads to from `from`. */
  writtenAfter(from: ChangeStep, name: string): ChangeStep {
    if (from.nextName === name && from.nextStep !== null) return from.nextStep;
    const step = this.stepAfter(from.written, name);
    from.nextName = name;
    from.nextStep = step;
    return step;
  }

  /** Forget the paths and layouts once they pass {@link MAX_CHANGE_STEPS}; called between deltas. */
  bound(): void {
    if (this.steps <= MAX_CHANGE_STEPS) return;
    this.firstStep = changeStep();
    this.layouts.clear();
    this.steps = 0;
  }
}

/** Builds a delta's columns one entity at a time; entities go in ascending id order. */
export class DeltaColumns {
  private readonly touched: IntColumn;
  private readonly changeOf: IntColumn;
  private readonly changes: EntityChange[] = [];
  private readonly valueKinds: IntColumn;
  private readonly recordKeys: (readonly string[])[] = [];
  private readonly recordFields: string[] = [];
  private numberCount = 0;
  /** No number pushed so far needs more than an `Int32Array` holds. */
  private int32Numbers = true;
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
  /** Per nesting depth, the keys and field kinds of the record being read there, for a layout met for
   *  the first time. */
  private readonly scratch: { readonly keys: string[]; readonly kinds: number[] }[] = [];

  /** One builder at a time per `shapes`: it fills the shapes' column storage. */
  constructor(private readonly shapes = new DeltaShapes()) {
    shapes.bound();
    this.epoch = ++shapes.epoch;
    this.step = shapes.firstStep;
    this.touched = shapes.touched;
    this.changeOf = shapes.changeOf;
    this.valueKinds = shapes.valueKinds;
    this.touched.clear(RETAINED_COLUMN);
    this.changeOf.clear(RETAINED_COLUMN);
    this.valueKinds.clear(RETAINED_COLUMN);
    if (shapes.numbers.length > RETAINED_COLUMN) shapes.numbers = new Float64Array(INITIAL_COLUMN);
  }

  begin(id: number): void {
    this.touched.push(id);
    this.step = this.shapes.firstStep;
    this.writtenCount = 0;
    this.droppedCount = 0;
  }

  /** Write a value read off the live world: a plain record the columns carry, a cleared `undefined`
   *  field aside and a `Map` as its sorted entries, goes straight into them, any other value as its
   *  {@link clonePlain}. Either way the columns end as {@link write} of the clone leaves them. */
  readonly writeLive = (name: string, value: unknown): void => {
    this.written[this.writtenCount++] = name;
    this.step = this.shapes.writtenAfter(this.step, name);
    const kind = isPlainRecord(value) ? this.recordKind(this.step, value, true) : WHOLE_VALUE;
    this.valueKinds.push(kind);
    // A field that fails the column test fails it in the clone too, so the clone needs no second look.
    if (kind === WHOLE_VALUE) this.values.push(clonePlain(value));
  };

  /** Write a detached value, kept as the delta's own unless it is a record the columns carry. */
  write(name: string, value: unknown): void {
    this.written[this.writtenCount++] = name;
    this.step = this.shapes.writtenAfter(this.step, name);
    const kind = this.recordKind(this.step, value, false);
    this.valueKinds.push(kind);
    if (kind === WHOLE_VALUE) this.values.push(value);
  }

  drop(name: string): void {
    this.dropped[this.droppedCount++] = name;
    this.step = this.shapes.stepAfter(this.step.dropped, name);
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
      changeOf: this.changeOf.takenSmall(),
      changes: this.changes,
      valueKinds: this.valueKinds.takenSmall(),
      recordKeys: this.recordKeys,
      recordFields: this.recordFields,
      numbers: this.takenNumbers(),
      strings: this.strings,
      values: this.values,
    };
  }

  private takenNumbers(): Int32Array | Float64Array {
    const numbers = this.shapes.numbers.subarray(0, this.numberCount);
    if (!this.int32Numbers) return numbers.slice();
    const narrow = new Int32Array(this.numberCount);
    narrow.set(numbers);
    return narrow;
  }

  /** Push the fields of a record the columns carry and answer its key list's entry, or answer
   *  {@link WHOLE_VALUE} for any other value and push nothing. A record is any non-array object: a
   *  structured clone keeps no prototype either. */
  private recordKind(step: ChangeStep, value: unknown, skipUndefined: boolean): number {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return WHOLE_VALUE;
    const layout = this.recordLayout(step, value as Record<string, unknown>, skipUndefined, 0);
    return layout === null ? WHOLE_VALUE : layout.at;
  }

  /** Push the fields of `record`, read at `slot` and nesting `depth`, and answer its layout, entered in
   *  this delta's `recordKeys`; or answer null and leave the columns as they were when a field is none the
   *  columns carry. `skipUndefined` leaves out a field holding `undefined`, as the clone of a live value
   *  does, and reads a nested `Map` as its sorted entries. */
  private recordLayout(
    slot: LayoutSlot,
    record: Record<string, unknown>,
    skipUndefined: boolean,
    depth: number,
  ): RecordLayout | null {
    const stringStart = this.strings.length;
    const numberStart = this.numberCount;
    const int32Start = this.int32Numbers;
    const last = slot.lastLayout;
    const scratch = this.scratchAt(depth);
    // The number column and its count stay in locals for the loop and are stored back once the record
    // is taken, or around a nested value, which writes them itself.
    let numbers = this.shapes.numbers;
    let numberCount = numberStart;
    let int32Numbers = int32Start;
    // While the record repeats the slot's last layout, its keys and kinds are that layout's; the scratch
    // lists are filled only once it parts from it.
    let matched = last === null ? 0 : -1;
    let count = 0;
    for (const key in record) {
      const field = record[key];
      let kind: number;
      if (typeof field === 'number') {
        if (numberCount === numbers.length) numbers = this.growNumbers();
        if (int32Numbers && !isInt32(field)) int32Numbers = false;
        numbers[numberCount++] = field;
        kind = NUMBER_KIND;
      } else if (typeof field === 'boolean') {
        if (numberCount === numbers.length) numbers = this.growNumbers();
        numbers[numberCount++] = field ? 1 : 0;
        kind = BOOLEAN_KIND;
      } else if (typeof field === 'string') {
        this.strings.push(field);
        kind = STRING_KIND;
      } else if (field === null) kind = NULL_KIND;
      else if (field === undefined && skipUndefined) continue;
      else if (typeof field === 'object' && key !== PROTO_KEY) {
        this.numberCount = numberCount;
        this.int32Numbers = int32Numbers;
        kind = this.nestedKind(this.shapes.slotUnder(slot, key), field, skipUndefined, depth + 1);
        numbers = this.shapes.numbers;
        numberCount = this.numberCount;
        int32Numbers = this.int32Numbers;
      } else kind = NO_KIND;
      if (kind === NO_KIND || key === PROTO_KEY) {
        this.strings.length = stringStart;
        this.numberCount = numberStart;
        this.int32Numbers = int32Start;
        return null;
      }
      if (matched < 0 && last !== null && (last.keys[count] !== key || last.kinds[count] !== kind)) {
        matched = count;
        for (let k = 0; k < count; k++) {
          scratch.keys[k] = last.keys[k] as string;
          scratch.kinds[k] = last.kinds[k] as number;
        }
      }
      if (matched >= 0) {
        scratch.keys[count] = key;
        scratch.kinds[count] = kind;
      }
      count++;
    }
    this.numberCount = numberCount;
    this.int32Numbers = int32Numbers;
    let layout: RecordLayout;
    if (last !== null && matched < 0 && last.keys.length === count) layout = last;
    else {
      if (matched < 0 && last !== null) {
        // A prefix of the last layout: its keys are still to be copied.
        for (let k = 0; k < count; k++) {
          scratch.keys[k] = last.keys[k] as string;
          scratch.kinds[k] = last.kinds[k] as number;
        }
      }
      layout = this.layoutAt(slot, scratch.keys, scratch.kinds, count);
    }
    slot.lastLayout = layout;
    if (layout.epoch !== this.epoch) {
      layout.epoch = this.epoch;
      layout.at = this.recordKeys.length;
      this.recordKeys.push(layout.keys);
      this.recordFields.push(layout.fields);
    }
    return layout;
  }

  /** Push a record or array field and answer its kind, or answer {@link NO_KIND} with the columns as
   *  they were. */
  private nestedKind(slot: LayoutSlot, value: object, skipUndefined: boolean, depth: number): number {
    if (Array.isArray(value))
      return this.pushedArray(slot, value, skipUndefined, depth) ? ARRAY_KIND : NO_KIND;
    if (skipUndefined && value instanceof Map) {
      return this.pushedArray(slot, sortedMapEntries(value), skipUndefined, depth) ? ARRAY_KIND : NO_KIND;
    }
    if (!isPlainRecord(value)) return NO_KIND;
    // The layout is known once the fields are read: its entry goes in the place kept for it here.
    const at = this.numberCount;
    this.pushNumber(0);
    const layout = this.recordLayout(slot, value, skipUndefined, depth);
    if (layout === null) {
      this.numberCount = at;
      return NO_KIND;
    }
    this.shapes.numbers[at] = layout.at;
    return RECORD_KIND;
  }

  /** Push an array's length and its elements and answer true; or answer false with the columns as they
   *  were when an element is none the columns carry. */
  private pushedArray(
    slot: LayoutSlot,
    array: readonly unknown[],
    skipUndefined: boolean,
    depth: number,
  ): boolean {
    const stringStart = this.strings.length;
    const numberStart = this.numberCount;
    const int32Start = this.int32Numbers;
    this.pushNumber(array.length);
    const kind = array.length === 0 ? NULL_KIND : elementsKind(array, skipUndefined);
    const pushed =
      array.length === 0 ||
      (kind === RECORD_KIND
        ? this.pushedRecords(slot, array, skipUndefined, depth)
        : kind !== NO_KIND && this.pushedElements(slot, array, kind, skipUndefined, depth));
    if (!pushed) {
      this.strings.length = stringStart;
      this.numberCount = numberStart;
      this.int32Numbers = int32Start;
    }
    return pushed;
  }

  /** Push records under one layout, which goes once ahead of their fields, or else each record after its
   *  own layout; answer false when one is no record the columns carry. */
  private pushedRecords(
    slot: LayoutSlot,
    records: readonly unknown[],
    skipUndefined: boolean,
    depth: number,
  ): boolean {
    const stringStart = this.strings.length;
    const numberStart = this.numberCount;
    const int32Start = this.int32Numbers;
    this.pushNumber(SAME_LAYOUT_ELEMENTS);
    const layoutAt = this.numberCount;
    this.pushNumber(0);
    let shared: RecordLayout | null = null;
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (!isPlainRecord(record)) return false;
      const layout = this.recordLayout(slot, record, skipUndefined, depth);
      if (layout === null) return false;
      if (shared === null) shared = layout;
      else if (layout !== shared) {
        this.strings.length = stringStart;
        this.numberCount = numberStart;
        this.int32Numbers = int32Start;
        return this.pushedElements(slot, records, RECORD_KIND, skipUndefined, depth);
      }
    }
    if (shared !== null) this.shapes.numbers[layoutAt] = shared.at;
    return true;
  }

  /** Push elements of one `kind`, or each after its own kind under {@link MIXED_ELEMENTS}; answer false
   *  when one is none the columns carry. */
  private pushedElements(
    slot: LayoutSlot,
    elements: readonly unknown[],
    kind: number,
    skipUndefined: boolean,
    depth: number,
  ): boolean {
    this.pushNumber(kind);
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      let elementKind = kind;
      if (kind === MIXED_ELEMENTS) {
        elementKind = kindOfElement(element, skipUndefined);
        this.pushNumber(elementKind);
      }
      if (typeof element === 'number') this.pushNumber(element);
      else if (typeof element === 'boolean') this.pushNumber(element ? 1 : 0);
      else if (typeof element === 'string') this.strings.push(element);
      else if (elementKind === RECORD_KIND || elementKind === ARRAY_KIND) {
        if (this.nestedKind(slot, element as object, skipUndefined, depth) !== elementKind) return false;
      } else if (element !== null) return false;
    }
    return true;
  }

  private pushNumber(value: number): void {
    const numbers =
      this.numberCount === this.shapes.numbers.length ? this.growNumbers() : this.shapes.numbers;
    if (this.int32Numbers && !isInt32(value)) this.int32Numbers = false;
    numbers[this.numberCount++] = value;
  }

  /** The scratch lists of nesting `depth`, made on first use. */
  private scratchAt(depth: number): { readonly keys: string[]; readonly kinds: number[] } {
    let scratch = this.scratch[depth];
    if (scratch === undefined) {
      scratch = { keys: [], kinds: [] };
      this.scratch[depth] = scratch;
    }
    return scratch;
  }

  /** The layout of the record just read into the first `count` of `keys` and `kinds`, among those met at
   *  `slot` or else interned for it. */
  private layoutAt(
    slot: LayoutSlot,
    keys: readonly string[],
    kinds: readonly number[],
    count: number,
  ): RecordLayout {
    for (const layout of slot.layouts) {
      if (layout.keys.length !== count) continue;
      let same = true;
      for (let k = 0; k < count && same; k++)
        same = layout.keys[k] === keys[k] && layout.kinds[k] === kinds[k];
      if (same) return layout;
    }
    const layout = this.layoutOf(keys.slice(0, count), kinds.slice(0, count));
    slot.layouts.push(layout);
    return layout;
  }

  /** The interned layout of these keys and kinds. */
  private layoutOf(keys: readonly string[], kinds: readonly number[]): RecordLayout {
    const fields = kinds.map((kind) => FIELD_KINDS[kind] as FieldKind).join('');
    // JSON quotes each key, so no two key lists share a name whatever characters the keys hold.
    return this.shapes.layoutNamed(JSON.stringify([fields, keys]), () => ({
      keys,
      fields,
      kinds,
      at: WHOLE_VALUE,
      epoch: NO_EPOCH,
    }));
  }

  /** The number column doubled, its entries kept. */
  private growNumbers(): Float64Array<ArrayBuffer> {
    const grown = new Float64Array(this.shapes.numbers.length * 2);
    grown.set(this.shapes.numbers);
    this.shapes.numbers = grown;
    return grown;
  }
}

/** Reads the written values of a delta in turn, per touched entity in its change's `written` order,
 *  each columned record rebuilt as it is read rather than collected into a list first. */
export class DeltaValueReader {
  private kind = 0;
  private number = 0;
  private string = 0;
  private whole = 0;

  constructor(private readonly delta: SnapshotDelta) {}

  next(): unknown {
    const kind = this.delta.valueKinds[this.kind++] ?? WHOLE_VALUE;
    return kind === WHOLE_VALUE ? this.delta.values[this.whole++] : this.record(kind);
  }

  private record(layout: number): Record<string, unknown> {
    const { recordKeys, recordFields, numbers, strings } = this.delta;
    const keys = recordKeys[layout];
    const fields = recordFields[layout];
    if (keys === undefined || fields === undefined) {
      throw new Error(`snapshot delta ${this.delta.sequence}: no record layout ${layout}`);
    }
    const record: Record<string, unknown> = {};
    // The number cursor stays in a local for the loop and is stored around a nested value.
    let number = this.number;
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k] as string;
      const field = fields[k];
      let value: unknown;
      if (field === FIELD.NUMBER) value = numbers[number++];
      else if (field === FIELD.BOOLEAN) value = numbers[number++] !== 0;
      else if (field === FIELD.STRING) value = strings[this.string++];
      else if (field === FIELD.NULL) value = null;
      else {
        this.number = field === FIELD.RECORD ? number + 1 : number;
        value = field === FIELD.RECORD ? this.record(numbers[number] as number) : this.array();
        number = this.number;
      }
      addField(record, k, key, value);
    }
    this.number = number;
    return record;
  }

  private array(): unknown[] {
    const { numbers } = this.delta;
    const length = numbers[this.number++] as number;
    const out: unknown[] = [];
    if (length === 0) return out;
    const kind = numbers[this.number++] as number;
    if (kind === SAME_LAYOUT_ELEMENTS) {
      const layout = numbers[this.number++] as number;
      for (let i = 0; i < length; i++) out.push(this.record(layout));
    } else if (kind === MIXED_ELEMENTS) {
      for (let i = 0; i < length; i++) out.push(this.element(numbers[this.number++] as number));
    } else for (let i = 0; i < length; i++) out.push(this.element(kind));
    return out;
  }

  private element(kind: number): unknown {
    const { numbers } = this.delta;
    if (kind === NUMBER_KIND) return numbers[this.number++];
    if (kind === BOOLEAN_KIND) return numbers[this.number++] !== 0;
    if (kind === STRING_KIND) return this.delta.strings[this.string++];
    if (kind === RECORD_KIND) return this.record(numbers[this.number++] as number);
    if (kind === ARRAY_KIND) return this.array();
    return null;
  }
}

/** The written values of `delta` in turn, per touched entity in its change's `written` order. */
export function deltaValues(delta: SnapshotDelta): unknown[] {
  const reader = new DeltaValueReader(delta);
  const out: unknown[] = new Array(delta.valueKinds.length);
  for (let i = 0; i < out.length; i++) out[i] = reader.next();
  return out;
}

/** Store a delta listed by entity by column, the shape a stream emits. */
export function packSnapshotDelta(delta: EntitySnapshotDelta): SnapshotDelta {
  const columns = new DeltaColumns();
  let previous = -1;
  for (const entry of delta.touched) {
    if (entry.id <= previous) {
      throw new Error(
        `snapshot delta ${delta.sequence}: touched entity ${entry.id} after ${previous}, must ascend`,
      );
    }
    previous = entry.id;
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
