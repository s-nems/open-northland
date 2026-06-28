import type { SimEvent } from './core/events.js';
import type { World } from './ecs/world.js';

/**
 * A read-only snapshot of the world at a tick boundary — the seam `render`/audio read instead of
 * the live component stores. Taken AFTER a `step()` completes (never mid-mutation), it is a plain,
 * structurally-cloned value: no class instances, no live `Map`s, no `Entity` brands — every
 * component value is JSON-ish data. That has two payoffs the roadmap calls for:
 *
 *  1. **Render never reads mid-mutation.** `render` consumes a frozen snapshot + the tick's events,
 *     so a system writing a component store can't be observed half-applied. (The double-buffer
 *     alternative would keep two live worlds; a cloned snapshot is simpler and, because it's plain,
 *     also gives us...)
 *  2. **Transferable for free.** A plain structure with no class instances / live Maps can be
 *     `postMessage`d to a render thread (the "run the sim in a Web Worker" cross-cutting win) without
 *     a serialization retrofit later.
 *
 * It is NOT the save format — that is the command log (replay-from-seed). This is a per-frame view.
 * Determinism is unaffected: a snapshot is a pure function of the world, never read back into sim
 * logic (it's read-only, and the events are the existing one-shot buffer, not a callback seam).
 */
export interface WorldSnapshot {
  readonly tick: number;
  /** One entity per alive id, in canonical (ascending) order. */
  readonly entities: readonly EntitySnapshot[];
  /** The one-shot events produced during the tick this snapshot was taken after. */
  readonly events: readonly SimEvent[];
}

export interface EntitySnapshot {
  readonly id: number;
  /** componentName -> a plain-cloned copy of its value (Maps become `[key, value]` arrays). */
  readonly components: Readonly<Record<string, unknown>>;
}

/**
 * Capture an immutable snapshot of the world (+ the tick's events) at a tick boundary. Entities are
 * emitted in canonical ascending-id order; component values are deep-cloned to plain data so the
 * snapshot can't alias (and so a consumer mutating it can't reach the live store). A `Map` value is
 * converted to a sorted `[key, value]` array — the same canonical ordering `hashState` uses — so the
 * snapshot stays plain (transferable) and deterministic.
 */
export function takeSnapshot(world: World, tick: number, events: readonly SimEvent[]): WorldSnapshot {
  const entities: EntitySnapshot[] = [];
  for (const id of world.canonicalEntities()) {
    const components: Record<string, unknown> = {};
    for (const [name, value] of world.componentEntries(id)) {
      components[name] = clonePlain(value);
    }
    entities.push({ id: id as number, components });
  }
  return { tick, entities, events: events.map(clonePlain) as readonly SimEvent[] };
}

/** Deep-clone a value to plain data: Maps -> sorted [k,v] arrays, arrays/objects recursed, scalars as-is. */
function clonePlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Map) {
    const entries = [...value.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return entries.map(([k, v]) => [k, clonePlain(v)]) as unknown as T;
  }
  if (Array.isArray(value)) return value.map(clonePlain) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as object).sort()) {
    out[k] = clonePlain((value as Record<string, unknown>)[k]);
  }
  return out as T;
}
