import { type EntitySnapshot, entityById, type WorldSnapshot } from '@open-northland/sim';
import {
  readActingAtomic,
  readAtomicTargetEntity,
  readBuiltPct,
  readCraftPerformance,
  readPosition,
  readProjectileTarget,
  readStoreExchangeRef,
} from './snapshot-readers/index.js';

/**
 * The scene build's per-snapshot pre-scans, memoized on snapshot identity so they run once per tick
 * rather than once per frame. The atomic ids are transcribed rather than imported: render reads the
 * snapshot's plain ids, never sim code.
 */

/** A combat attack swing - the original's `setatomic <job> 81 "..._attack"`, the attack slot across
 *  every fighting job. */
const ATTACK_ATOMIC_ID = 81;

/** The builder hammer action (`setatomic 7 39`). */
const BUILD_HOUSE_ATOMIC_ID = 39;

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

/**
 * Every atomic whose runner faces its target while the swing plays; such a settler has stopped walking,
 * so without this it keeps its last walk heading and swings beside the node it works. Facing the target
 * is what the original does (`atomicanimations.ini` carries `startdirection` pins for a subset).
 */
export const TARGET_FACING_ATOMIC_IDS: ReadonlySet<number> = new Set([
  BUILD_HOUSE_ATOMIC_ID,
  ATTACK_ATOMIC_ID,
  ...Object.values(HARVEST_ATOMIC_IDS),
  ...KISS_ATOMIC_IDS,
  ...CHAT_ATOMIC_IDS,
]);

interface SceneIndex {
  readonly enterableStores: ReadonlySet<number>;
  readonly targetPositions: ReadonlyMap<number, { x: number; y: number }>;
  readonly signposts: readonly EntitySnapshot[];
}

const indexBySnapshot = new WeakMap<WorldSnapshot, SceneIndex>();

/** Shared empty index, so a snapshot with no target-facing actor allocates nothing. */
const EMPTY_POS_INDEX: ReadonlyMap<number, { x: number; y: number }> = new Map();

const NO_SIGNPOSTS: readonly EntitySnapshot[] = [];

/**
 * Completed buildings, the stores a settler can walk into. A settler exchanging goods with one is not
 * drawn: observed original, where the carrier vanishes into the house. A ground pile, flag or
 * construction site is not enterable, so those exchanges keep their animation.
 */
export function enterableStoresOf(snapshot: WorldSnapshot): ReadonlySet<number> {
  return sceneIndexOf(snapshot).enterableStores;
}

/**
 * Whether the scene hides this settler inside a building: a `Resting` marker in its workplace, or a
 * goods exchange against an enterable store. Shared so an overlay does not hang over an empty doorway
 * the scene drew nobody in.
 */
export function isIndoorSettler(
  snapshot: WorldSnapshot,
  components: Readonly<Record<string, unknown>>,
): boolean {
  if ('Resting' in components) return true;
  const store = readStoreExchangeRef(components);
  return store !== null && enterableStoresOf(snapshot).has(store);
}

/**
 * The `entity id → live Position` index a mid-swing actor faces by and a projectile aims at. Holds only
 * the ids referenced as a target this tick. Values are the snapshot's own Position objects, not copies,
 * still in raw `Fixed` units: the `/ONE` to tile space is deferred to the rare lookups.
 */
export function targetPositionsOf(snapshot: WorldSnapshot): ReadonlyMap<number, { x: number; y: number }> {
  return sceneIndexOf(snapshot).targetPositions;
}

/** The snapshot's signpost entities, in its own ascending id order. */
export function signpostsOf(snapshot: WorldSnapshot): readonly EntitySnapshot[] {
  return sceneIndexOf(snapshot).signposts;
}

function sceneIndexOf(snapshot: WorldSnapshot): SceneIndex {
  const cached = indexBySnapshot.get(snapshot);
  if (cached !== undefined) return cached;
  const enterableStores = new Set<number>();
  const wanted = new Set<number>();
  const signposts: EntitySnapshot[] = [];
  for (const entity of snapshot.entities) {
    const components = entity.components;
    if ('Building' in components && readBuiltPct(components) === undefined) {
      enterableStores.add(entity.id);
    }
    const acting = readActingAtomic(components);
    if (acting !== null && TARGET_FACING_ATOMIC_IDS.has(acting)) {
      const target = readAtomicTargetEntity(components);
      if (target !== null) wanted.add(target);
    }
    if ('Projectile' in components) {
      const target = readProjectileTarget(components);
      if (target !== null) wanted.add(target);
    }
    // A worker performing its craft is drawn against its workplace's own anchor, not its doorstep.
    const craft = readCraftPerformance(components);
    if (craft !== null) wanted.add(craft.workplace);
    if ('Signpost' in components) signposts.push(entity);
  }
  const index: SceneIndex = {
    enterableStores,
    targetPositions: positionsOfRefs(snapshot, wanted),
    signposts: signposts.length > 0 ? signposts : NO_SIGNPOSTS,
  };
  indexBySnapshot.set(snapshot, index);
  return index;
}

/** `entityById` binary-searches, so this relies on the snapshot's ascending-id contract: a re-ordered
 *  entity list must never reach here. */
function positionsOfRefs(
  snapshot: WorldSnapshot,
  refs: ReadonlySet<number>,
): ReadonlyMap<number, { x: number; y: number }> {
  if (refs.size === 0) return EMPTY_POS_INDEX;
  const byRef = new Map<number, { x: number; y: number }>();
  for (const ref of refs) {
    const found = entityById(snapshot, ref);
    if (found === undefined) continue;
    const p = readPosition(found.components);
    if (p !== null) byRef.set(ref, p);
  }
  return byRef;
}
