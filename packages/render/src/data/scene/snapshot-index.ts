import {
  type EntitySnapshot,
  entitiesWith,
  entityById,
  indexesOf,
  listedWhere,
  type SnapshotIndexSpec,
  type WorldSnapshot,
} from '@open-northland/sim';
import { readSiegeShot, type SiegeShot } from './shot-flight.js';
import {
  readActingAtomic,
  readAtomicTargetEntity,
  readBuiltPct,
  readCraftPerformance,
  readPosition,
  readStoreExchangeRef,
} from './snapshot-readers/index.js';

/**
 * The scene build's snapshot-wide lookups, kept per change on the snapshot's indexes (`indexesOf`) so a
 * tick costs its changes rather than a walk. The atomic ids are transcribed rather than imported: render
 * reads the snapshot's plain ids, never sim code.
 */

/** A combat attack swing - the original's `setatomic <job> 81 "..._attack"`, the attack slot across
 *  every fighting job. */
const ATTACK_ATOMIC_ID = 81;

/** The builder hammer action (`setatomic 7 39`). */
const BUILD_HOUSE_ATOMIC_ID = 39;

/** The builder's wall action (`setatomic 7 42`), the same hammer clip aimed at a wall segment. */
const BUILD_WALL_ATOMIC_ID = 42;

/** The original's dedicated well-pump and hive-pickup actions. */
const UTILITY_DRAW_ATOMIC_IDS = [44, 45] as const;

/**
 * A goods exchange the settler performs outside the store: the well is pumped and the hive lifted from
 * the doorstep, so these stay in view while the generic pick-up at a house steps inside.
 */
const OUTDOOR_EXCHANGE_ATOMIC_IDS: ReadonlySet<number> = new Set(UTILITY_DRAW_ATOMIC_IDS);

/** The per-good harvest atomic ids (`goodtypes.ini` `atomicForHarvesting`). */
const HARVEST_ATOMIC_IDS = {
  wood: 24,
  stone: 25,
  clay: 26,
  iron: 27,
  gold: 28,
  wheat: 29,
  mushroom: 32,
} as const;

/** The wedding kiss pair (`logicdefines.inc` KISS = 20 / KISSED = 21); each half's atomic targets its
 *  partner. */
const KISS_ATOMIC_IDS = [20, 21] as const;

/** The gossip talk/listen pair (`logicdefines.inc` TALK = 14 / LISTEN = 15); each half's atomic targets
 *  its partner. */
const CHAT_ATOMIC_IDS = [14, 15] as const;

/** The fisher's cast, catch and failed-cast actions (`setatomic 22 36..38`) all play toward the water. */
const FISHING_ATOMIC_IDS = [36, 37, 38] as const;

/**
 * Every atomic whose runner faces its target while the swing plays; such a settler has stopped walking,
 * so without this it keeps its last walk heading and swings beside the node it works. Facing the target
 * is what the original does (`atomicanimations.ini` carries `startdirection` pins for a subset).
 */
export const TARGET_FACING_ATOMIC_IDS: ReadonlySet<number> = new Set([
  BUILD_HOUSE_ATOMIC_ID,
  BUILD_WALL_ATOMIC_ID,
  ...UTILITY_DRAW_ATOMIC_IDS,
  ATTACK_ATOMIC_ID,
  ...Object.values(HARVEST_ATOMIC_IDS),
  ...KISS_ATOMIC_IDS,
  ...CHAT_ATOMIC_IDS,
  ...FISHING_ATOMIC_IDS,
]);

function isEnterableStore(components: Readonly<Record<string, unknown>>): boolean {
  return 'Building' in components && readBuiltPct(components) === undefined;
}

const ENTERABLE_STORES: SnapshotIndexSpec<Set<number>> = {
  empty: () => new Set(),
  add: (ids, entity) => {
    if (isEnterableStore(entity.components)) ids.add(entity.id);
  },
  remove: (ids, entity) => {
    ids.delete(entity.id);
  },
  replace: (ids, previous, next) => {
    const was = previous.components;
    const is = next.components;
    if (was.Building === is.Building && was.Upgrading === is.Upgrading) return;
    if (isEnterableStore(is)) ids.add(next.id);
    else ids.delete(next.id);
  },
};

