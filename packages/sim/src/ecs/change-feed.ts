import type { Component, Entity } from './component.js';

/** Unread entries past which a feed drops them and reports overflow, so a reader that falls behind
 *  rebuilds instead of the feed growing without bound. */
export const CHANGE_FEED_LIMIT = 4096;

/** Entries a fresh feed buffer holds before its first doubling. */
const INITIAL_FEED_CAPACITY = 64;

/**
 * The entities whose membership or in-place value in any watched store changed since the last
 * {@link drain}, in one log across the stores, so a view that reads several stores asks one question
 * instead of comparing each store's generation. An immediate repeat of the same entity is dropped.
 * Entries live in two typed buffers that swap on drain and keep their capacity, so a steady writer
 * allocates nothing per tick.
 */
export class ChangeFeed {
  private entities = new Int32Array(INITIAL_FEED_CAPACITY);
  /** The last drained buffer, emptied and reused by the next drain. */
  private spare = new Int32Array(INITIAL_FEED_CAPACITY);
  private count = 0;
  private overflowed = false;

  record(entity: Entity): void {
    const count = this.count;
    if (this.overflowed || (count > 0 && this.entities[count - 1] === entity)) return;
    if (count >= CHANGE_FEED_LIMIT) {
      this.lose();
      return;
    }
    if (count === this.entities.length) this.entities = grown(this.entities);
    this.entities[count] = entity;
    this.count = count + 1;
  }

  /** Forget the entries, marking the feed overflowed: its reader can no longer replay them. */
  lose(): void {
    this.overflowed = true;
    this.count = 0;
  }

  get pending(): boolean {
    return this.overflowed || this.count > 0;
  }

  /** Hand every recorded entity to `visit` without draining, for a verifier that must tell a known
   *  pending change from staleness. Returns true instead when entries were lost to an overflow. */
  peek(visit: (entity: Entity) => void): boolean {
    if (!this.overflowed) for (let i = 0; i < this.count; i++) visit(this.entities[i] as Entity);
    return this.overflowed;
  }

  /** Hand every recorded entity to `consume`, possibly repeated, and empty the feed. Returns true
   *  instead when entries were lost to an overflow, so the reader must rebuild from the stores. */
  drain(consume: (entity: Entity) => void): boolean {
    const { entities, count, overflowed } = this;
    this.entities = this.spare;
    this.spare = entities;
    this.count = 0;
    this.overflowed = false;
    if (!overflowed) for (let i = 0; i < count; i++) consume(entities[i] as Entity);
    return overflowed;
  }
}

function grown(buffer: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer> {
  const next = new Int32Array(Math.min(buffer.length * 2, CHANGE_FEED_LIMIT));
  next.set(buffer);
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
