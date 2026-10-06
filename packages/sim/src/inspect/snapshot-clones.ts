import type { SimEvent } from '../core/events.js';
import { TOUCHED_LOG_OVERFLOW_LIMIT } from '../ecs/touched-log.js';
import type { Component, Entity, World } from '../ecs/world.js';
import { EntityDigest } from './entity-digest.js';
import { addField } from './fast-record.js';
import { PendingWrites } from './pending-writes.js';
import { clonePlain } from './plain-clone.js';
import type { EntitySnapshot } from './snapshot.js';
import { DeltaColumns, DeltaShapes, type SnapshotDelta } from './snapshot-delta.js';

/** Untouched entities and unwritten components retain their detached clone identities. */
interface CachedEntity {
  /** The clones of the entity's components, a written one replaced in place: never handed out, so a
   *  write costs its own clone and not a copy of the record. */
  components: Record<string, unknown>;
  /** The record as `takeSnapshot` hands it out, made on its first read after a write. */
  snap: EntitySnapshot | null;
  readonly written: Set<Component<unknown>>;
  membershipChanged: boolean;
}

/** What one open stream has accumulated since its last delta. */
interface PendingDelta {
  readonly removed: Set<Entity>;
  /** The components each alive entity wrote since the base, in first-write order. */
  readonly written: PendingWrites;
  rebuild: boolean;
}

/**
 * Per-world cache of cloned entity snapshots, refreshed from the world's touched log. The log is
 * drained once, so every open delta stream accumulates its own view of the drained entities. A
 * registered cache verifier re-clones and compares, so a mutation that bypasses `World.mut` fails
 * invariant-checked runs.
 */
class SnapshotClones {
  private readonly entries = new Map<Entity, CachedEntity>();
  private readonly streams: PendingDelta[] = [];

  constructor(private readonly world: World) {
    world.trackTouchedComponents();
    world.registerCacheVerifier('snapshotClones', () => this.verify());
  }

  /** Drain the touched log: mark the cache dirty and feed every open stream. An overflowed log lost its
   *  individual evictions, so the cache and the streams start over; a stream whose own backlog reaches
   *  the same bound (nobody took its deltas) starts over alone. */
  refresh(): void {
    const world = this.world;
    const overflowed = world.drainTouched((e, written, count, membership) => {
      const alive = world.isAlive(e);
      const cached = this.entries.get(e);
      if (cached !== undefined) {
        if (alive) {
          for (let i = 0; i < count; i++) cached.written.add(written[i] as Component<unknown>);
          cached.membershipChanged ||= membership;
        } else this.entries.delete(e);
      }
      for (const stream of this.streams) {
        if (stream.rebuild) continue; // the next delta carries every alive entity anyway
        if (alive) stream.written.add(e, written, count);
        else {
          stream.written.delete(e);
          stream.removed.add(e);
        }
      }
    });
    if (overflowed) this.entries.clear();
    for (const stream of this.streams) {
      if (stream.rebuild) continue;
      if (overflowed || stream.written.size + stream.removed.size > TOUCHED_LOG_OVERFLOW_LIMIT) {
        stream.written.clear();
        stream.removed.clear();
        stream.rebuild = true;
      }
    }
  }

  /** The detached snapshot of an alive entity: the same object until the entity is written again. */
  snapOf(id: Entity): EntitySnapshot {
    const cached = this.entryOf(id);
    cached.snap ??= { id, components: Object.assign({}, cached.components) };
    return cached.snap;
  }

  private entryOf(id: Entity): CachedEntity {
    let cached = this.entries.get(id);
    if (cached === undefined) {
      cached = {
        components: cloneComponents(this.world, id),
        snap: null,
        written: new Set(),
        membershipChanged: false,
      };
      this.entries.set(id, cached);
    } else if (cached.membershipChanged) {
      cached.components = cloneComponents(this.world, id, cached);
      cached.snap = null;
      cached.written.clear();
      cached.membershipChanged = false;
    } else if (cached.written.size > 0) {
      for (const component of cached.written) {
        cached.components[component.name] = clonePlain(this.world.get(id, component));
      }
      cached.snap = null;
      cached.written.clear();
    }
    return cached;
  }

