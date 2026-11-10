import { BIT_MASK, WORD_SHIFT } from '../core/bit-words.js';
import type { Entity } from './component.js';
import { PAGE_BITS, PAGE_MASK, PAGE_SIZE, PagedBlocks } from './paged-blocks.js';

/** Entity ids start at 1, so 0 marks a vacated dense slot. */
export const VACANT_SLOT = 0;
/** The dense slot no member takes: it stays vacant with an undefined value, so an index entry of 0, which
 *  every entry of a non-member is, reads as absent without a test. */
export const ABSENT_SLOT = 0;
const FIRST_SLOT = ABSENT_SLOT + 1;
const MIN_ENTITY = 1;
/** The largest id an `Int32Array` dense slot holds. */
const MAX_ENTITY = 0x7fffffff;
const INITIAL_CAPACITY = 8;
// The lookups below write the paging and bit-word constants as literals: a read is inlined into its
// caller for free only while every function on its way stays tiny, and a constant read from a module
// binding costs more of that size than one written into the code.
if (PAGE_BITS !== 6 || PAGE_MASK !== 63 || WORD_SHIFT !== 5 || BIT_MASK !== 31) {
  throw new Error('ComponentStore: the lookup literals differ from the paging and bit-word constants');
}

/** Vacated slots are compacted away once they exceed this share of the dense length... */
const VACANCY_COMPACT_FRACTION = 0.25;
/** ...and this count, so a small store churning one member does not rebuild on every removal. */
const VACANCY_COMPACT_MIN = 64;
/** After a compaction the dense arrays shrink to the live length once they are this many times larger. */
const SHRINK_FACTOR = 4;

/**
 * One component's entity-to-value store: a paged entity-to-slot index over dense arrays kept in insertion
 * order. The index blocks share one buffer behind a page table, so a lookup reads two typed arrays the
 * store holds rather than a typed array object per page, and a page without a block reads the zeroed
 * empty block instead of branching. Iteration visits slots in insertion order, like a
 * `Map`: a removal vacates its slot and a re-add appends at the end. Compaction preserves the order and
 * bumps {@link epoch}; every slot carries an ascending insertion sequence so an open cursor can find its
 * place again ({@link firstSlotAfter}).
 */
export class ComponentStore<T> {
  /** A page holds an index block while it holds a member. */
  private readonly blocks = new PagedBlocks((capacity) => this.growBlocks(capacity));
  /** {@link PagedBlocks.pages}, held here so a lookup reads it without passing through the blocks. */
  private pages = this.blocks.pages;
  /** One entry per id of a block's page: the member's slot, or {@link ABSENT_SLOT}. */
  private index = new Int32Array(PAGE_SIZE);
  /** One bit per {@link index} entry, set while it holds a slot: `has` reads this, 32 times denser than
   *  the index, so a membership probe touches fewer cache lines. */
  private memberBits = new Uint32Array(PAGE_SIZE >>> WORD_SHIFT);
  private denseEntities = new Int32Array(INITIAL_CAPACITY);
  private denseSeqs = new Float64Array(INITIAL_CAPACITY);
  private values: Array<T | undefined> = [undefined];
  private revisions = new Float64Array(INITIAL_CAPACITY);
  private denseLength = FIRST_SLOT;
  private liveSize = 0;
  private compactions = 0;
  private nextSeq = 0;

  /** Dense members in insertion order; {@link VACANT_SLOT} marks a vacated slot. Callers only read it. */
  get entities(): Int32Array {
    return this.denseEntities;
  }

  /** Insertion sequence per dense slot, ascending across the dense range. Callers only read it. */
  get seqs(): Float64Array {
    return this.denseSeqs;
  }

  /** Dense slots in use, vacated ones and the never-taken first one included. */
  get length(): number {
    return this.denseLength;
  }

  /** Live members. */
  get size(): number {
    return this.liveSize;
  }

  /** Bumped by every compaction, which moves slots under an open cursor. */
  get epoch(): number {
    return this.compactions;
  }

  /** The dense slot of `entity`, or {@link ABSENT_SLOT} while it is not a member. */
  slotOf(entity: Entity): number {
    return this.index[this.cellOf(entity)] as number;
  }

  has(entity: Entity): boolean {
    return this.memberBit(this.cellOf(entity)) !== 0;
  }

  get(entity: Entity): T | undefined {
    return this.values[this.index[this.cellOf(entity)] as number];
  }

  /** Where `entity`'s entry sits in {@link index} and {@link memberBits}; a page without a block, which
   *  reads `undefined` or the empty block, lands in the empty block's zeroed entries. */
  private cellOf(entity: Entity): number {
    return ((this.pages[entity >>> 6] as number) << 6) | (entity & 63);
  }

  private memberBit(cell: number): number {
    return ((this.memberBits[cell >>> 5] as number) >>> (cell & 31)) & 1;
  }

  valueAt(slot: number): T | undefined {
    return this.values[slot];
  }

  revisionAt(slot: number): number {
    return this.revisions[slot] ?? 0;
  }

  /** Records the revision of a member's value; a non-member is ignored. */
  setRevision(entity: Entity, revision: number): void {
    const slot = this.slotOf(entity);
    if (slot !== ABSENT_SLOT) this.revisions[slot] = revision;
  }

  setRevisionAt(slot: number, revision: number): void {
    this.revisions[slot] = revision;
  }

