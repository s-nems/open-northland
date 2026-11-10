import { BIT_MASK, WORD_SHIFT } from '../core/bit-words.js';
import type { Component, Entity } from './component.js';

/** Distinct pending entities past which a feed drops them and reports overflow, so a feed nobody
 *  drains any more stops growing and a reader that falls this far behind rebuilds. */
export const CHANGE_FEED_LIMIT = 1 << 16;

/** Entries a fresh feed buffer holds before its first doubling. */
const INITIAL_FEED_CAPACITY = 64;

/**
 * The entities whose membership or in-place value in any watched store changed since the last
 * {@link drain}, in one log across the stores, so a view that reads several stores asks one question
 * instead of comparing each store's generation. Each pending entity is held once, at its first write
 * since the last drain: a bitset by entity id drops every later write. Entries live in two typed
 * buffers that swap on drain and keep their capacity, so a steady writer allocates nothing per tick.
 */
export class ChangeFeed {
  private entities = new Int32Array(INITIAL_FEED_CAPACITY);
  /** The last drained buffer, emptied and reused by the next drain. */
  private spare = new Int32Array(INITIAL_FEED_CAPACITY);
  private count = 0;
  /** One bit per entity id, set while the entity is in {@link entities}; grown to the largest id. */
  private held = new Uint32Array(0);
  private overflowed = false;

  record(entity: Entity): void {
    const word = entity >>> WORD_SHIFT;
    const bit = 1 << (entity & BIT_MASK);
    const held = this.held;
    // A word past the bitset reads `undefined`, which holds no bit.
    if ((held[word] as number) & bit) return;
    const count = this.count;
    if (word >= held.length || count === this.entities.length || this.overflowed) {
      this.recordSlow(entity);
      return;
    }
    held[word] = (held[word] as number) | bit;
    this.entities[count] = entity;
    this.count = count + 1;
  }

  /** {@link record} for a feed that overflowed or must first grow a buffer. */
  private recordSlow(entity: Entity): void {
    if (this.overflowed) return;
    const word = entity >>> WORD_SHIFT;
    if (word >= this.held.length) this.held = grownBits(this.held, word);
    const count = this.count;
    if (count >= CHANGE_FEED_LIMIT) {
      this.lose();
      return;
    }
    this.held[word] = (this.held[word] as number) | (1 << (entity & BIT_MASK));
    if (count === this.entities.length) this.entities = grown(this.entities);
    this.entities[count] = entity;
    this.count = count + 1;
  }

  /** Forget the entries, marking the feed overflowed: its reader can no longer replay them. */
  lose(): void {
    this.release(this.entities, this.count);
    this.overflowed = true;
    this.count = 0;
  }

  get pending(): boolean {
    return this.overflowed || this.count > 0;
  }

  /** Whether `entity` is pending: recorded since the last drain, or any entity after an overflow. */
  has(entity: Entity): boolean {
    if (this.overflowed) return true;
    const word = entity >>> WORD_SHIFT;
    return word < this.held.length && ((this.held[word] as number) & (1 << (entity & BIT_MASK))) !== 0;
  }

  /** Hand every recorded entity to `visit` without draining, for a verifier that must tell a known
   *  pending change from staleness. Returns true instead when entries were lost to an overflow. */
  peek(visit: (entity: Entity) => void): boolean {
    if (!this.overflowed) for (let i = 0; i < this.count; i++) visit(this.entities[i] as Entity);
    return this.overflowed;
  }

  /** Hand every recorded entity to `consume` once, in first-write order, and empty the feed. A write
   *  `consume` causes lands in the next drain. Returns true instead when entries were lost to an
   *  overflow, so the reader must rebuild from the stores. */
  drain(consume: (entity: Entity) => void): boolean {
    const { entities, count, overflowed } = this;
    this.entities = this.spare;
    this.spare = entities;
    this.count = 0;
    this.overflowed = false;
    this.release(entities, count);
    if (!overflowed) for (let i = 0; i < count; i++) consume(entities[i] as Entity);
    return overflowed;
  }

  private release(entities: Int32Array, count: number): void {
    const held = this.held;
    for (let i = 0; i < count; i++) {
      const e = entities[i] as number;
      const word = e >>> WORD_SHIFT;
      held[word] = (held[word] as number) & ~(1 << (e & BIT_MASK));
    }
  }
}

function grown(buffer: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer> {
  const next = new Int32Array(Math.min(buffer.length * 2, CHANGE_FEED_LIMIT));
  next.set(buffer);
  return next;
}

function grownBits(bits: Uint32Array<ArrayBuffer>, word: number): Uint32Array<ArrayBuffer> {
  const next = new Uint32Array(Math.max(word + 1, bits.length * 2));
  next.set(bits);
  return next;
}

/** Each component's watching feeds, indexed by {@link Component.id}. */
export class ChangeFeeds {
  private readonly membership: Array<ChangeFeed[] | undefined> = [];
  private readonly values: Array<ChangeFeed[] | undefined> = [];

  watch(
    feed: ChangeFeed,
    membership: readonly Component<unknown>[],
    values: readonly Component<unknown>[],
  ): void {
    for (const c of membership) addFeed(this.membership, c, feed);
    for (const c of values) addFeed(this.values, c, feed);
  }

  membershipChanged(component: Component<unknown>, entity: Entity): void {
    recordAll(this.membership[component.id], entity);
  }

  valueWritten(component: Component<unknown>, entity: Entity): void {
    recordAll(this.values[component.id], entity);
  }

  /** A bulk fill that names no entity, such as a restore, invalidates every feed watching `component`. */
  storeReplaced(component: Component<unknown>): void {
    for (const feed of this.membership[component.id] ?? []) feed.lose();
    for (const feed of this.values[component.id] ?? []) feed.lose();
  }
}

function addFeed(
  byId: Array<ChangeFeed[] | undefined>,
  component: Component<unknown>,
  feed: ChangeFeed,
): void {
  const feeds = byId[component.id];
  if (feeds === undefined) byId[component.id] = [feed];
  else feeds.push(feed);
}

/** Indexed rather than `for...of`: every tracked write world-wide passes through here. */
function recordAll(feeds: readonly ChangeFeed[] | undefined, entity: Entity): void {
  if (feeds === undefined) return;
  for (let i = 0; i < feeds.length; i++) feeds[i]?.record(entity);
}
