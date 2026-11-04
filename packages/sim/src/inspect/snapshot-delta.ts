import type { SimEvent } from '../core/events.js';
import { isPlainRecord, PROTO_KEY, sortedMapEntries } from '../core/plain-value.js';
import type { Component } from '../ecs/component.js';
import type { DeltaDigest } from './entity-digest.js';
import { addField } from './fast-record.js';
import { cloneReadView } from './plain-clone.js';

/**
 * The changes of one stretch of ticks, in the shape a mirror rebuilds the snapshot from and a worker
 * boundary carries whole: plain data, structured-cloneable like the snapshot itself. Stored by column,
 * so a structured clone copies no object per touched entity or per change, and none for a component
 * that is a plain record of numbers, booleans, strings, null and nested records and arrays of those,
 * which travels as numbers and strings under key lists sent once (`DeltaReader` rebuilds it). Each
 * component name and record key travels once per delta, in `names`. The integer columns are typed
 * arrays, which a structured clone copies as bytes where it writes and reads a plain array element by
 * element, each in the narrowest element type its entries fit.
 */
export interface SnapshotDelta {
  /** The tick the delta brings a mirror to. */
  readonly tick: number;
  /** The delta's place in its stream, counting from 0 and including rebuilds: a mirror refuses a
   *  non-rebuild delta that does not directly follow the one it applied last. */
  readonly sequence: number;
  /** The touched log overflowed or the stream just opened: the touched entities are every alive
   *  entity, each writing all of its components, and the mirror replaces its whole list. */
  readonly rebuild: boolean;
  /** Every entity created or mutated since the base and still alive, ascending, as the gap from the
   *  previous id (from 0 for the first); a gap past {@link INT16_MAX} goes as its high bits negated, then
   *  its low {@link GAP_LOW_BITS} bits. {@link touchedIds} reads the ids back. Entity ids stay within int32: the
   *  save caps them there. */
  readonly touchedGaps: SmallIntColumn;
  /** Per touched entity, its entry among the changes. */
  readonly changeOf: SmallIntColumn;
  /** The distinct changes the touched entities made, one after another: the counts of components
   *  written and removed, then per written component its entry in `names` and the kind of its value
   *  (its entry among the layouts, or {@link WHOLE_VALUE}), then per removed one its entry in `names`.
   *  An entity the base did not hold writes all of its components. {@link deltaChanges} reads them. */
  readonly changes: SmallIntColumn;
  /** The layouts of the records the columns carry, one after another: the key count, then per key
   *  its entry in `names` and its field kind. */
  readonly layouts: SmallIntColumn;
  /** The component names and record keys the changes and layouts name, each once. */
  readonly names: readonly string[];
  /** Those records' 32-bit integer and boolean fields, as fixed-point state is, and the framing of their
   *  nested values, record after record, each in its key list's order. */
  readonly numbers: Int32Array;
  /** Those records' other number fields, in the same order. */
  readonly floats: Float64Array;
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
/** A touched gap past {@link INT16_MAX} splits into its bits above these and these. */
const GAP_LOW_BITS = 15;
const GAP_LOW_RANGE = 2 ** GAP_LOW_BITS;

/** A value kind for a value carried whole in `values`. */
const WHOLE_VALUE = -1;

/* How a record's field travels, its field kind: a 32-bit integer or a boolean (0 or 1) in `numbers`,
 * another number in `floats`, a string in `strings`, a null in neither. A nested record puts its entry among the layouts in `numbers`, then
 * its fields; an array puts its length, then, unless empty, its elements' field kind or one of the array
 * kinds below, then each element as a field of that kind travels. */
const NUMBER_KIND = 0;
const BOOLEAN_KIND = 1;
const STRING_KIND = 2;
const NULL_KIND = 3;
const RECORD_KIND = 4;
const ARRAY_KIND = 5;
const FLOAT_KIND = 6;
/** After an array's length: its elements are records of one layout, whose entry follows once. */
const SAME_LAYOUT_ELEMENTS = 7;
/** After an array's length: each element goes after its own kind. Any other kind there is every
 *  element's. */
const MIXED_ELEMENTS = 8;
/** A field or element the columns cannot carry: its whole value travels cloned. */
const NO_KIND = -1;

/** What one touched entity changed since the base, shared by every entity that changed the same. */
export interface EntityChange {
  /** The components written since the base, in the order a fresh snapshot lists them. */
  readonly written: readonly string[];
  /** Per written component, the kind its value travels as. */
  readonly kinds: readonly number[];
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
  | 'touchedGaps'
  | 'changeOf'
  | 'changes'
  | 'layouts'
  | 'names'
  | 'numbers'
  | 'floats'
  | 'strings'
  | 'values';

/** A delta listed by entity: what {@link packSnapshotDelta} stores by column. */
export type EntitySnapshotDelta = Omit<SnapshotDelta, DeltaColumnFields> & {
  readonly touched: readonly EntityDelta[];
};

const NO_NAMES: readonly string[] = [];
const NO_KINDS: readonly number[] = [];
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