  /** Stores `value` for `entity`, keeping a member's slot and appending a newcomer; true when it entered. */
  set(entity: Entity, value: T): boolean {
    if (entity < MIN_ENTITY || entity > MAX_ENTITY) {
      throw new RangeError(`ComponentStore.set: entity ${entity} is outside ${MIN_ENTITY}..${MAX_ENTITY}`);
    }
    const block = this.blocks.acquire(entity >>> PAGE_BITS);
    this.pages = this.blocks.pages;
    const at = (block << PAGE_BITS) | (entity & PAGE_MASK);
    const existing = this.index[at] as number;
    if (existing !== ABSENT_SLOT) {
      this.values[existing] = value;
      return false;
    }
    if (this.denseLength === this.denseEntities.length) this.resize(this.denseLength * 2);
    const slot = this.denseLength++;
    this.denseEntities[slot] = entity;
    this.denseSeqs[slot] = this.nextSeq++;
    this.revisions[slot] = 0;
    this.values[slot] = value;
    this.index[at] = slot;
    this.memberBits[at >>> WORD_SHIFT] =
      (this.memberBits[at >>> WORD_SHIFT] as number) | (1 << (at & BIT_MASK));
    this.blocks.retain(block);
    this.liveSize++;
    return true;
  }

  /** Removes `entity`, vacating its slot; true when it was a member. */
  delete(entity: Entity): boolean {
    const page = entity >>> PAGE_BITS;
    const block = this.blocks.blockOf(page);
    const at = (block << PAGE_BITS) | (entity & PAGE_MASK);
    const slot = this.index[at] as number;
    if (slot === ABSENT_SLOT) return false;
    this.index[at] = ABSENT_SLOT;
    this.memberBits[at >>> WORD_SHIFT] =
      (this.memberBits[at >>> WORD_SHIFT] as number) & ~(1 << (at & BIT_MASK));
    this.blocks.release(page, block);
    this.denseEntities[slot] = VACANT_SLOT;
    this.values[slot] = undefined;
    this.liveSize--;
    const vacant = this.denseLength - FIRST_SLOT - this.liveSize;
    if (vacant >= VACANCY_COMPACT_MIN && vacant > (this.denseLength - FIRST_SLOT) * VACANCY_COMPACT_FRACTION)
      this.compact();
    return true;
  }

  /** The first dense slot whose insertion sequence exceeds `seq`: where a cursor that last visited `seq`
   *  resumes after a compaction. */
  firstSlotAfter(seq: number): number {
    let lo = FIRST_SLOT;
    let hi = this.denseLength;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.denseSeqs[mid] ?? 0) > seq) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** Members in insertion order. */
  keys(): Entity[] {
    const out: Entity[] = [];
    for (let slot = FIRST_SLOT; slot < this.denseLength; slot++) {
      const e = this.denseEntities[slot] ?? VACANT_SLOT;
      if (e !== VACANT_SLOT) out.push(e as Entity);
    }
    return out;
  }

  /** Members and values in insertion order; values are live. Unlike a query, the walk does not survive a
   *  compaction, so the store must not shrink while it is open; it throws if it did. */
  *entries(): IterableIterator<[Entity, T]> {
    const epoch = this.compactions;
    for (let slot = FIRST_SLOT; slot < this.denseLength; slot++) {
      const e = this.denseEntities[slot] ?? VACANT_SLOT;
      if (e !== VACANT_SLOT) yield [e as Entity, this.values[slot] as T];
      if (this.compactions !== epoch)
        throw new Error('ComponentStore.entries: store compacted during the walk');
    }
  }

  private compact(): void {
    const { denseEntities: entities, denseSeqs: seqs, revisions, values } = this;
    let to = FIRST_SLOT;
    for (let from = FIRST_SLOT; from < this.denseLength; from++) {
      const e = entities[from] ?? VACANT_SLOT;
      if (e === VACANT_SLOT) continue;
      if (to !== from) {
        entities[to] = e;
        seqs[to] = seqs[from] ?? 0;
        revisions[to] = revisions[from] ?? 0;
        values[to] = values[from];
        this.index[(this.blocks.blockOf(e >>> PAGE_BITS) << PAGE_BITS) | (e & PAGE_MASK)] = to;
      }
      to++;
    }
    values.length = to;
    this.denseLength = to;
    this.compactions++;
    const live = to - FIRST_SLOT;
    if (entities.length > INITIAL_CAPACITY && entities.length >= live * SHRINK_FACTOR) {
      this.resize(Math.max(INITIAL_CAPACITY, to + live));
    }
  }

  private growBlocks(capacity: number): void {
    const bits = new Uint32Array((capacity << PAGE_BITS) >>> WORD_SHIFT);
    bits.set(this.memberBits);
    this.memberBits = bits;
    const index = new Int32Array(capacity << PAGE_BITS);
    index.set(this.index);
    this.index = index;
  }

  private resize(capacity: number): void {
    const entities = new Int32Array(capacity);
    entities.set(this.denseEntities.subarray(0, this.denseLength));
    this.denseEntities = entities;
    const seqs = new Float64Array(capacity);
    seqs.set(this.denseSeqs.subarray(0, this.denseLength));
    this.denseSeqs = seqs;
    const revisions = new Float64Array(capacity);
    revisions.set(this.revisions.subarray(0, this.denseLength));
    this.revisions = revisions;
  }
}
