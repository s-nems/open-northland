import { Building } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { buildingTypeByContentId, countedTiers } from '../../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../../context.js';
import { buildingEnabled } from '../../../progression/index.js';
import type { EntryStatus } from '../order/entries.js';
import { type BuildOrderEntry, isLaneEntry } from '../order/entries.js';

/**
 * The tiers the upgrade step at `entryIndex` of its line's `steps` may raise `candidate` to, ascending
 * from its next tier, empty while that tier is not enabled for the seat. The step's tier is extended by
 * the unmet upgrade steps right after it in the line whose tier stands at or above it on the same chain
 * and still counts for every step before it, so one site jumps the building as far as that run wants
 * instead of one tier per site. The list stops below the first tier the seat has not enabled, the check
 * `upgradeBuilding` itself makes. Lanes and skipped steps do not break a run.
 */
export function upgradeReach(
  world: World,
  ctx: SystemContext,
  player: number,
  steps: readonly BuildOrderEntry[],
  statuses: readonly EntryStatus[],
  entryIndex: number,
  candidate: Entity,
): readonly number[] {
  const top = wantedTop(ctx, steps, statuses, entryIndex);
  if (top === undefined) return [];
  const index = contentIndex(ctx.content);
  const building = world.get(candidate, Building);
  const tiers: number[] = [];
  for (let tier = index.buildings.get(building.buildingType)?.upgradeTarget; tier !== undefined; ) {
    if (tiers.includes(tier) || !buildingEnabled(world, ctx, player, building.tribe, tier)) break;
    tiers.push(tier);
    if (tier === top) break;
    tier = index.buildings.get(tier)?.upgradeTarget;
  }
  return tiers;
}

/** The highest tier the run of upgrade steps starting at `entryIndex` wants. */
function wantedTop(
  ctx: SystemContext,
  steps: readonly BuildOrderEntry[],
  statuses: readonly EntryStatus[],
  entryIndex: number,
): number | undefined {
  const first = steps[entryIndex];
  if (first?.kind !== 'upgrade') return undefined;
  const firstType = buildingTypeByContentId(ctx.content, first.building);
  if (firstType === undefined) return undefined;
  const counting = [countedTiers(ctx.content, firstType, first.belowTier)];
  let top = firstType.typeId;
  for (let i = entryIndex + 1; i < steps.length; i++) {
    const entry = steps[i];
    const status = statuses[i];
    if (entry === undefined || status === 'skip' || isLaneEntry(entry)) continue;
    if (entry.kind !== 'upgrade' || status !== 'unmet') break;
    const type = buildingTypeByContentId(ctx.content, entry.building);
    if (type === undefined || !counting.every((tiers) => tiers.has(type.typeId))) break;
    counting.push(countedTiers(ctx.content, type, entry.belowTier));
    top = type.typeId;
  }
  return top;
}
