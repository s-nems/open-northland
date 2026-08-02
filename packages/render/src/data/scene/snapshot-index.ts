import { type EntitySnapshot, entityById, type WorldSnapshot } from '@open-northland/sim';
import {
  readActingAtomic,
  readAtomicTargetEntity,
  readBuiltPct,
  readPosition,
  readProjectileTarget,
} from './snapshot-readers/index.js';

/**
 * The per-snapshot pre-scans the scene build reads before its per-entity loop: the enterable-store set
 * (which settlers are hidden mid-exchange), the target position index (to face a mid-swing actor / aim a
 * projectile), and the signposts the board prepass pairs up. All are pure functions of the frozen
 * snapshot and come out of ONE walk memoized on its object identity - the scene builds per frame while
 * the snapshot changes per tick, so the walk happens once per tick, not once per frame or once per
 * consumer. Plus the atomic-id contract that decides which actors face their target.
 */

/**
 * The atomic id of a combat attack swing - the original's `setatomic <job> 81 "..._attack"` (id 81 is
 * the attack slot across every fighting job; the sim's `ATTACK_ATOMIC_ID`, `systems/conflict/weapons.ts`).
 * A settler mid-attack has stopped moving, so it has no walk heading; it faces its target instead (the
 * attacker→target screen step). The same numeric contract as the sim, transcribed here (like
 * {@link TARGET_FACING_ATOMIC_IDS}) rather than imported - render reads the snapshot's plain ids, never sim code.
 */
const ATTACK_ATOMIC_ID = 81;

/** The builder hammer action (`setatomic 7 39`), whose extracted `[gfxanimatomic]` row carries eight
 *  directional frame lists. */
const BUILD_HOUSE_ATOMIC_ID = 39;

/** The per-good harvest atomic ids (`goodtypes.ini` `atomicForHarvesting`), transcribed by hand like
 *  {@link ATTACK_ATOMIC_ID} - the shared numeric contract, named so no bare id carries the meaning. */
const HARVEST_ATOMIC_IDS = {
  wood: 24,
  stone: 25,
  clay: 26,
  iron: 27,
  gold: 28,
  wheat: 29,
  mushroom: 32,
} as const;

/** The wedding kiss pair (`logicdefines.inc` KISS = 20 / KISSED = 21) - each half's atomic targets its
 *  partner, and the pair must face each other for the kiss to read. Transcribed like {@link ATTACK_ATOMIC_ID}. */
const KISS_ATOMIC_IDS = [20, 21] as const;

/** The gossip talk/listen pair (`logicdefines.inc` TALK = 14 / LISTEN = 15) - like the kiss, each half's
 *  atomic targets its partner and the pair turns to face each other for the chat to read. */
const CHAT_ATOMIC_IDS = [14, 15] as const;

/**
 * Every atomic whose runner faces its target while the swing plays: construction, combat attack, the
 * per-good harvest actions ({@link HARVEST_ATOMIC_IDS}), the wedding kiss pair ({@link KISS_ATOMIC_IDS}),
 * and the gossip talk/listen pair ({@link CHAT_ATOMIC_IDS}).
 * A harvester, like an attacker, has stopped walking (no walk heading), so without a target-derived
 * facing it kept its last walk heading (or the default SE) and swung its axe/pick into empty air beside
 * the node it works - a woodcutter standing east of a tree chopped further east. Facing the node it
 * targets is what the original does (`atomicanimations.ini` even carries `startdirection` pins for a
 * subset); the kissing couple likewise turn toward each other.
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

/** The shared empty index for a snapshot with no target-facing actor - memoized like a real index so a
 *  quiet scene allocates nothing and every frame reuses this one map. */
const EMPTY_POS_INDEX: ReadonlyMap<number, { x: number; y: number }> = new Map();

const NO_SIGNPOSTS: readonly EntitySnapshot[] = [];

/**
 * Completed buildings (built, not a construction site) - the "enterable store" set. A settler whose
 * running atomic exchanges goods with one of these (a pileup deposit / a pickup lift) is not drawn:
 * the original's carrier walks into the house and vanishes for the exchange (observed), so hiding it
 * for the atomic's duration reads as entering, instead of a deposit pantomimed at the door. A ground
 * pile / flag / construction site is not enterable - those exchanges keep their animation.
 */
export function enterableStoresOf(snapshot: WorldSnapshot): ReadonlySet<number> {
  return sceneIndexOf(snapshot).enterableStores;
}

/**
 * The `entity id → live Position` index used to face a mid-swing attacker/harvester at its target and to
 * aim an in-flight projectile - random access by id that `WorldSnapshot` carries no structure for.
 * Holds only the ids actually referenced as a target this tick, so a busy map's index stays a handful of
 * entries instead of every positioned entity - one settlement fighting must not re-index a whole map's
 * forests. A snapshot with no target-facing actor gets the shared empty index. Stores the snapshot's own
 * Position object (readPosition returns it, not a copy); the `/ONE` to tile space is deferred to the rare
 * facing lookups.
 */
export function targetPositionsOf(snapshot: WorldSnapshot): ReadonlyMap<number, { x: number; y: number }> {
  return sceneIndexOf(snapshot).targetPositions;
}

/** The snapshot's signpost entities, in its own ascending id order - the board prepass
 *  ({@link import('./signpost-boards.js')}) decodes and pairs them. */
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

/** Resolve the handful of targeted refs by id. `entityById` binary-searches, so this relies on the
 *  snapshot's ascending-id contract: a re-ordered entity list must never reach here. */
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
