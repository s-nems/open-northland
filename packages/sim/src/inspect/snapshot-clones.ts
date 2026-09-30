import type { SimEvent } from '../core/events.js';
import { TOUCHED_LOG_OVERFLOW_LIMIT } from '../ecs/touched-log.js';
import type { Component, Entity, World } from '../ecs/world.js';
import { type DeltaDigest, EntityDigest } from './entity-digest.js';
import { clonePlain } from './plain-clone.js';
import type { EntitySnapshot } from './snapshot.js';

/**
 * The changes of one stretch of ticks, in the shape a mirror rebuilds the snapshot from and a worker
 * boundary carries whole: plain data, structured-cloneable like the snapshot itself.
 */
export interface SnapshotDelta {
  /** The tick the delta brings a mirror to. */
  readonly tick: number;
  /** The delta's place in its stream, counting from 0 and including rebuilds: a mirror refuses a
   *  non-rebuild delta that does not directly follow the one it applied last. */
  readonly sequence: number;
  /** The touched log overflowed or the stream just opened: `touched` carries every alive entity whole
   *  and the mirror replaces its whole list. */
  readonly rebuild: boolean;
  /** Every entity created or mutated since the base and still alive, ascending by id. */
  readonly touched: readonly EntityDelta[];
  /** Ids destroyed since the base, ascending; empty with `rebuild`. May name an entity that was
   *  created and destroyed inside the stretch, which the mirror never held. */
  readonly removed: readonly number[];
  /** The events of `tick`, as the snapshot carries them. */
  readonly events: readonly SimEvent[];
  /** The world at `tick` as a stream opened with `digest` folds it, for `MirrorTruth` to compare. */
  readonly digest?: DeltaDigest;
}

/** One touched entity's changes since the base. An entity the base did not hold, and every entity of
 *  a rebuild, carries all of its components. */
export interface EntityDelta {
  readonly id: number;
  /** componentName -> a fresh clone, for the components written since the base. */
  readonly components: Readonly<Record<string, unknown>>;
  /** The components the entity carried at the base and no longer does. */
  readonly removed: readonly string[];
}

/** Untouched entities and unwritten components retain their detached clone identities. */
interface CachedEntity {
  readonly snap: EntitySnapshot;
  readonly written: Set<Component<unknown>>;
  membershipChanged: boolean;
}

/** What one open stream has accumulated since its last delta. */
interface PendingDelta {
  /** Alive entities mutated since the base. */
  readonly touched: Set<Entity>;
  readonly removed: Set<Entity>;
  readonly written: Map<Entity, Set<Component<unknown>>>;
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
  private readonly streams = new Set<PendingDelta>();

  constructor(private readonly world: World) {
    world.trackTouchedComponents();
    world.registerCacheVerifier('snapshotClones', () => this.verify());
  }

  /** Drain the touched log: mark the cache dirty and feed every open stream. An overflowed log lost its
   *  individual evictions, so the cache and the streams start over; a stream whose own backlog reaches
   *  the same bound (nobody took its deltas) starts over alone. */
  refresh(): void {
    const world = this.world;
    const overflowed = world.drainTouched((e, written, membership) => {
      const alive = world.isAlive(e);
      const cached = this.entries.get(e);
      if (cached !== undefined) {
        if (alive) {
          for (const component of written) cached.written.add(component);
          cached.membershipChanged ||= membership;
        } else this.entries.delete(e);
      }
      for (const stream of this.streams) {
        if (stream.rebuild) continue; // the next delta carries every alive entity anyway
        if (alive) {
          stream.touched.add(e);
          let names = stream.written.get(e);
          if (names === undefined) {
            names = new Set();
            stream.written.set(e, names);
          }
          for (const component of written) names.add(component);
        } else {
          stream.touched.delete(e);
          stream.written.delete(e);
          stream.removed.add(e);
        }
      }
    });
    if (overflowed) this.entries.clear();
    for (const stream of this.streams) {
      if (stream.rebuild) continue;
      if (overflowed || stream.touched.size + stream.removed.size > TOUCHED_LOG_OVERFLOW_LIMIT) {
        stream.touched.clear();
        stream.written.clear();
        stream.removed.clear();
        stream.rebuild = true;
      }
    }
  }

  /** The cached clone of an alive entity, remade when a drained mutation marked it dirty. */
  entryOf(id: Entity): CachedEntity {
    let cached = this.entries.get(id);
    if (cached === undefined || cached.membershipChanged || cached.written.size > 0) {
      cached = cloneEntity(this.world, id, cached);
      this.entries.set(id, cached);
    }
    return cached;
  }

