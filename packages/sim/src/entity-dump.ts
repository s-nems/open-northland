import type { ComponentChange } from './snapshot-diff.js';
import type { EntitySnapshot, WorldSnapshot } from './snapshot.js';

/**
 * `dumpEntity` / `traceEntity` — the **"dump an entity"** third of the time-travel / replay inspector
 * (ROADMAP "Cross-cutting DX": the overlay can "scrub ticks, diff state between two ticks, and dump an
 * entity"). `replay()` jumps to tick N and `HashTrace` finds tick N; `diffSnapshots()` shows what
 * changed across two ticks; this isolates ONE entity — its full component view at a tick, and its
 * timeline across a window — so "hash diverged at tick 432 → jump there → inspect entity 7" closes.
 *
 * Both are pure functions of plain {@link WorldSnapshot} values (no class instances, live `Map`s, or
 * `Entity` brands — see `snapshot.ts`), so they are render-agnostic and agent-self-verifiable headless,
 * exactly like `replay()`/`HashTrace`/`diffSnapshots()`; the human-eyed overlay consumes them rather
 * than re-walking the snapshot itself.
 *
 * ## Determinism / ordering
 *
 * A snapshot is already canonical: entities ascending by id, component names + Map entries sorted
 * (`snapshot.ts` `clonePlain`). `dumpEntity` returns the matched {@link EntitySnapshot} verbatim (its
 * components stay sorted); `traceEntity` walks the snapshot sequence in the order given (the caller's
 * ascending-tick window) and reuses `diffSnapshots`'s per-component comparison so an entity's
 * cross-tick deltas agree byte-for-byte with the full diff and with `hashState`.
 */

/**
 * One entity's state at a single tick: which tick the snapshot was taken at, and the entity's full
 * component map (the verbatim {@link EntitySnapshot} components — already in sorted-name order).
 */
export interface EntityDump {
  readonly tick: number;
  readonly id: number;
  /** The entity's components at that tick, componentName -> plain value (sorted-name order). */
  readonly components: Readonly<Record<string, unknown>>;
}

/**
 * One step of an entity's timeline across a snapshot window: the tick, whether the entity is alive at
 * it, and — when alive in BOTH this snapshot and the previous one — the per-component changes since the
 * previous step. A `spawned`/`despawned` flag marks the life-edges so the overlay can render birth/death
 * without diffing absence against an empty map.
 */
export interface EntityTraceStep {
  readonly tick: number;
  /** True when the entity is present in this snapshot. */
  readonly alive: boolean;
  /** The entity's components at this tick (only when {@link alive}); omitted when absent. */
  readonly components?: Readonly<Record<string, unknown>>;
  /** True on the first step the entity appears (absent in the previous step, present here). */
  readonly spawned?: boolean;
  /** True on the first step the entity vanishes (present in the previous step, absent here). */
  readonly despawned?: boolean;
  /**
   * Per-component changes vs. the PREVIOUS step, present only when the entity is alive in both this and
   * the previous snapshot (a normal survivor transition). Same shape + ordering as `diffSnapshots`'s
   * per-entity `changes`; empty when nothing changed.
   */
  readonly changes?: readonly ComponentChange[];
}

/** Binary-search a snapshot's ascending-id entity list for `id`; null when absent. */
function findEntity(snapshot: WorldSnapshot, id: number): EntitySnapshot | null {
  const entities = snapshot.entities;
  let lo = 0;
  let hi = entities.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = entities[mid] as EntitySnapshot;
    if (e.id === id) return e;
    if (e.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/**
 * The full component view of one entity at a single snapshot's tick, or `null` if that entity is not
 * alive at that tick. Pure: reads only the plain snapshot, allocates nothing it doesn't return. Uses a
 * binary search over the canonical ascending-id entity list, so it stays O(log n) on a large world
 * rather than scanning.
 */
export function dumpEntity(snapshot: WorldSnapshot, id: number): EntityDump | null {
  const entity = findEntity(snapshot, id);
  if (entity === null) return null;
  return { tick: snapshot.tick, id, components: entity.components };
}

/** Canonical equality over two already-sorted plain values (mirrors `snapshot-diff`/`hashState`). */
function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Per-component delta for one entity between two alive states (sorted-name order; empty when equal). */
function diffComponents(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): ComponentChange[] {
  const names = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const changes: ComponentChange[] = [];
  for (const name of [...names].sort()) {
    const inA = Object.hasOwn(before, name);
    const inB = Object.hasOwn(after, name);
    if (inA && !inB) changes.push({ name, kind: 'removed', before: before[name] });
    else if (!inA && inB) changes.push({ name, kind: 'added', after: after[name] });
    else if (!valuesEqual(before[name], after[name]))
      changes.push({ name, kind: 'changed', before: before[name], after: after[name] });
  }
  return changes;
}

/**
 * Trace ONE entity across a window of snapshots: for each snapshot (in the order given — the caller's
 * ascending-tick window) emit whether the entity is alive, its components when alive, the spawn/despawn
 * life-edge, and — on a survivor transition — its per-component changes vs. the previous step. The
 * overlay's "follow entity 7 from tick A to tick B" without re-running the whole world diff each frame.
 *
 * Pure: reads only the plain snapshots. The `changes` use the same comparison as `diffSnapshots`, so an
 * entity's per-tick delta here equals its slice of the full two-tick diff. A single-snapshot window
 * yields one step (alive or not) with no `changes` (nothing precedes it). Snapshots must be in tick
 * order; the result mirrors that order one-to-one.
 */
export function traceEntity(snapshots: readonly WorldSnapshot[], id: number): EntityTraceStep[] {
  const steps: EntityTraceStep[] = [];
  // `prev` is the previous step's entity (null = absent); `first` distinguishes the window's opening
  // step (no spawn/despawn edge against the void before the window) from a real life transition.
  let prev: EntitySnapshot | null = null;
  let first = true;
  for (const snapshot of snapshots) {
    const here = findEntity(snapshot, id);
    if (here !== null) {
      const components = here.components;
      // Alive in both -> survivor delta; appearing after an absent step (not the window's start) -> spawn.
      if (prev !== null)
        steps.push({
          tick: snapshot.tick,
          alive: true,
          components,
          changes: diffComponents(prev.components, components),
        });
      else if (first) steps.push({ tick: snapshot.tick, alive: true, components });
      else steps.push({ tick: snapshot.tick, alive: true, components, spawned: true });
    } else if (prev !== null) {
      // Present last step, absent now -> the death edge.
      steps.push({ tick: snapshot.tick, alive: false, despawned: true });
    } else {
      // Absent both (or absent at the window's start) -> a plain not-alive step, no edge.
      steps.push({ tick: snapshot.tick, alive: false });
    }
    prev = here;
    first = false;
  }
  return steps;
}