/** The target of an actor's target-facing atomic, or null. */
function facedTargetOf(components: Readonly<Record<string, unknown>>): number | null {
  const acting = readActingAtomic(components);
  if (acting === null || !TARGET_FACING_ATOMIC_IDS.has(acting)) return null;
  return readAtomicTargetEntity(components);
}

/** Add `step` to `id`'s reference count, dropping an id no actor references any more. */
function countTarget(counts: Map<number, number>, id: number | null, step: number): void {
  if (id === null) return;
  const left = (counts.get(id) ?? 0) + step;
  if (left > 0) counts.set(id, left);
  else counts.delete(id);
}

/** The workplace a worker performs its craft at: it is drawn against that building's own anchor, not
 *  its doorstep. */
function craftWorkplaceOf(components: Readonly<Record<string, unknown>>): number | null {
  return readCraftPerformance(components)?.workplace ?? null;
}

function countTargetsOf(counts: Map<number, number>, entity: EntitySnapshot, step: number): void {
  countTarget(counts, facedTargetOf(entity.components), step);
  countTarget(counts, craftWorkplaceOf(entity.components), step);
}

/** Move one reference from `before` to `after`, leaving the counts alone when the id is unchanged. */
function moveTarget(counts: Map<number, number>, before: number | null, after: number | null): void {
  if (before === after) return;
  countTarget(counts, before, -1);
  countTarget(counts, after, 1);
}

/** Each id some actor faces or crafts at, with how many actors reference it. The craft reference also
 *  needs the `AtomicClock`, but only its presence, and the sim adds and removes that clock together with
 *  `CurrentAtomic`, so an unchanged `CurrentAtomic` object leaves both references unchanged. */
const WANTED_TARGETS: SnapshotIndexSpec<Map<number, number>> = {
  empty: () => new Map(),
  add: (counts, entity) => countTargetsOf(counts, entity, 1),
  remove: (counts, entity) => countTargetsOf(counts, entity, -1),
  replace: (counts, previous, next) => {
    const was = previous.components;
    const is = next.components;
    if (was.CurrentAtomic === is.CurrentAtomic) return;
    moveTarget(counts, facedTargetOf(was), facedTargetOf(is));
    moveTarget(counts, craftWorkplaceOf(was), craftWorkplaceOf(is));
  },
};

const carriesPalisade = (entity: EntitySnapshot): boolean => 'Palisade' in entity.components;

const PALISADE_ENTRIES = listedWhere(carriesPalisade);

/** The palisades, and a copy of them dropped whenever a change touches one: `palisadeLayoutOf` keeps
 *  its layout while the list it gets is the same array, and the held list is edited in place. */
interface PalisadeList {
  readonly held: EntitySnapshot[];
  copy: readonly EntitySnapshot[] | null;
}

const PALISADES: SnapshotIndexSpec<PalisadeList> = {
  empty: () => ({ held: PALISADE_ENTRIES.empty(), copy: null }),
  add: (list, entity) => {
    if (!carriesPalisade(entity)) return;
    PALISADE_ENTRIES.add(list.held, entity);
    list.copy = null;
  },
  remove: (list, entity) => {
    if (!carriesPalisade(entity)) return;
    PALISADE_ENTRIES.remove(list.held, entity);
    list.copy = null;
  },
};

const positionsBySnapshot = new WeakMap<WorldSnapshot, ReadonlyMap<number, { x: number; y: number }>>();

const shotsBySnapshot = new WeakMap<WorldSnapshot, readonly SiegeShot[]>();

/** Shared empty index, so a snapshot with no target-facing actor allocates nothing. */
const EMPTY_POS_INDEX: ReadonlyMap<number, { x: number; y: number }> = new Map();

const NO_ENTITIES: readonly EntitySnapshot[] = [];

const NO_SHOTS: readonly SiegeShot[] = [];

/**
 * Completed buildings, the stores a settler can walk into. A settler exchanging goods with one is not
 * drawn: observed original, where the carrier vanishes into the house. A ground pile, flag or
 * construction site is not enterable, so those exchanges keep their animation. A mirror edits the set in
 * place as it advances, so read it within the frame.
 */
