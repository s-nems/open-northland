import type { LifeHeart } from '@open-northland/render';
// The Pixi-free entry: the root barrel would drag Pixi into headless callers.
import { isIndoorSettler, ONE } from '@open-northland/render/data';
import {
  bucketsReach,
  type EntitySnapshot,
  entityById,
  indexesOf,
  type SnapshotIndexSpec,
  type TileBox,
  TileBuckets,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  healthOf,
  isSettler,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
  settlerTribeOf,
} from '../../game/snapshot.js';

/** Reused output of the box query; the slots past a query's count hold earlier frames' bodies. */
const boxed: SnapshotEntity[] = [];

/** What the projection resolves outside the snapshot. */
export interface LifeHeartInputs {
  readonly isLivestockTribe: (tribe: number) => boolean;
  /** Owner slot to swatch slot; absent = identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
  readonly selected?: ReadonlySet<number> | undefined;
  /** The seat whose selected people show their heart; null or absent for a spectator. */
  readonly viewer?: number | null | undefined;
}

/**
 * One heart per unit in its owner's colour slot, filled to its remaining life fraction, ascending by id. Only units
 * standing in `box` are read; no box reads the whole map. Source basis: the permanent heart over claimed
 * stock is observed in the original. Original behavior (reading, unconfirmed against the running
 * original): a person wears it only while his own player has him selected, however wounded.
 */
export function computeLifeHearts(
  snapshot: WorldSnapshot,
  inputs: LifeHeartInputs,
  box?: TileBox,
): LifeHeart[] {
  const out: LifeHeart[] = [];
  const candidates = box === undefined ? snapshot.entities : boxed;
  const count = box === undefined ? candidates.length : collectCandidates(snapshot, box, inputs);
  for (let i = 0; i < count; i++) {
    const e = candidates[i] as SnapshotEntity;
    if (!isSettler(e)) continue;
    const player = ownerPlayerOf(e);
    if (player === undefined) continue; // wild - no faction, no heart
    const tribe = settlerTribeOf(e);
    if (tribe === undefined) continue;
    const life = lifeFractionOf(e);
    if (!wearsHeart(e.id, player, tribe, inputs)) continue;
    // The scene draws nobody indoors to hang the heart over.
    if (isIndoorSettler(snapshot, e.components)) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const colourSlot = inputs.playerColourOf?.(player) ?? player;
    out.push({ id: e.id, x: pos.x, y: pos.y, colourSlot, life });
  }
  return box === undefined ? out : out.sort((a, b) => a.id - b.id);
}

/** The units in `box`'s position buckets that may wear a heart, written over {@link boxed}: the indexed
 *  animals, then the selected ones the index does not hold. Returns the count. */
function collectCandidates(snapshot: WorldSnapshot, box: TileBox, inputs: LifeHeartInputs): number {
  const wearers = indexesOf(snapshot).get(UNASKED_WEARERS);
  let count = wearers.collect(box, boxed);
  for (const id of inputs.selected ?? []) {
    if (wearers.has(id)) continue;
    const e = entityById(snapshot, id);
    const pos = e === undefined ? undefined : positionOf(e);
    if (e !== undefined && pos !== undefined && bucketsReach(box, pos.x / ONE, pos.y / ONE))
      boxed[count++] = e;
  }
  return count;
}

/** The owned units that may wear a heart whatever the selection, bucketed by `Position`: every owned
 *  animal (the stock test is content's, so the reader applies it). A walker's step lands in `swapAll`,
 *  which re-buckets a held unit with its new object. */
const UNASKED_WEARERS: SnapshotIndexSpec<TileBuckets<EntitySnapshot>> = {
  name: 'heart wearers',
  reads: { values: ['Settler', 'Owner', 'Health'], presence: ['Person', 'Position'] },
  empty: () => new TileBuckets(),
  differs: (held, fresh) => held.differenceFrom(fresh),
  add: placeWearer,
  remove: (buckets, e) => {
    buckets.delete(e.id);
  },
  replace: (buckets, _previous, next) => placeWearer(buckets, next),
  swapAll: (buckets, nexts) => {
    for (const next of nexts) {
      if (!buckets.has(next.id)) continue; // most touched entities are ones this index never holds
      const pos = positionOf(next);
      if (pos !== undefined) buckets.move(next.id, next, pos.x / ONE, pos.y / ONE);
    }
  },
};

function placeWearer(buckets: TileBuckets<EntitySnapshot>, e: EntitySnapshot): void {
  const pos = positionOf(e);
  if (pos !== undefined && mayWearUnasked(e)) buckets.set(e.id, e, pos.x / ONE, pos.y / ONE);
  else buckets.delete(e.id);
}

function mayWearUnasked(e: SnapshotEntity): boolean {
  if (!isSettler(e) || ownerPlayerOf(e) === undefined || settlerTribeOf(e) === undefined) return false;
  return e.components.Person === undefined;
}

/** Claimed stock always; a person only while his own player has him selected. */
function wearsHeart(id: number, player: number, tribe: number, inputs: LifeHeartInputs): boolean {
  if (inputs.isLivestockTribe(tribe)) return true;
  return inputs.selected?.has(id) === true && inputs.viewer != null && player === inputs.viewer;
}

/** The unit's `Health` as a `[0, 1]` fill level; a missing or empty pool projects as full. */
function lifeFractionOf(e: SnapshotEntity): number {
  const health = healthOf(e);
  if (health === undefined || health.max <= 0) return 1;
  return Math.max(0, Math.min(1, health.hitpoints / health.max));
}
