import type { ContentSet } from '@open-northland/data';
import type { SettlerIdentity } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { atomicClipName } from './animations.js';

/** Answers by good, per tribe and trade: nested so a lookup builds no key. */
type ByGood = Map<number, number | undefined>;
type ByTrade = Map<number | null, ByGood>;
type ByTribe = Map<number, ByTrade>;

const cache = new WeakMap<ContentSet, ByTribe>();

/** Prefer the good's declared atomic when bound. If the trade cannot bind it, use its unique allowed
 * `setatomic` clip ending in `_produce_<good id>`. This naming-based repair is an approximation of the
 * original lookup; the source has disagreements for iron tools and wooden spears. */
export function productionAtomic(
  content: ContentSet,
  settler: SettlerIdentity,
  goodType: number,
): number | undefined {
  let byTribe = cache.get(content);
  if (byTribe === undefined) {
    byTribe = new Map();
    cache.set(content, byTribe);
  }
  let byTrade = byTribe.get(settler.tribe);
  if (byTrade === undefined) {
    byTrade = new Map();
    byTribe.set(settler.tribe, byTrade);
  }
  let byGood = byTrade.get(settler.jobType);
  if (byGood === undefined) {
    byGood = new Map();
    byTrade.set(settler.jobType, byGood);
  }
  if (byGood.has(goodType)) return byGood.get(goodType);
  const atomic = resolveProductionAtomic(content, settler, goodType);
  byGood.set(goodType, atomic);
  return atomic;
}

function resolveProductionAtomic(
  content: ContentSet,
  settler: SettlerIdentity,
  goodType: number,
): number | undefined {
  const index = contentIndex(content);
  const good = index.goods.get(goodType);
  let atomic = good?.atomics.produce;
  if (good !== undefined && atomic !== undefined && atomicClipName(content, settler, atomic) === undefined) {
    const allowed = settler.jobType === null ? undefined : index.atomicsByJob.get(settler.jobType);
    const matches = [...(allowed ?? [])].filter((id) =>
      atomicClipName(content, settler, id)?.endsWith(`_produce_${good.id}`),
    );
    if (matches.length === 1) atomic = matches[0];
  }
  return atomic;
}