export function enterableStoresOf(snapshot: WorldSnapshot): ReadonlySet<number> {
  return indexesOf(snapshot).get(ENTERABLE_STORES);
}

/**
 * The building the scene hides this settler inside, or null: the `Resting` marker's building, or an
 * enterable store the settler exchanges goods with through the generic pick-up rather than the store's
 * own outdoor action. Shared so an overlay does not hang over an empty doorway the scene drew nobody
 * in, and so the portrait can frame the building instead.
 */
export function indoorHouseOf(
  snapshot: WorldSnapshot,
  components: Readonly<Record<string, unknown>>,
): number | null {
  const resting = (components.Resting as { at?: unknown } | undefined)?.at;
  if (typeof resting === 'number') return resting;
  if ('Resting' in components) return null; // the marker without a readable building: indoors, unframed
  const store = readStoreExchangeRef(components);
  if (store === null || !enterableStoresOf(snapshot).has(store)) return null;
  const acting = readActingAtomic(components);
  return acting === null || !OUTDOOR_EXCHANGE_ATOMIC_IDS.has(acting) ? store : null;
}

export function isIndoorSettler(
  snapshot: WorldSnapshot,
  components: Readonly<Record<string, unknown>>,
): boolean {
  return 'Resting' in components || indoorHouseOf(snapshot, components) !== null;
}

/**
 * The `entity id → live Position` index a mid-swing actor faces by and a projectile aims at. Holds only
 * the ids referenced as a target this tick. Values are the snapshot's own Position objects, not copies,
 * still in raw `Fixed` units: the `/ONE` to tile space is deferred to the rare lookups.
 */
export function targetPositionsOf(snapshot: WorldSnapshot): ReadonlyMap<number, { x: number; y: number }> {
  let positions = positionsBySnapshot.get(snapshot);
  if (positions === undefined) {
    positions = positionsOfRefs(snapshot, indexesOf(snapshot).get(WANTED_TARGETS));
    positionsBySnapshot.set(snapshot, positions);
  }
  return positions;
}

/** The snapshot's signpost entities, ascending by id. A mirror edits the list in place as it advances,
 *  so read it within the frame. */
export function signpostsOf(snapshot: WorldSnapshot): readonly EntitySnapshot[] {
  return entitiesWith(snapshot, 'Signpost');
}

/** The snapshot's walls, gates and wall sites, ascending by id: the same array for as long as no change
 *  touches one. */
export function palisadesOf(snapshot: WorldSnapshot): readonly EntitySnapshot[] {
  const list = indexesOf(snapshot).get(PALISADES);
  list.copy ??= list.held.length > 0 ? list.held.slice() : NO_ENTITIES;
  return list.copy;
}

/** The snapshot's siege shots in flight, ascending by id. */
export function siegeShotsOf(snapshot: WorldSnapshot): readonly SiegeShot[] {
  const cached = shotsBySnapshot.get(snapshot);
  if (cached !== undefined) return cached;
  let shots: SiegeShot[] | undefined;
  for (const entity of entitiesWith(snapshot, 'Projectile')) {
    const shot = readSiegeShot(entity.id, entity.components);
    if (shot !== null) {
      shots ??= [];
      shots.push(shot);
    }
  }
  const result = shots ?? NO_SHOTS;
  shotsBySnapshot.set(snapshot, result);
  return result;
}

/** `entityById` binary-searches, so this relies on the snapshot's ascending-id contract: a re-ordered
 *  entity list must never reach here. */
function positionsOfRefs(
  snapshot: WorldSnapshot,
  refs: ReadonlyMap<number, number>,
): ReadonlyMap<number, { x: number; y: number }> {
  if (refs.size === 0) return EMPTY_POS_INDEX;
  const byRef = new Map<number, { x: number; y: number }>();
  for (const ref of refs.keys()) {
    const found = entityById(snapshot, ref);
    if (found === undefined) continue;
    const p = readPosition(found.components);
    if (p !== null) byRef.set(ref, p);
  }
  return byRef;
}