  /** Open a stream whose first delta rebuilds. */
  open(): PendingDelta {
    const pending: PendingDelta = {
      removed: new Set(),
      written: new PendingWrites(),
      rebuild: true,
    };
    this.streams.push(pending);
    return pending;
  }

  close(pending: PendingDelta): void {
    const at = this.streams.indexOf(pending);
    if (at >= 0) this.streams.splice(at, 1);
  }

  private verify(): string[] {
    const out: string[] = [];
    for (const [id, cached] of this.entries) {
      if (!this.world.isAlive(id)) continue; // evicted lazily on the next drain - absence is not incoherence
      if (this.world.mutationPending(id)) continue; // logged for refresh - scheduled staleness, not a bypass
      if (cached.membershipChanged || cached.written.size > 0) continue; // drained, re-cloned on next read
      const fresh = cloneComponents(this.world, id);
      if (JSON.stringify(fresh) !== JSON.stringify(cached.components)) {
        out.push(`snapshot clone of entity ${id} is stale - an in-place mutation bypassed World.mut`);
      }
    }
    return out;
  }
}

/** Every component of the entity cloned in registration order; with `previous`, its clones of the
 *  components it did not write since are kept. */
function cloneComponents(world: World, id: Entity, previous?: CachedEntity): Record<string, unknown> {
  const components: Record<string, unknown> = {};
  const writtenNames = new Set([...(previous?.written ?? [])].map((component) => component.name));
  let fields = 0;
  world.forEachComponent(id, (name, value) => {
    const clone =
      previous !== undefined && !writtenNames.has(name) && Object.hasOwn(previous.components, name)
        ? previous.components[name]
        : clonePlain(value);
    addField(components, fields++, name, clone);
  });
  return components;
}

const clonesByWorld = new WeakMap<World, SnapshotClones>();

export function snapshotClonesFor(world: World): SnapshotClones {
  let clones = clonesByWorld.get(world);
  if (clones === undefined) {
    clones = new SnapshotClones(world);
    clonesByWorld.set(world, clones);
  }
  return clones;
}

/** SimEvents carry no Map fields, so PlainOf<SimEvent> is structurally a SimEvent and this cast holds.
 *  Adding one would lower it to a [k, v] array and break the cast. */
export function cloneEvents(events: readonly SimEvent[]): readonly SimEvent[] {
  return events.map(clonePlain) as readonly SimEvent[];
}

/** What a delta stream reads of the simulation at take time; `Simulation` satisfies it. */
export interface SnapshotDeltaSource {
  readonly world: World;
  readonly tick: number;
  readonly events: { current(): readonly SimEvent[] };
}

const NO_TICK = -1;
const NO_VERSION = -1;

export interface SnapshotDeltaStreamOptions {
  /** Fold the world's clones of every entity a delta names into a digest the delta carries: a
   *  diagnostic, since it hashes each changed component once more. */
  readonly digest?: boolean;
}

/**
 * The per-tick change feed one mirror rebuilds the snapshot from. Each stream accumulates on its own,
 * so two streams over one world each see every change; a stream nobody takes from is bounded by the
 * touched log's overflow limit, past which its next delta rebuilds. Close a stream its mirror outlives.
 * A delta reads the written values off the live world, not the clone cache, which only `takeSnapshot`
 * and the digest fill.
 */
export class SnapshotDeltaStream {
  private readonly clones: SnapshotClones;
  private readonly pending: PendingDelta;
  /** The entities this stream carried whole since its last rebuild: the others go whole next. */
  private readonly sent = new Set<Entity>();
  private readonly shapes = new DeltaShapes();
  private lastTick = NO_TICK;
  private lastVersion = NO_VERSION;
  private sequence = 0;
  private closed = false;
  private readonly digest: EntityDigest | null;

