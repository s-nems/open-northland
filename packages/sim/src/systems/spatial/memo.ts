import { Position } from '../../components/index.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';

/**
 * The shared scaffold of the per-world generation-keyed spatial index memos. One state per
 * `(memo, World)`, keyed on the indexed component's store generation and caught up by replaying the
 * World's membership journal, so one sown field or felled tree costs O(changed entities). A full rebuild
 * is the fallback whenever the journal cannot cover the span.
 *
 * Derived read-state, never hashed. Correctness rests on the invariant every rider documents: an indexed
 * entity's Position never changes while the component is held, so only journaled membership changes can
 * change the index. The registered verifier re-derives the whole state under `verifyCaches()`, so a
 * violation surfaces at the tick it happens rather than as a distant golden divergence.
 */

/**
 * One memo's payload operations. `insert` must keep every bucket ascending-id, which is what keeps a
 * first-match or min-id pick byte-identical to a full canonical scan. A rebuild runs the same `empty` and
 * `insert` path as the incremental catch-up, so the two cannot drift.
 */
export interface SpatialMemoPayload<S, M> {
  /** A fresh empty payload - the rebuild starting point. */
  empty(world: World): S;
  /** Capture the member record for `e` at its anchor node. This is the only op that may read the world:
   *  `remove` replays after the entity may have been destroyed, so it works from this record alone. */
  member(world: World, e: Entity, hx: number, hy: number): M;
  insert(state: S, e: Entity, m: M): void;
  remove(state: S, e: Entity, m: M): void;
  /** The verifier's payload-specific leg; the scaffold compares membership itself. */
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
  /** Member records by entity: the removal side's data source and the verifier's membership ledger. */
  members: Map<Entity, M>;
  payload: S;
}

export interface SpatialMemo<S> {
  /** The up-to-date payload for `world`, journal-replayed when possible and rebuilt otherwise. */
  read(world: World): S;
}

/** Build a memoized spatial index over the entities carrying `component` and a {@link Position}. */
export function createSpatialMemo<S, M>(
  component: Component<unknown>,
  labels: SpatialMemoLabels,
  payload: SpatialMemoPayload<S, M>,
): SpatialMemo<S> {
  const cache = new WeakMap<World, MemoState<S, M>>();

  const admit = (world: World, state: MemoState<S, M>, e: Entity): void => {
    const p = world.tryGet(e, Position);
    if (p === undefined) return; // unindexable, exactly as the query-driven build skips it
    const m = payload.member(world, e, nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
    payload.insert(state.payload, e, m);
    state.members.set(e, m);
  };

  /** Replay one journal entry: drop any held record, then re-admit from live state. Idempotent, so a
   *  run of ops on one entity converges on its final membership. */
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
    for (const e of world.canonicalQuery(component, Position)) admit(world, state, e);
    return state;
  };

  const verify = (world: World): string[] => {
    const cached = cache.get(world);
    if (cached === undefined || cached.generation !== world.componentGeneration(component)) return [];
    const fresh = build(world);
    if (fresh.members.size !== cached.members.size) {
      return [
        `${labels.verifier} holds ${cached.members.size} ${labels.plural} but re-derived ${fresh.members.size} - a ${labels.component}/Position changed without a ${labels.component}-store generation bump`,
      ];
    }
    for (const e of fresh.members.keys()) {
      if (!cached.members.has(e)) {
        return [
          `${labels.verifier} is missing entity ${e} - ${labels.component} membership changed without a store generation bump`,
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
