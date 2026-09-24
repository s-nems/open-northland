import { Building, Position } from '../../../components/index.js';
import type { Component, Entity, World } from '../../../ecs/world.js';
import { BLOCKER_STORES, type BlockerStore, BUILDING_STORE } from './blockers.js';

// The shared journal replay behind the incremental blocker caches - ./blocker-grid.ts's dense count grid
// and ./work-flag/incremental-blocks.ts's sparse refcounted node set. Each supplies what it captures per
// entity and how it applies and withdraws that capture; what a replay has to get right lives here once.

/**
 * What one cache does with a blocker store's per-entity contribution. `capture` is the only op that may
 * read the world: `withdraw` replays after the entity may have been destroyed, so it works from the held
 * capture alone. A capture keeps duplicate cells, so a stamp and its withdrawal cancel exactly.
 */
export interface BlockerCaptureOps<Captured> {
  capture(world: World, store: BlockerStore, e: Entity): Captured;
  apply(captured: Captured): void;
  withdraw(captured: Captured): void;
}

/** One cache's replay against the blocker stores, over the world it was started on. */
export interface BlockerJournal {
  /** Catch the capture up to the live world; false demands a full rebuild (a journal gap). */
  catchUp(): boolean;
  /** Whether every guarded input still matches what the replay holds - the verifiers' "claims
   *  freshness" gate. */
  fresh(): boolean;
}

/**
 * Stamp every standing blocker into `ops`, and keep it caught up from the stores' membership journals, so
 * a late-game map where a resource appears or is gathered away every few ticks costs O(that footprint) per
 * change instead of the O(all blockers) re-stamp a version-keyed memo pays on the next query.
 *
 * Guarded inputs: each {@link BLOCKER_STORES} store's membership generation, replayed entity by entity,
 * plus the `Building` VALUE generation, since the tier swap changes a building's cells in place with no
 * membership bump. That value bump is ambiguous - construction progress moves it every active-site tick -
 * so it is narrowed through the value-write journal to the buildings whose `buildingType` actually
 * changed. A blocker's Position is NOT a guarded input: every spawn site adds it before the blocker
 * component, and a placed blocker never moves, so the cells a capture reads are fixed while the entity
 * holds the component. Each cache's registered `verifyCaches` verifier is the tripwire if any of that
 * stops holding.
 */
export function startBlockerJournal<Captured>(
  world: World,
  ops: BlockerCaptureOps<Captured>,
): BlockerJournal {
  /** Held membership generations of the journal-replayed stores. */
  const gens = new Map<Component<unknown>, number>();
  const records = new Map<BlockerStore, Map<Entity, Captured>>();
  /** The `buildingType` each held Building capture used - the only Building value a capture reads, so a
   *  value bump resyncs exactly the mismatches instead of demanding a full rebuild. */
  const buildingTypes = new Map<Entity, number>();
  world.journalValueWrites(Building);
  let buildingValueGen = world.componentValueGeneration(Building);

  const recordsOf = (store: BlockerStore): Map<Entity, Captured> => {
    let held = records.get(store);
    if (held === undefined) {
      held = new Map();
      records.set(store, held);
    }
    return held;
  };

  /** Replay one journal entry: withdraw the held capture, then re-capture from live state. Idempotent, so
   *  a same-entity op sequence (add + destroy, remove + re-add) converges on the final membership. The
   *  building type is recorded in the same step, so record and capture cannot drift. */
  const resync = (store: BlockerStore, e: Entity): void => {
    const byEntity = recordsOf(store);
    const held = byEntity.get(e);
    if (held !== undefined) {
      ops.withdraw(held);
      byEntity.delete(e);
    }
    if (store === BUILDING_STORE) {
      const b = world.tryGet(e, Building);
      if (b === undefined) buildingTypes.delete(e);
      else buildingTypes.set(e, b.buildingType);
    }
    if (!world.has(e, store.component)) return;
    const captured = ops.capture(world, store, e);
    byEntity.set(e, captured);
    ops.apply(captured);
  };

  /** The Building value-bump response: resync only the written buildings whose live type differs from
   *  the held record - zero captures when only construction progress (`built`) moved. A span the value
   *  journal no longer covers falls back to comparing every building. */
  const resyncChangedBuildingTypes = (): void => {
    const written = world.valueWritesSince(Building, buildingValueGen) ?? world.query(Building);
    for (const e of written) {
      const b = world.tryGet(e, Building);
      if (b === undefined || !world.has(e, Position) || buildingTypes.get(e) === b.buildingType) continue;
      resync(BUILDING_STORE, e);
    }
  };

  for (const store of BLOCKER_STORES) {
    world.journalMembership(store.component);
    gens.set(store.component, world.componentGeneration(store.component));
  }
  for (const store of BLOCKER_STORES) {
    for (const e of world.query(store.component, Position)) resync(store, e);
  }

  return {
    catchUp: () => {
      for (const store of BLOCKER_STORES) {
        const gen = world.componentGeneration(store.component);
        const held = gens.get(store.component) ?? 0;
        if (gen === held) continue;
        const deltas = world.membershipDeltasSince(store.component, held);
        if (deltas === null) return false;
        for (const e of deltas) resync(store, e);
        gens.set(store.component, gen);
      }
      const valueGen = world.componentValueGeneration(Building);
      if (valueGen !== buildingValueGen) {
        resyncChangedBuildingTypes();
        buildingValueGen = valueGen;
      }
      return true;
    },
    fresh: () =>
      world.componentValueGeneration(Building) === buildingValueGen &&
      BLOCKER_STORES.every((s) => world.componentGeneration(s.component) === (gens.get(s.component) ?? 0)),
  };
}
