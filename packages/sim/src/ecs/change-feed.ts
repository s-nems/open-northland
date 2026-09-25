import type { Component, Entity } from './component.js';

/** Unread entries past which a feed drops them and reports overflow, so a reader that falls behind
 *  rebuilds instead of the feed growing without bound. */
export const CHANGE_FEED_LIMIT = 4096;

/**
 * The entities whose membership or in-place value in any watched store changed since the last
 * {@link drain}, in one log across the stores, so a view that reads several stores asks one question
 * instead of comparing each store's generation. An immediate repeat of the same entity is dropped.
 */
export class ChangeFeed {
  private entities: Entity[] = [];
  /** The last drained buffer, emptied and reused so a drain allocates nothing. */
  private spare: Entity[] = [];
  private overflowed = false;

  record(entity: Entity): void {
    if (this.overflowed || this.entities[this.entities.length - 1] === entity) return;
    if (this.entities.length >= CHANGE_FEED_LIMIT) {
      this.overflowed = true;
      this.entities = [];
      return;
    }
    this.entities.push(entity);
  }

  /** Forget the entries, marking the feed overflowed: its reader can no longer replay them. */
  lose(): void {
    this.overflowed = true;
    this.entities = [];
  }

  get pending(): boolean {
    return this.overflowed || this.entities.length > 0;
  }

  /** Hand every recorded entity to `consume`, possibly repeated, and empty the feed. Returns true
   *  instead when entries were lost to an overflow, so the reader must rebuild from the stores. */
  drain(consume: (entity: Entity) => void): boolean {
    const { entities, overflowed } = this;
    this.entities = this.spare;
    this.spare = entities;
    this.overflowed = false;
    if (!overflowed) for (let i = 0; i < entities.length; i++) consume(entities[i] as Entity);
    entities.length = 0;
    return overflowed;
  }
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
