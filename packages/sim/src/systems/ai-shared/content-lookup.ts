import type { BuildingType, ContentSet, GoodType } from '@open-northland/data';
import { type ContentIndex, contentIndex } from '../../core/content-index.js';

/** The building definition carrying the stable content id, or undefined when this content set lacks
 *  it - a module skips such an entry instead of failing. */
export function buildingTypeByContentId(content: ContentSet, id: string): BuildingType | undefined {
  const index = contentIndex(content);
  const typeId = index.buildingTypeBySlug.get(id);
  return typeId === undefined ? undefined : index.buildings.get(typeId);
}

/** The good definition carrying the stable content id, or undefined (same skip contract as
 *  {@link buildingTypeByContentId}). */
export function goodTypeByContentId(content: ContentSet, id: string): GoodType | undefined {
  const index = contentIndex(content);
  const typeId = index.goodTypeBySlug.get(id);
  return typeId === undefined ? undefined : index.goods.get(typeId);
}

/** Per content index: each building type's {@link tiersAtOrAbove} chain, and each `(type, belowTier)`
 *  pair's {@link countedTiers}. Content-only, so a chain is derived once per content set. */
interface TierMemo {
  readonly above: Map<number, ReadonlySet<number>>;
  readonly counted: Map<number, Map<string | undefined, ReadonlySet<number>>>;
}

const tierMemos = new WeakMap<ContentIndex, TierMemo>();

function tierMemoOf(index: ContentIndex): TierMemo {
  let memo = tierMemos.get(index);
  if (memo === undefined) {
    memo = { above: new Map(), counted: new Map() };
    tierMemos.set(index, memo);
  }
  return memo;
}

/** The typeIds at or above `target` on its `upgradeTarget` chain: `target` itself plus everything it
 *  upgrades into. The visited guard bounds a malformed cyclic chain. The shared memoized set. */
export function tiersAtOrAbove(index: ContentIndex, target: BuildingType): ReadonlySet<number> {
  const memo = tierMemoOf(index);
  const held = memo.above.get(target.typeId);
  if (held !== undefined) return held;
  const tiers = new Set<number>();
  let step: BuildingType | undefined = target;
  while (step !== undefined && !tiers.has(step.typeId)) {
    tiers.add(step.typeId);
    step = step.upgradeTarget === undefined ? undefined : index.buildings.get(step.upgradeTarget);
  }
  memo.above.set(target.typeId, tiers);
  return tiers;
}

/** The tiers a build-order entry counts: `type` and those above it on its chain, stopping below the
 *  `belowTier` content id when given. The shared memoized set. */
export function countedTiers(
  content: ContentSet,
  type: BuildingType,
  belowTier: string | undefined,
): ReadonlySet<number> {
  const index = contentIndex(content);
  const memo = tierMemoOf(index);
  let byCap = memo.counted.get(type.typeId);
  if (byCap === undefined) {
    byCap = new Map();
    memo.counted.set(type.typeId, byCap);
  }
  const held = byCap.get(belowTier);
  if (held !== undefined) return held;
  const counted = new Set(tiersAtOrAbove(index, type));
  const cap = belowTier === undefined ? undefined : buildingTypeByContentId(content, belowTier);
  if (cap !== undefined) for (const tier of tiersAtOrAbove(index, cap)) counted.delete(tier);
  byCap.set(belowTier, counted);
  return counted;
}

/** Whether `from` sits strictly below `target` on the `upgradeTarget` chain. The visited guard bounds
 *  a malformed cyclic chain. */
export function upgradesInto(index: ContentIndex, from: BuildingType, target: BuildingType): boolean {
  const visited = new Set<number>();
  let step: BuildingType | undefined = from;
  while (step !== undefined && !visited.has(step.typeId)) {
    visited.add(step.typeId);
    if (step.typeId === target.typeId) return step !== from;
    step = step.upgradeTarget === undefined ? undefined : index.buildings.get(step.upgradeTarget);
  }
  return false;
}
