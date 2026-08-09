import type { BuildingType } from '@open-northland/data';
import { Building, UnderConstruction } from '../../../components/index.js';
import { type ContentIndex, contentIndex } from '../../../core/content-index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { seatBaseOf } from '../base.js';
import { buildingTypeByContentId, goodTypeByContentId, tiersAtOrAbove } from '../content-lookup.js';
import { anyLiveResource } from '../live-resources.js';
import { anchorNodeOf } from '../node-geometry.js';
import { ownedBuildings, ownedSettlers } from '../seat-roster.js';
import type { BuildOrderEntry } from './entries.js';
import { firstUncoveredBuilding } from './tower-coverage.js';

/** `skip` (not expressible in this content set, or nothing left to collect) counts as done for
 *  sequencing. */
export type EntryStatus = 'skip' | 'satisfied' | 'unmet';

/** Whether `from` sits strictly below `target` on the `upgradeTarget` chain. The visited guard bounds
 *  a malformed cyclic chain. */
function upgradesInto(index: ContentIndex, from: BuildingType, target: BuildingType): boolean {
  const visited = new Set<number>();
  let step: BuildingType | undefined = from;
  while (step !== undefined && !visited.has(step.typeId)) {
    visited.add(step.typeId);
    if (step.typeId === target.typeId) return step !== from;
    step = step.upgradeTarget === undefined ? undefined : index.buildings.get(step.upgradeTarget);
  }
  return false;
}

/** `owned` is the seat's {@link ownedBuildings} list, passed in so one decision computes it once. */
export function entryStatus(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  entry: BuildOrderEntry,
): EntryStatus {
  const index = contentIndex(ctx.content);
  switch (entry.kind) {
    case 'place': {
      const type = buildingTypeByContentId(ctx.content, entry.building);
      if (type === undefined) return 'skip';
      // The placed tier or anything above it on its chain counts, so an upgraded workshop never
      // triggers a duplicate placement; a home entry counts every home tier.
      const counted = tiersAtOrAbove(index, type);
      let have = 0;
      for (const e of owned) {
        const ownedType = index.buildings.get(world.get(e, Building).buildingType);
        if (ownedType === undefined) continue;
        const matches = type.kind === 'home' ? ownedType.kind === 'home' : counted.has(ownedType.typeId);
        if (matches) have++;
      }
      return have >= entry.count ? 'satisfied' : 'unmet';
    }
    case 'upgrade': {
      const target = buildingTypeByContentId(ctx.content, entry.building);
      if (target === undefined) return 'skip';
      const done = tiersAtOrAbove(index, target);
      let have = 0;
      for (const e of owned) {
        if (done.has(world.get(e, Building).buildingType)) have++;
      }
      return have >= entry.count ? 'satisfied' : 'unmet';
    }
    case 'collector': {
      const good = goodTypeByContentId(ctx.content, entry.good);
      if (good?.atomics?.harvest === undefined) return 'skip';
      for (const e of ownedSettlers(world, player)) {
        if (liveWorkFlag(world, e)?.goodType === good.typeId) return 'satisfied';
      }
      // Nothing left to collect anywhere counts as done, so the list never stalls on a dry map.
      const base = seatBaseOf(world, ctx, player);
      const near = base === null ? null : anchorNodeOf(world, base);
      return anyLiveResource(world, good.typeId, near) ? 'unmet' : 'skip';
    }
    case 'towerCoverage': {
      const type = buildingTypeByContentId(ctx.content, entry.building);
      if (type === undefined) return 'skip';
      return firstUncoveredBuilding(world, ctx, player, owned) === null ? 'satisfied' : 'unmet';
    }
  }
}

/**
 * Every entry's status in list order. Statuses are recomputed each decision and can regress (a razed
 * home, a fringe building re-arming `towerCoverage`), so consumers must tolerate a temporary drop.
 */
export function entryStatuses(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
): EntryStatus[] {
  const owned = ownedBuildings(world, player);
  return order.map((entry) => entryStatus(world, ctx, player, owned, entry));
}

/** The lowest-id built building the seat can upgrade toward `target`; a site, including an in-flight
 *  upgrade, has `built < ONE` and is skipped. `owned` is canonical ascending, so the first hit is
 *  deterministic. */
export function upgradeCandidate(
  world: World,
  index: ContentIndex,
  owned: readonly Entity[],
  target: BuildingType,
): Entity | null {
  for (const e of owned) {
    const building = world.get(e, Building);
    if (building.built < ONE || world.has(e, UnderConstruction)) continue;
    const type = index.buildings.get(building.buildingType);
    if (type !== undefined && upgradesInto(index, type, target)) return e;
  }
  return null;
}

/**
 * The collector goods the list has reached, in order: an entry is reached while every entry before it
 * is satisfied or skipped. Reached state is re-derived each decision, so a regressing earlier entry
 * drops a later collector and returns its holder to the pool until the list re-reaches the entry.
 */
export function collectorGoodsWanted(
  order: readonly BuildOrderEntry[],
  statuses: readonly EntryStatus[],
): readonly string[] {
  const wanted: string[] = [];
  for (const [i, entry] of order.entries()) {
    const status = statuses[i];
    if (entry.kind === 'collector' && status !== 'skip') wanted.push(entry.good);
    if (status === 'unmet') break;
  }
  return wanted;
}