  constructor(
    private readonly source: SnapshotDeltaSource,
    options: SnapshotDeltaStreamOptions = {},
  ) {
    this.clones = snapshotClonesFor(source.world);
    this.pending = this.clones.open();
    this.digest = options.digest === true ? new EntityDigest() : null;
  }

  /**
   * The changes since the previous delta, or null while the tick and the world's mutation version still
   * hold. Taken once per stepped tick it is that tick's delta; taken later it spans the ticks between
   * and carries the last one's events.
   */
  next(): SnapshotDelta | null {
    if (this.closed) throw new Error('snapshot delta stream: closed, its changes are no longer collected');
    const { world, tick } = this.source;
    const version = world.mutationVersion;
    if (tick === this.lastTick && version === this.lastVersion) return null;
    this.clones.refresh();
    const pending = this.pending;
    const columns = new DeltaColumns(this.shapes);
    let removed: Entity[];
    if (pending.rebuild) {
      this.sent.clear();
      this.digest?.clear();
      for (const id of world.canonicalEntities()) this.whole(columns, id);
      removed = [];
    } else {
      removed = ascending(pending.removed);
      for (const id of removed) {
        this.sent.delete(id);
        this.digest?.drop(id);
      }
      const ids = pending.written.ascending();
      for (let i = 0; i < ids.length; i++) this.changesOf(columns, ids[i] as Entity);
    }
    const delta: SnapshotDelta = {
      tick,
      sequence: this.sequence++,
      rebuild: pending.rebuild,
      ...columns.columns(),
      removed,
      events: cloneEvents(this.source.events.current()),
      ...(this.digest === null ? {} : { digest: { entities: world.entityCount, hash: this.digest.hash } }),
    };
    pending.written.clear();
    pending.removed.clear();
    pending.rebuild = false;
    this.lastTick = tick;
    this.lastVersion = version;
    return delta;
  }

  /** Stop collecting; a later `next()` throws rather than hand a mirror a delta missing changes. */
  close(): void {
    this.closed = true;
    this.sent.clear();
    this.clones.close(this.pending);
  }

  /** The entity with all of its components, as a rebuild and a creation carry it. */
  private whole(columns: DeltaColumns, id: Entity): void {
    this.sent.add(id);
    this.digest?.fold(this.clones.snapOf(id));
    columns.begin(id);
    this.source.world.forEachComponent(id, (name, value) => columns.writeLive(name, value));
    columns.end();
  }

  /** Emit only the components written since this stream last drained. */
  private changesOf(columns: DeltaColumns, id: Entity): void {
    if (!this.sent.has(id)) {
      this.whole(columns, id);
      return;
    }
    const world = this.source.world;
    this.digest?.fold(this.clones.snapOf(id));
    // Preserve the component registration order carried by complete snapshots: an insertion sort, since
    // an entity writes a handful of components and the built-in sort allocates per call.
    const written = this.pending.written.writtenBy(id);
    const count = this.pending.written.writtenCount(id);
    for (let i = 1; i < count; i++) {
      const component = written[i] as Component<unknown>;
      const order = world.componentOrder(component);
      let at = i;
      for (; at > 0 && world.componentOrder(written[at - 1] as Component<unknown>) > order; at--) {
        written[at] = written[at - 1] as Component<unknown>;
      }
      written[at] = component;
    }
    columns.begin(id);
    for (let i = 0; i < count; i++) {
      const component = written[i] as Component<unknown>;
      const value = world.tryGet(id, component);
      if (value === undefined) columns.drop(component.name);
      else columns.writeLive(component.name, value);
    }
    columns.end();
  }
}

function ascending(ids: Iterable<Entity>): Entity[] {
  return [...ids].sort((a, b) => a - b);
}