  /** The entries pushed so far, in 16 bits when every entry fits. */
  takenSmall(): SmallIntColumn {
    const { items, count } = this;
    for (let i = 0; i < count; i++) {
      const item = items[i] as number;
      if (item < INT16_MIN || item > INT16_MAX) return items.slice(0, count);
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
  if (typeof element === 'number') return isInt32(element) ? NUMBER_KIND : FLOAT_KIND;
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

/** A record's keys in order and how each field travels; interned per stream, so its entry among a
 *  delta's layouts is found without rebuilding the key list. */
interface RecordLayout {
  readonly keys: readonly string[];
  /** Per key, its name's entry. */
  readonly keyNames: readonly NameEntry[];
  /** Per key, its field kind. */
  readonly kinds: readonly number[];
  /** Its entry among the layouts of the delta stamped `epoch`. */
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

/** One step of the changes met so far: the names written or dropped after it lead on. */
interface ChangeStep {
  readonly written: Map<string, WriteStep>;
  readonly dropped: Map<string, ChangeStep>;
  /** The entry among the changes of the change that ends here in the delta stamped `changeEpoch`. */
  change: number;
  changeEpoch: number;
  /** The last name written at this step and the step it led to, which the next entity here usually
   *  writes too: met without hashing the name. */
  nextName: string | null;
  nextStep: WriteStep | null;
}

/** The step a component's write leads to: the layouts of its values, and the change steps by the
 *  layout the value took, a whole value's under null. */
interface WriteStep extends LayoutSlot {
  /** The written component's name's entry. */
  readonly name: NameEntry;
  readonly byLayout: Map<RecordLayout | null, ChangeStep>;
  /** The layout of the last value written here and the step it led to, met without hashing. */
  valueLayout: RecordLayout | null;
  valueStep: ChangeStep | null;
}

/** A name's entry in the `names` of the delta stamped `epoch`. */
interface NameEntry {
  readonly name: string;
  at: number;
  epoch: number;
}

const NO_EPOCH = 0;
/** The change steps, nested slots, layouts and names a stream keeps before it starts over, far above
 *  what a long match meets. */
const MAX_CHANGE_STEPS = 1 << 16;

function changeStep(): ChangeStep {
  return {
    written: new Map(),
    dropped: new Map(),
    change: NO_CHANGE,
    changeEpoch: NO_EPOCH,
    nextName: null,
    nextStep: null,
  };
}

/** The change paths, record layouts, names and column storage one stream met so far, kept from delta
 *  to delta so a delta allocates none of them again; each delta numbers its own entries under a new
 *  epoch. The layouts are bounded by the components' field sets; the paths by the combinations of
 *  components and layouts entities write together, which keep turning up slowly: magiczny_las at
 *  t120000 holds 1000 steps after the opening rebuild and 2900 after 3000 ticks, with 116 layouts. */
export class DeltaShapes {
  firstStep = changeStep();
  readonly layouts = new Map<string, RecordLayout>();
  readonly names = new Map<string, NameEntry>();
  epoch = NO_EPOCH;
  private steps = 0;
  /** The integer columns a delta fills before it copies them out: grown once to a busy delta's size. */
  readonly touchedGaps = new IntColumn();
  readonly changeOf = new IntColumn();
  readonly changes = new IntColumn();
  readonly layoutColumn = new IntColumn();
  numbers = new Int32Array(INITIAL_COLUMN);

  /** The step writing `name` leads to from `from`, made on first use. */
  writtenAfter(from: ChangeStep, name: string): WriteStep {
    if (from.nextName === name && from.nextStep !== null) return from.nextStep;
    let step = from.written.get(name);
    if (step === undefined) {
      step = {
        name: this.nameEntry(name),
        lastLayout: null,
        layouts: [],
        nested: null,
        byLayout: new Map(),
        valueLayout: null,
        valueStep: null,
      };
      from.written.set(name, step);
      this.steps++;
    }
    from.nextName = name;
    from.nextStep = step;
    return step;
  }

  /** The step a value of `layout` leads to from `from`, made on first use. */
  valueAfter(from: WriteStep, layout: RecordLayout | null): ChangeStep {
    if (from.valueLayout === layout && from.valueStep !== null) return from.valueStep;
    let step = from.byLayout.get(layout);
    if (step === undefined) {
      step = changeStep();
      from.byLayout.set(layout, step);
      this.steps++;
    }
    from.valueLayout = layout;
    from.valueStep = step;
    return step;
  }

  /** The step dropping `name` leads to from `from`, made on first use. */
  droppedAfter(from: ChangeStep, name: string): ChangeStep {
    let step = from.dropped.get(name);
    if (step === undefined) {
      step = changeStep();
      from.dropped.set(name, step);
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

  /** The entry of `name`, made on first use. */
  nameEntry(name: string): NameEntry {
    let entry = this.names.get(name);
    if (entry === undefined) {
      entry = { name, at: 0, epoch: NO_EPOCH };
      this.names.set(name, entry);
      this.steps++;
    }
    return entry;
  }

  /** Forget the paths, layouts and names once they pass {@link MAX_CHANGE_STEPS}; called between
   *  deltas. */
  bound(): void {
    if (this.steps <= MAX_CHANGE_STEPS) return;
    this.firstStep = changeStep();
    this.layouts.clear();
    this.names.clear();
    this.steps = 0;
  }
}

/** Builds a delta's columns one entity at a time; entities go in ascending id order. */
export class DeltaColumns {
  private readonly touchedGaps: IntColumn;
  private readonly changeOf: IntColumn;
  private readonly changes: IntColumn;
  private changeCount = 0;
  private readonly layoutColumn: IntColumn;
  private layoutCount = 0;
  private readonly names: string[] = [];
  private numberCount = 0;
  private readonly floats: number[] = [];
  private readonly strings: string[] = [];
  private readonly values: unknown[] = [];
  private readonly epoch: number;
  /** The entities begun so far and the last one's id, from which the next one's gap is counted. */
  private entities = 0;
  private lastId = 0;
  /** The open entity's change so far, and its names and value layouts, which a change met for the
   *  first time in this delta enters. Counted rather than truncated, so the lists keep their storage
   *  from entity to entity. */
  private step: ChangeStep;
  private readonly written: NameEntry[] = [];
  private readonly writtenLayouts: (RecordLayout | null)[] = [];
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
    this.touchedGaps = shapes.touchedGaps;
    this.changeOf = shapes.changeOf;
    this.changes = shapes.changes;
    this.layoutColumn = shapes.layoutColumn;
    this.touchedGaps.clear(RETAINED_COLUMN);
    this.changeOf.clear(RETAINED_COLUMN);
    this.changes.clear(RETAINED_COLUMN);
    this.layoutColumn.clear(RETAINED_COLUMN);
    if (shapes.numbers.length > RETAINED_COLUMN) shapes.numbers = new Int32Array(INITIAL_COLUMN);
  }

  begin(id: number): void {
    const gap = id - this.lastId;
    if (gap < 0 || (gap === 0 && this.entities > 0)) {
      throw new Error(`snapshot delta: touched entity ${id} after ${this.lastId}, must ascend`);
    }
    if (gap <= INT16_MAX) this.touchedGaps.push(gap);
    else {
      this.touchedGaps.push(-Math.floor(gap / GAP_LOW_RANGE));
      this.touchedGaps.push(gap % GAP_LOW_RANGE);
    }
    this.lastId = id;
    this.entities++;
    this.step = this.shapes.firstStep;
    this.writtenCount = 0;
    this.droppedCount = 0;
  }

  /** Write a value read off the live world without its `simOnlyFields`: a plain record the columns
   *  carry, a cleared `undefined` field aside and a `Map` as its sorted entries, goes straight into them,
   *  any other value as its {@link cloneReadView}. Either way the columns end as {@link write} of the
   *  clone leaves them. */
  readonly writeLive = (
    name: string,
    value: unknown,
    simOnlyFields: ReadonlySet<string> | null = null,
  ): void => {
    const slot = this.shapes.writtenAfter(this.step, name);
    const layout = isPlainRecord(value) ? this.recordLayout(slot, value, true, 0, simOnlyFields) : null;
    // A field that fails the column test fails it in the clone too, so the clone needs no second look.
    if (layout === null) this.values.push(cloneReadView(value, simOnlyFields));
    this.wrote(slot, layout);
  };

  /** {@link writeLive} as a `World.forEachComponent` visitor. */
  readonly writeComponent = (
    name: string,
    value: unknown,
    _revision: number,
    component: Component<unknown>,
  ): void => this.writeLive(name, value, component.simOnlyFields);

  /** Write a detached value, kept as the delta's own unless it is a record the columns carry. A record
   *  is any non-array object: a structured clone keeps no prototype either. */
  write(name: string, value: unknown): void {
    const slot = this.shapes.writtenAfter(this.step, name);
    const layout =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? this.recordLayout(slot, value as Record<string, unknown>, false, 0)
        : null;
    if (layout === null) this.values.push(value);
    this.wrote(slot, layout);
  }

  drop(name: string): void {
    this.dropped[this.droppedCount++] = name;
    this.step = this.shapes.droppedAfter(this.step, name);
  }

  end(): void {
    const { step } = this;
    if (step.changeEpoch !== this.epoch) {
      step.changeEpoch = this.epoch;
      step.change = this.changeCount++;
      const changes = this.changes;
      changes.push(this.writtenCount);
      changes.push(this.droppedCount);
      for (let i = 0; i < this.writtenCount; i++) {
        changes.push(this.nameAt(this.written[i] as NameEntry));
        changes.push(this.writtenLayouts[i]?.at ?? WHOLE_VALUE);
      }
      for (let i = 0; i < this.droppedCount; i++) {
        changes.push(this.nameAt(this.shapes.nameEntry(this.dropped[i] as string)));
      }
    }
    this.changeOf.push(step.change);
  }

  /** The columns as a delta's fields. */
  columns(): Pick<SnapshotDelta, DeltaColumnFields> {
    return {
      touchedGaps: this.touchedGaps.takenSmall(),
      changeOf: this.changeOf.takenSmall(),
      changes: this.changes.takenSmall(),
      layouts: this.layoutColumn.takenSmall(),
      names: this.names,
      numbers: this.shapes.numbers.slice(0, this.numberCount),
      floats: Float64Array.from(this.floats),
      strings: this.strings,
      values: this.values,
    };
  }

  private wrote(slot: WriteStep, layout: RecordLayout | null): void {
    this.written[this.writtenCount] = slot.name;
    this.writtenLayouts[this.writtenCount++] = layout;
    this.step = this.shapes.valueAfter(slot, layout);
  }

  /** The place of `entry`'s name in this delta's `names`, entered on first use. */
  private nameAt(entry: NameEntry): number {
    if (entry.epoch !== this.epoch) {
      entry.epoch = this.epoch;
      entry.at = this.names.length;
      this.names.push(entry.name);
    }
    return entry.at;
  }

  /** Push the fields of `record`, read at `slot` and nesting `depth`, and answer its layout, entered
   *  among this delta's layouts; or answer null and leave the columns as they were when a field is none
   *  the columns carry. `skipUndefined` leaves out a field holding `undefined`, as the clone of a live
   *  value does, and reads a nested `Map` as its sorted entries. A key in `omitted` is left out too. */
  private recordLayout(
    slot: LayoutSlot,
    record: Record<string, unknown>,
    skipUndefined: boolean,
    depth: number,
    omitted: ReadonlySet<string> | null = null,
  ): RecordLayout | null {
    const stringStart = this.strings.length;
    const numberStart = this.numberCount;
    const floatStart = this.floats.length;
    const last = slot.lastLayout;
    const scratch = this.scratchAt(depth);
    // The number column and its count stay in locals for the loop and are stored back once the record
    // is taken, or around a nested value, which writes them itself.
    let numbers = this.shapes.numbers;
    let numberCount = numberStart;
    // While the record repeats the slot's last layout, its keys and kinds are that layout's; the scratch
    // lists are filled only once it parts from it.
    let matched = last === null ? 0 : -1;
    let count = 0;
    for (const key in record) {
      if (omitted?.has(key)) continue;
      const field = record[key];
      let kind: number;
      if (typeof field === 'number') {
        if (isInt32(field)) {
          if (numberCount === numbers.length) numbers = this.growNumbers();
          numbers[numberCount++] = field;
          kind = NUMBER_KIND;
        } else {
          this.floats.push(field);
          kind = FLOAT_KIND;
        }
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
        kind = this.nestedKind(this.shapes.slotUnder(slot, key), field, skipUndefined, depth + 1);
        numbers = this.shapes.numbers;
        numberCount = this.numberCount;
      } else kind = NO_KIND;
      if (kind === NO_KIND || key === PROTO_KEY) {
        this.strings.length = stringStart;
        this.numberCount = numberStart;
        this.floats.length = floatStart;
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
    if (layout.epoch !== this.epoch) this.enter(layout);
    return layout;
  }

  /** Number `layout` among this delta's layouts and push its keys and kinds. */
  private enter(layout: RecordLayout): void {
    layout.epoch = this.epoch;
    layout.at = this.layoutCount++;
    const column = this.layoutColumn;
    column.push(layout.keys.length);
    for (let k = 0; k < layout.keys.length; k++) {
      column.push(this.nameAt(layout.keyNames[k] as NameEntry));
      column.push(layout.kinds[k] as number);
    }
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
    const floatStart = this.floats.length;
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
      this.floats.length = floatStart;
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
    const floatStart = this.floats.length;
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
        this.floats.length = floatStart;
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
      if (typeof element === 'number') {
        if (elementKind === NUMBER_KIND) this.pushNumber(element);
        else this.floats.push(element);
      } else if (typeof element === 'boolean') this.pushNumber(element ? 1 : 0);
      else if (typeof element === 'string') this.strings.push(element);
      else if (elementKind === RECORD_KIND || elementKind === ARRAY_KIND) {
        if (this.nestedKind(slot, element as object, skipUndefined, depth) !== elementKind) return false;
      } else if (element !== null) return false;
    }
    return true;
  }

  /** Push a 32-bit integer: a field, an element or framing. */
  private pushNumber(value: number): void {
    const numbers =
      this.numberCount === this.shapes.numbers.length ? this.growNumbers() : this.shapes.numbers;
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
    // JSON quotes each key, so no two key lists share a name whatever characters the keys hold.
    return this.shapes.layoutNamed(JSON.stringify([kinds, keys]), () => ({
      keys,
      keyNames: keys.map((key) => this.shapes.nameEntry(key)),
      kinds,
      at: WHOLE_VALUE,
      epoch: NO_EPOCH,
    }));
  }

  /** The number column doubled, its entries kept. */
  private growNumbers(): Int32Array<ArrayBuffer> {
    const grown = new Int32Array(this.shapes.numbers.length * 2);
    grown.set(this.shapes.numbers);
    this.shapes.numbers = grown;
    return grown;
  }
}

/** The touched entity ids of `delta`, ascending. */
export function touchedIds(delta: SnapshotDelta): Int32Array {
  const gaps = delta.touchedGaps;
  const ids = new Int32Array(delta.changeOf.length);
  let id = 0;
  let at = 0;
  for (let i = 0; i < ids.length; i++) {
    let gap = gaps[at++] ?? 0;
    if (gap < 0) gap = -gap * GAP_LOW_RANGE + (gaps[at++] ?? 0);
    id += gap;
    ids[i] = id;
  }
  if (at !== gaps.length) throw new Error(`snapshot delta ${delta.sequence}: touched gaps out of step`);
  return ids;
}

function nameOf(delta: SnapshotDelta, at: number | undefined): string {
  const name = delta.names[at ?? -1];
  if (name === undefined) throw new Error(`snapshot delta ${delta.sequence}: no name ${at}`);
  return name;
}

/** The distinct changes of `delta`, in its order. */
export function deltaChanges(delta: SnapshotDelta): EntityChange[] {
  const column = delta.changes;
  const out: EntityChange[] = [];
  let at = 0;
  while (at < column.length) {
    const writtenCount = column[at++] as number;
    const removedCount = column[at++] as number;
    const written: string[] = new Array(writtenCount);
    const kinds: number[] = new Array(writtenCount);
    for (let k = 0; k < writtenCount; k++) {
      written[k] = nameOf(delta, column[at++]);
      kinds[k] = column[at++] as number;
    }
    let removed = NO_NAMES;
    if (removedCount > 0) {
      const names: string[] = new Array(removedCount);
      for (let k = 0; k < removedCount; k++) names[k] = nameOf(delta, column[at++]);
      removed = names;
    }
    out.push({
      written: writtenCount === 0 ? NO_NAMES : written,
      kinds: writtenCount === 0 ? NO_KINDS : kinds,
      removed,
    });
  }
  return out;
}

/** A layout as a reader rebuilds records of it: per key, its field kind. */
export interface DeltaLayout {
  readonly keys: readonly string[];
  readonly kinds: readonly number[];
}

/** The record layouts of `delta`, in its order. */
export function deltaLayouts(delta: SnapshotDelta): DeltaLayout[] {
  const column = delta.layouts;
  const out: DeltaLayout[] = [];
  let at = 0;
  while (at < column.length) {
    const count = column[at++] as number;
    const keys: string[] = new Array(count);
    const kinds: number[] = new Array(count);
    for (let k = 0; k < count; k++) {
      keys[k] = nameOf(delta, column[at++]);
      kinds[k] = column[at++] as number;
    }
    out.push({ keys, kinds });
  }
  return out;
}

/** Reads a delta's touched entities, their changes and their written values in turn, per touched entity
 *  in its change's `written` order, each columned record rebuilt as it is read rather than collected into
 *  a list first. */
export class DeltaReader {
  /** The touched entity ids, ascending. */
  readonly touched: Int32Array;
  readonly changes: readonly EntityChange[];
  private readonly layouts: readonly DeltaLayout[];
  private number = 0;
  private float = 0;
  private string = 0;
  private whole = 0;

  constructor(private readonly delta: SnapshotDelta) {
    this.touched = touchedIds(delta);
    this.changes = deltaChanges(delta);
    this.layouts = deltaLayouts(delta);
  }

  /** The change of the `i`th touched entity. */
  changeAt(i: number): EntityChange {
    const change = this.changes[this.delta.changeOf[i] ?? -1];
    if (change === undefined)
      throw new Error(`snapshot delta ${this.delta.sequence}: entity ${i} has no change`);
    return change;
  }

  /** The next written value, which travels as `kind`. */
  next(kind: number): unknown {
    return kind === WHOLE_VALUE ? this.delta.values[this.whole++] : this.record(kind);
  }

  private record(at: number): Record<string, unknown> {
    const layout = this.layouts[at];
    if (layout === undefined)
      throw new Error(`snapshot delta ${this.delta.sequence}: no record layout ${at}`);
    const { keys, kinds } = layout;
    const { numbers, strings } = this.delta;
    const record: Record<string, unknown> = {};
    // The number cursor stays in a local for the loop and is stored around a nested value.
    let number = this.number;
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k] as string;
      const kind = kinds[k];
      let value: unknown;
      if (kind === NUMBER_KIND) value = numbers[number++];
      else if (kind === FLOAT_KIND) value = this.delta.floats[this.float++];
      else if (kind === BOOLEAN_KIND) value = numbers[number++] !== 0;
      else if (kind === STRING_KIND) value = strings[this.string++];
      else if (kind === NULL_KIND) value = null;
      else {
        this.number = kind === RECORD_KIND ? number + 1 : number;
        value = kind === RECORD_KIND ? this.record(numbers[number] as number) : this.array();
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
    if (kind === FLOAT_KIND) return this.delta.floats[this.float++];
    if (kind === BOOLEAN_KIND) return numbers[this.number++] !== 0;
    if (kind === STRING_KIND) return this.delta.strings[this.string++];
    if (kind === RECORD_KIND) return this.record(numbers[this.number++] as number);
    if (kind === ARRAY_KIND) return this.array();
    return null;
  }
}

/** The written values of `delta` in turn, per touched entity in its change's `written` order. */
export function deltaValues(delta: SnapshotDelta): unknown[] {
  const reader = new DeltaReader(delta);
  const out: unknown[] = [];
  for (let i = 0; i < reader.touched.length; i++) {
    for (const kind of reader.changeAt(i).kinds) out.push(reader.next(kind));
  }
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
  const { touched: _entities, ...rest } = delta;
  return { ...rest, ...columns.columns() };
}

/** The delta's touched entities one by one, as {@link packSnapshotDelta} took them. */
export function entityDeltas(delta: SnapshotDelta): EntityDelta[] {
  const reader = new DeltaReader(delta);
  return Array.from(reader.touched, (id, i) => {
    const change = reader.changeAt(i);
    const components: Record<string, unknown> = {};
    for (let k = 0; k < change.written.length; k++) {
      components[change.written[k] as string] = reader.next(change.kinds[k] as number);
    }
    return { id, components, removed: change.removed };
  });
}
