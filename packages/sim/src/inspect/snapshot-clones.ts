import type { SimEvent } from '../core/events.js';
import { TOUCHED_LOG_OVERFLOW_LIMIT } from '../ecs/touched-log.js';
import type { Entity, World } from '../ecs/world.js';
import { clonePlain } from './plain-clone.js';
import type { EntitySnapshot } from './snapshot.js';

/**
 * The changes of one stretch of ticks, in the shape a mirror rebuilds the snapshot from and a worker
 * boundary carries whole: plain data, structured-cloneable like the snapshot itself.
 */
export interface SnapshotDelta {
  /** The tick the delta brings a mirror to. */
  readonly tick: number;
  /** The mirror tick it applies on, the previous delta's `tick`; a mirror at another tick refuses it.
   *  Meaningless with `rebuild`. */
  readonly baseTick: number;
  /** The touched log overflowed or the stream just opened: `touched` is every alive entity and the
   *  mirror replaces its whole list. */
  readonly rebuild: boolean;
  /** A fresh clone of every entity created or mutated since the base and still alive, ascending by id. */
  readonly touched: readonly EntitySnapshot[];
  /** Ids destroyed since the base, ascending; empty with `rebuild`. May name an entity that was
   *  created and destroyed inside the stretch, which the mirror never held. */
  readonly removed: readonly number[];
  /** The events of `tick`, as the snapshot carries them. */
  readonly events: readonly SimEvent[];
}

/** A cache entry: untouched entities reuse the whole entry; touched entities reuse every component
 *  whose per-entity revision still matches. */
interface CachedEntity {
  readonly snap: EntitySnapshot;
  readonly componentRevisions: Readonly<Record<string, number>>;
  dirty: boolean;
}

/** What one open stream has accumulated since its last delta. */
interface PendingDelta {
  /** Alive entities mutated since the base. */
  readonly touched: Set<Entity>;
  readonly removed: Set<Entity>;
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
    world.registerCacheVerifier('snapshotClones', () => this.verify());
  }

  /** Drain the touched log: mark the cache dirty and feed every open stream. An overflowed log lost its
   *  individual evictions, so the cache and the streams start over; a stream whose own backlog reaches
   *  the same bound (nobody took its deltas) starts over alone. */
  refresh(): void {
    const world = this.world;
    const overflowed = world.drainTouched((e) => {
      const alive = world.isAlive(e);
      const cached = this.entries.get(e);
      if (cached !== undefined) {
        if (alive) cached.dirty = true;
        else this.entries.delete(e);
      }
      for (const stream of this.streams) {
        if (stream.rebuild) continue; // the next delta carries every alive entity anyway
        if (alive) {
          stream.touched.add(e);
        } else {
          stream.touched.delete(e);
          stream.removed.add(e);
        }
      }
    });
    if (overflowed) this.entries.clear();
    for (const stream of this.streams) {
      if (stream.rebuild) continue;
      if (overflowed || stream.touched.size + stream.removed.size > TOUCHED_LOG_OVERFLOW_LIMIT) {
        stream.touched.clear();
        stream.removed.clear();
        stream.rebuild = true;
      }
    }
  }

  /** The clone of an alive entity, remade when a drained mutation marked it dirty. */
  snapOf(id: Entity): EntitySnapshot {
    let cached = this.entries.get(id);
    if (cached === undefined || cached.dirty) {
      cached = cloneEntity(this.world, id, cached);
      this.entries.set(id, cached);
    }
    return cached.snap;
  }

  /** Open a stream whose first delta rebuilds. */
  open(): PendingDelta {
    const pending: PendingDelta = { touched: new Set(), removed: new Set(), rebuild: true };
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
  const components: Record<string, unknown> = {};
  const componentRevisions: Record<string, number> = {};
  world.forEachComponent(id, (name, value, revision) => {
    components[name] =
      previous?.componentRevisions[name] === revision ? previous.snap.components[name] : clonePlain(value);
    componentRevisions[name] = revision;
  });
  return { snap: { id: id as number, components }, componentRevisions, dirty: false };
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

/**
 * The per-tick change feed one mirror rebuilds the snapshot from. Each stream accumulates on its own,
 * so two streams over one world each see every change; a stream nobody takes from is bounded by the
 * touched log's overflow limit, past which its next delta rebuilds. Close a stream its mirror outlives.
 */
export class SnapshotDeltaStream {
  private readonly clones: SnapshotClones;
  private readonly pending: PendingDelta;
  private lastTick = NO_TICK;
  private lastVersion = NO_TICK;

  constructor(private readonly source: SnapshotDeltaSource) {
    this.clones = snapshotClonesFor(source.world);
    this.pending = this.clones.open();
  }

  /**
   * The changes since the previous delta, or null while the tick and the world's mutation version still
   * hold. Taken once per stepped tick it is that tick's delta; taken later it spans the ticks between
   * and carries the last one's events.
   */
  next(): SnapshotDelta | null {
    const { world, tick } = this.source;
    const version = world.mutationVersion;
    if (tick === this.lastTick && version === this.lastVersion) return null;
    this.clones.refresh();
    const pending = this.pending;
    const delta: SnapshotDelta = {
      tick,
      baseTick: this.lastTick,
      rebuild: pending.rebuild,
      touched: (pending.rebuild ? world.canonicalEntities() : ascending(pending.touched)).map((id) =>
        this.clones.snapOf(id),
      ),
      removed: pending.rebuild ? [] : ascending(pending.removed),
      events: cloneEvents(this.source.events.current()),
    };
    pending.touched.clear();
    pending.removed.clear();
    pending.rebuild = false;
    this.lastTick = tick;
    this.lastVersion = version;
    return delta;
  }

  close(): void {
    this.clones.close(this.pending);
  }
}

function ascending(ids: ReadonlySet<Entity>): Entity[] {
  return [...ids].sort((a, b) => a - b);
}
