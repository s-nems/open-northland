import type { Component, Entity } from '../ecs/world.js';

/** Entity ids below this find their slot in a dense array; a higher id (only a crafted save can name
 *  one) falls back to a map, so a hostile id cannot size the array. */
const DENSE_LIMIT = 1 << 24;
const INITIAL_CAPACITY = 1024;
/** A slot whose entity was destroyed after it was logged. */
const DEAD = -1;
/** What an entity never logged wrote; never written to, since its count is 0. */
const NO_COMPONENTS: Component<unknown>[] = [];

/**
 * The alive entities one delta stream has seen written since its last delta, each with the components
 * it wrote in first-write order. Each entity holds a slot found through a dense, epoch-stamped id
 * array, and the slots and their component lists are reused from delta to delta, so logging a write
 * allocates nothing once the lists have grown.
 */
export class PendingWrites {
  /** Per slot, its entity, or {@link DEAD}. */
  private ids = new Int32Array(INITIAL_CAPACITY);
  /** Per slot, its entity's components: the first `listCounts[slot]` entries. A list keeps its storage
   *  from delta to delta. */
  private readonly lists: Component<unknown>[][] = [];
  private listCounts = new Int32Array(INITIAL_CAPACITY);
  private count = 0;
  private alive = 0;
  /** Per dense entity id, the epoch it was last logged in and its slot then. */
  private stamps = new Int32Array(INITIAL_CAPACITY);
  private slots = new Int32Array(INITIAL_CAPACITY);
  private readonly sparse = new Map<Entity, number>();
  private epoch = 1;

  /** The entities logged and still alive. */
  get size(): number {
    return this.alive;
  }

  /** Log the first `count` of `written` for `entity`, after what it wrote before. */
  add(entity: Entity, written: readonly Component<unknown>[], count = written.length): void {
    let slot = this.slotOf(entity);
    if (slot < 0) slot = this.open(entity);
    else if (this.ids[slot] === DEAD) {
      this.ids[slot] = entity;
      this.alive++;
    }
    const list = this.lists[slot] as Component<unknown>[];
    let held = this.listCounts[slot] as number;
    for (let i = 0; i < count; i++) {
      const component = written[i] as Component<unknown>;
      let found = false;
      for (let k = 0; k < held && !found; k++) found = list[k] === component;
      if (found) continue;
      if (held < list.length) list[held] = component;
      else list.push(component);
      held++;
    }
    this.listCounts[slot] = held;
  }

  /** The entity died: it is no longer pending, though it keeps its slot until the next clear. */
  delete(entity: Entity): void {
    const slot = this.slotOf(entity);
    if (slot < 0 || this.ids[slot] === DEAD) return;
    this.ids[slot] = DEAD;
    this.listCounts[slot] = 0;
    this.alive--;
  }

  /** The alive entities logged, ascending. */
  ascending(): Int32Array {
    const out = new Int32Array(this.alive);
    let at = 0;
    for (let slot = 0; slot < this.count; slot++) {
      const id = this.ids[slot] as number;
      if (id !== DEAD) out[at++] = id;
    }
    return out.sort();
  }

  /** The list whose first {@link writtenCount} entries are the components `entity` wrote, in first-write
   *  order; the caller may reorder those in place. */
  writtenBy(entity: Entity): Component<unknown>[] {
    const slot = this.slotOf(entity);
    return slot < 0 ? NO_COMPONENTS : (this.lists[slot] as Component<unknown>[]);
  }

  writtenCount(entity: Entity): number {
    const slot = this.slotOf(entity);
    return slot < 0 ? 0 : (this.listCounts[slot] as number);
  }

  clear(): void {
    this.count = 0;
    this.alive = 0;
    this.epoch++;
    this.sparse.clear();
  }

  /** The entity's slot in the current epoch, or -1. */
  private slotOf(entity: Entity): number {
    if (entity >= DENSE_LIMIT) return this.sparse.get(entity) ?? -1;
    return entity < this.stamps.length && this.stamps[entity] === this.epoch
      ? (this.slots[entity] as number)
      : -1;
  }

  private open(entity: Entity): number {
    const slot = this.count++;
    if (slot === this.ids.length) {
      this.ids = grown(this.ids, slot + 1);
      this.listCounts = grown(this.listCounts, slot + 1);
    }
    this.ids[slot] = entity;
    this.listCounts[slot] = 0;
    this.alive++;
    if (slot === this.lists.length) this.lists.push([]);
    if (entity >= DENSE_LIMIT) this.sparse.set(entity, slot);
    else {
      if (entity >= this.stamps.length) {
        this.stamps = grown(this.stamps, entity + 1);
        this.slots = grown(this.slots, entity + 1);
      }
      this.stamps[entity] = this.epoch;
      this.slots[entity] = slot;
    }
    return slot;
  }
}

function grown(buffer: Int32Array<ArrayBuffer>, needed: number): Int32Array<ArrayBuffer> {
  let length = buffer.length * 2;
  while (length < needed) length *= 2;
  const next = new Int32Array(length);
  next.set(buffer);
  return next;
}
