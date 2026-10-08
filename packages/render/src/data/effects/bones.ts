import {
  type EntitySnapshot,
  indexesOf,
  type SnapshotIndexSpec,
  TICKS_PER_SECOND,
  type TileBox,
  TileBuckets,
  type WorldSnapshot,
} from '@open-northland/sim';
import { heldFadeAlpha } from './fade.js';

/** One saved bone pile off the snapshot's `BonePile` component: its half-cell node and the tick it fell. */
export interface BonePileMark {
  readonly id: number;
  readonly hx: number;
  readonly hy: number;
  readonly tick: number;
}

const BONES_LIFETIME_SECONDS = 300;
/**
 * How long a bone pile lies before it has faded out, in sim ticks, when bones fade: five minutes of game
 * time, three times a blood stain's. Approximation: the original's `cadaver_skeleton` decays after a
 * readable param of 100 (`landscapetypes.ini` transition 13) in an unreadable unit.
 */
export const BONES_LIFETIME_TICKS = BONES_LIFETIME_SECONDS * TICKS_PER_SECOND;
/** The fraction of that lifetime a pile lies whole before it starts to fade, slowly, over the rest. */
const BONES_FADE_HOLD = 1 / 3;

/** A pile's opacity `age` ticks after it fell: whole, then fading out over its lifetime when `fades`;
 *  whole for good otherwise. */
export function boneAlpha(age: number, fades: boolean): number {
  return fades ? heldFadeAlpha(age, BONES_LIFETIME_TICKS, BONES_FADE_HOLD) : 1;
}

/** The pile `entity` carries, or `null` for any other entity. */
export function bonePileOf(entity: EntitySnapshot): BonePileMark | null {
  const pile = entity.components.BonePile;
  if (typeof pile !== 'object' || pile === null) return null;
  const { hx, hy, tick } = pile as { hx?: unknown; hy?: unknown; tick?: unknown };
  if (typeof hx !== 'number' || typeof hy !== 'number' || typeof tick !== 'number') return null;
  return { id: entity.id, hx, hy, tick };
}

/** Every bone-pile entity bucketed by its node, in tile units: a node's column is half its `hx` up to
 *  the row stagger, its row half its `hy`, and the box query's slack covers the difference. A pile never
 *  changes, so only gaining or losing one counts. */
const BONE_PILES: SnapshotIndexSpec<TileBuckets<EntitySnapshot>> = {
  name: 'bone piles',
  reads: { values: ['BonePile'] },
  empty: () => new TileBuckets(),
  differs: (held, fresh) => held.differenceFrom(fresh),
  add: (buckets, entity) => {
    const pile = bonePileOf(entity);
    if (pile !== null) buckets.set(entity.id, entity, pile.hx / 2, pile.hy / 2);
  },
  remove: (buckets, entity) => {
    buckets.delete(entity.id);
  },
  swapAll: (buckets, nexts) => {
    for (const next of nexts) {
      const pile = bonePileOf(next);
      if (pile !== null) buckets.move(next.id, next, pile.hx / 2, pile.hy / 2);
    }
  },
};

/** The bone-pile entities that may lie inside `box` (tile units), written over `out` from index 0;
 *  returns the count. */
export function collectBonePiles(snapshot: WorldSnapshot, box: TileBox, out: EntitySnapshot[]): number {
  return indexesOf(snapshot).get(BONE_PILES).collect(box, out);
}
