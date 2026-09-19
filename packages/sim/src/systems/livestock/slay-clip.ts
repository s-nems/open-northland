import type { SettlerIdentity } from '../../components/index.js';
import type { ContentContext } from '../context.js';
import {
  ATOMIC_EVENT_TYPE_PUT_GOOD_IN_STOCK,
  atomicAnimationByName,
  atomicClipName,
  clipFrameAt,
} from '../readviews/animations.js';
import { slayAtomicOfSpecies } from '../readviews/index.js';

// What a slaughter yields is the clip's own data: `atomicanimations.ini` gives the breeder's slay
// animation an `event <frame> 27 <good>` per unit (`logicdefines.inc`
// ATOMIC_ANIMATION_EVENT_TYPE_PUT_GOOD_IN_STOCK), which is how the sheep clip lands 1 wool + 2 meat and
// the cattle one 2 leather + 2 meat. Approximation: the the original scales each deposit by the worker's
// job efficiency, which is not applied here.

/** The goods `settler`'s slaughter clip for `speciesGood` puts in the house, distinct, in clip order. */
export function slayDepositGoods(
  ctx: ContentContext,
  settler: SettlerIdentity,
  speciesGood: number,
): readonly number[] {
  const atomicId = slayAtomicOfSpecies(ctx.content, speciesGood);
  if (atomicId === null) return [];
  const goods: number[] = [];
  for (const good of stockEventGoods(ctx, settler, atomicId)) {
    if (!goods.includes(good)) goods.push(good);
  }
  return goods;
}

/** The goods `settler`'s running clip puts in the house at the frame `elapsed` ticks in - one entry per
 *  unit, so a clip depositing two of a good lands both. */
export function stockDepositsAt(
  ctx: ContentContext,
  settler: SettlerIdentity,
  atomicId: number,
  elapsed: number,
): readonly number[] {
  const animation = clipOf(ctx, settler, atomicId);
  if (animation === undefined) return [];
  const frame = clipFrameAt(elapsed, animation.length);
  const goods: number[] = [];
  for (const event of animation.events) {
    if (event.type !== ATOMIC_EVENT_TYPE_PUT_GOOD_IN_STOCK || event.at !== frame) continue;
    if (event.value !== undefined) goods.push(event.value);
  }
  return goods;
}

function* stockEventGoods(
  ctx: ContentContext,
  settler: SettlerIdentity,
  atomicId: number,
): IterableIterator<number> {
  for (const event of clipOf(ctx, settler, atomicId)?.events ?? []) {
    if (event.type === ATOMIC_EVENT_TYPE_PUT_GOOD_IN_STOCK && event.value !== undefined) yield event.value;
  }
}

function clipOf(ctx: ContentContext, settler: SettlerIdentity, atomicId: number) {
  const name = atomicClipName(ctx.content, settler, atomicId);
  return name === undefined ? undefined : atomicAnimationByName(ctx.content, name);
}