  /** Open a stream whose first delta rebuilds. */
  open(): PendingDelta {
    const pending: PendingDelta = {
      touched: new Set(),
      removed: new Set(),
      written: new Map(),
      rebuild: true,
    };
    this.streams.add(pending);
    return pending;
  }

  close(pending: PendingDelta): void {
    this.streams.delete(pending);
  }

  private verify(): string[] {
    const out: string[] = [];
    for (const [id, cached] of this.entries) {
      if (!this.world.isAlive(id)) continue; // evicted lazily on the next drain - absence is not incoherence
      if (this.world.mutationPending(id)) continue; // logged for refresh - scheduled staleness, not a bypass
      const fresh = cloneEntity(this.world, id);
      if (JSON.stringify(fresh.snap.components) !== JSON.stringify(cached.snap.components)) {
        out.push(`snapshot clone of entity ${id} is stale - an in-place mutation bypassed World.mut`);
      }
    }
    return out;
  }
}

function cloneEntity(world: World, id: Entity, previous?: CachedEntity): CachedEntity {
  const components: Record<string, unknown> =
    previous === undefined || previous.membershipChanged ? {} : { ...previous.snap.components };
  if (previous === undefined || previous.membershipChanged) {
    const writtenNames = new Set([...(previous?.written ?? [])].map((component) => component.name));
    world.forEachComponent(id, (name, value) => {
      components[name] =
        previous !== undefined && !writtenNames.has(name) && Object.hasOwn(previous.snap.components, name)
          ? previous.snap.components[name]
          : clonePlain(value);
    });
  } else {
    for (const component of previous.written) {
      components[component.name] = clonePlain(world.get(id, component));
    }
  }
  const written = previous?.written ?? new Set<Component<unknown>>();
  written.clear();
  return { snap: { id: id as number, components }, written, membershipChanged: false };
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
const NO_COMPONENT_NAMES: readonly string[] = [];

export interface SnapshotDeltaStreamOptions {
  /** Fold the world's clones of every entity a delta names into a digest the delta carries: a
   *  diagnostic, since it hashes each changed component once more. */
  readonly digest?: boolean;
}

/**
 * The per-tick change feed one mirror rebuilds the snapshot from. Each stream accumulates on its own,
 * so two streams over one world each see every change; a stream nobody takes from is bounded by the
 * touched log's overflow limit, past which its next delta rebuilds. Close a stream its mirror outlives.
 */
export class SnapshotDeltaStream {
  private readonly clones: SnapshotClones;
  private readonly pending: PendingDelta;
  /** Last sent component record supplies presence at each stream's independent base. */
  private readonly sent = new Map<Entity, Readonly<Record<string, unknown>>>();
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
    let touched: EntityDelta[];
    let removed: Entity[];
    if (pending.rebuild) {
      this.sent.clear();
      this.digest?.clear();
      touched = world.canonicalEntities().map((id) => this.whole(id));
      removed = [];
    } else {
      removed = ascending(pending.removed);
      for (const id of removed) {
        this.sent.delete(id);
        this.digest?.drop(id);
      }
      touched = ascending(pending.touched).map((id) => this.changesOf(id));
    }
    const delta: SnapshotDelta = {
      tick,
      sequence: this.sequence++,
      rebuild: pending.rebuild,
      touched,
      removed,
      events: cloneEvents(this.source.events.current()),
      ...(this.digest === null ? {} : { digest: { entities: world.entityCount, hash: this.digest.hash } }),
    };
    pending.touched.clear();
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
  private whole(id: Entity): EntityDelta {
    const cached = this.clones.entryOf(id);
    this.sent.set(id, cached.snap.components);
    this.digest?.fold(cached.snap);
    return { id, components: cached.snap.components, removed: NO_COMPONENT_NAMES };
  }

  /** Emit only the components written since this stream last drained. */
  private changesOf(id: Entity): EntityDelta {
    const base = this.sent.get(id);
    if (base === undefined) return this.whole(id);
    const cached = this.clones.entryOf(id);
    this.sent.set(id, cached.snap.components);
    this.digest?.fold(cached.snap);
    const components: Record<string, unknown> = {};
    let removed: string[] | undefined;
    // Preserve the component registration order carried by complete snapshots.
    const written = [...(this.pending.written.get(id) ?? [])];
    written.sort((a, b) => this.source.world.componentOrder(a) - this.source.world.componentOrder(b));
    for (const component of written) {
      const name = component.name;
      if (Object.hasOwn(cached.snap.components, name)) components[name] = cached.snap.components[name];
      else if (Object.hasOwn(base, name)) {
        removed ??= [];
        removed.push(name);
      }
    }
    return { id, components, removed: removed ?? NO_COMPONENT_NAMES };
  }
}

function ascending(ids: ReadonlySet<Entity>): Entity[] {
  return [...ids].sort((a, b) => a - b);
}
