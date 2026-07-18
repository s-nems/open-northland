import { Position } from '../components/index.js';
import type { Component, Entity, World } from '../ecs/world.js';
import { nodeOfPosition } from '../nav/halfcell.js';
import { canonicalById } from './spatial.js';

/**
 * The shared scaffold of the per-world generation-keyed spatial index memos (the region indexes, the
 * stockpile node buckets, the resource tile map). One state per `(memo, World)`, keyed on the indexed
 * component's store generation and caught up incrementally by replaying the World's membership journal —
 * so one sown field or felled tree costs O(changed entities), not a full rebuild of a ~17k-member index
 * mid-dispatch (the wholesale rebuild measurably lost to the plain store scan it replaced when reads
 * interleave with creates). A full rebuild stays the fallback whenever the journal cannot cover the span.
 *
 * Derived read-state, never hashed. Correctness rests on the invariant every rider documents: an indexed
 * entity's Position never changes while the component is held, so only add/remove/destroy — all journaled —
 * can change the index. The registered verifier re-derives the whole state under `verifyCaches()`, so a
 * violation or a missed delta surfaces at the tick it happens instead of as a distant golden divergence.
 */

/**
 * One memo's payload operations. `insert` must keep every bucket ascending-id (ids are monotonic, so an
 * insert is usually an append; a re-added old id must still land sorted) — that is what keeps every
 * first-match/min-id pick byte-identical to a full canonical scan. A full rebuild runs through the same
 * `empty` + `insert` path as the incremental catch-up, so the two cannot drift.
 */
export interface SpatialMemoPayload<S, M> {
  /** A fresh empty payload — the rebuild starting point. */
  empty(world: World): S;
  /** Capture the member record for `e` at its anchor node. This is the only op that may read the world:
   *  `remove` replays after the entity may have been destroyed, so it works from this record alone. */
  member(world: World, e: Entity, hx: number, hy: number): M;
  insert(state: S, e: Entity, m: M): void;
  remove(state: S, e: Entity, m: M): void;
  /** Full divergence messages comparing the held payload against a fresh rebuild — the payload-specific
   *  leg of the verifier (membership itself is compared by the scaffold). */
  diverges(held: S, fresh: S): string[];
}

/** Diagnostic labels for the scaffold's membership divergence messages. `verifier` must be the unique
 *  {@link World.registerCacheVerifier} id. */
export interface SpatialMemoLabels {
  readonly verifier: string;
  readonly plural: string;
  readonly component: string;
}

interface MemoState<S, M> {
  generation: number;
  /** Member records by entity — the removal side's data source and the verifier's membership ledger. */
  members: Map<Entity, M>;
  payload: S;
}

export interface SpatialMemo<S> {
  /** The up-to-date payload for `world` — journal-replayed when possible, rebuilt otherwise. */
  read(world: World): S;
}

/** Build a memoized spatial index over the entities carrying `component` and a {@link Position} — see the
 *  module doc for the invalidation model. */
export function createSpatialMemo<S, M>(
  component: Component<unknown>,
  labels: SpatialMemoLabels,
  payload: SpatialMemoPayload<S, M>,
): SpatialMemo<S> {
  const cache = new WeakMap<World, MemoState<S, M>>();

  const admit = (world: World, state: MemoState<S, M>, e: Entity): void => {
    const p = world.tryGet(e, Position);
    if (p === undefined) return; // Position-less: unindexable, exactly as the query-driven build skips it
    const n = nodeOfPosition(p.x, p.y);
    const m = payload.member(world, e, n.hx, n.hy);
    payload.insert(state.payload, e, m);
    state.members.set(e, m);
  };

  /** Replay one journal entry: drop any held record, then re-admit from live state. Idempotent, so a
   *  same-entity op sequence (add + destroy, remove + re-add) converges on the final membership. */
  const resync = (world: World, state: MemoState<S, M>, e: Entity): void => {
    const held = state.members.get(e);
    if (held !== undefined) {
      payload.remove(state.payload, e, held);
      state.members.delete(e);
    }
    if (world.has(e, component)) admit(world, state, e);
  };

  const build = (world: World): MemoState<S, M> => {
    world.journalMembership(component);
    const state: MemoState<S, M> = {
      generation: world.componentGeneration(component),
      members: new Map(),
      payload: payload.empty(world),
    };
    for (const e of canonicalById(world.query(component, Position))) admit(world, state, e);
    return state;
  };

  const verify = (world: World): string[] => {
    const cached = cache.get(world);
    if (cached === undefined || cached.generation !== world.componentGeneration(component)) return [];
    const fresh = build(world);
    if (fresh.members.size !== cached.members.size) {
      return [
        `${labels.verifier} holds ${cached.members.size} ${labels.plural} but re-derived ${fresh.members.size} — a ${labels.component}/Position changed without a ${labels.component}-store generation bump`,
      ];
    }
    for (const e of fresh.members.keys()) {
      if (!cached.members.has(e)) {
        return [
          `${labels.verifier} is missing entity ${e} — ${labels.component} membership changed without a store generation bump`,
        ];
      }
    }
    return payload.diverges(cached.payload, fresh.payload);
  };

  return {
    read: (world: World): S => {
      const generation = world.componentGeneration(component);
      let state = cache.get(world);
      if (state === undefined) {
        state = build(world);
        cache.set(world, state);
        world.registerCacheVerifier(labels.verifier, () => verify(world));
        return state.payload;
      }
      if (state.generation !== generation) {
        const deltas = world.membershipDeltasSince(component, state.generation);
        if (deltas === null) {
          state = build(world);
          cache.set(world, state);
        } else {
          for (const e of deltas) resync(world, state, e);
          state.generation = generation;
        }
      }
      return state.payload;
    },
  };
}
