import type { BuildingType } from '@open-northland/data';
import { Building, Resource, UnderConstruction } from '../../../components/index.js';
import { type ContentIndex, contentIndex } from '../../../core/content-index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/flags.js';
import { canonicalResources } from '../../resource-index.js';
import { buildingTypeByContentId, goodTypeByContentId, ownedBuildings, ownedSettlers } from '../shared.js';
import type { BuildOrderEntry } from './entries.js';

// ENTRY PROGRESS — the one shared reading of "is this build-order entry done", used by the
// executor (what to do next) and the workforce allocator (which collector goods the list has
// reached). Both read the same world state within a decision, so they can never disagree.

/** `skip`: not expressible in this content set / nothing to collect — treated as done for
 *  sequencing. `satisfied`: the world meets the entry. `unmet`: the entry wants action. */
export type EntryStatus = 'skip' | 'satisfied' | 'unmet';

/** Whether `from` reaches `target` by walking `upgradeTarget` links upward (strictly below it). The
 *  visited guard bounds a malformed cyclic chain. */
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

/** The typeIds at or above `target` on its chain: `target` itself plus everything it upgrades into. */
function tiersAtOrAbove(index: ContentIndex, target: BuildingType): Set<number> {
  const tiers = new Set<number>();
  let step: BuildingType | undefined = target;
  while (step !== undefined && !tiers.has(step.typeId)) {
    tiers.add(step.typeId);
    step = step.upgradeTarget === undefined ? undefined : index.buildings.get(step.upgradeTarget);
  }
  return tiers;
}

/** Whether any not-yet-empty resource of `goodType` stands on the map. */
function anyLiveResource(world: World, goodType: number): boolean {
  for (const e of canonicalResources(world)) {
    const r = world.get(e, Resource);
    if (r.goodType === goodType && r.remaining > 0) return true;
  }
  return false;
}

/** The seat's build-order progress on one entry (see {@link EntryStatus}). `owned` is the seat's
 *  {@link ownedBuildings} list, passed in so one decision computes it once. */
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
      let have = 0;
      for (const e of owned) {
        const ownedType = index.buildings.get(world.get(e, Building).buildingType);
        if (ownedType === undefined) continue;
        const matches = type.kind === 'home' ? ownedType.kind === 'home' : ownedType.typeId === type.typeId;
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
      // Nothing left to collect anywhere — treat as done so the list never stalls on a dry map.
      return anyLiveResource(world, good.typeId) ? 'unmet' : 'skip';
    }
  }
}

/** The lowest-id owned BUILT building the seat can upgrade toward `target` (its type strictly below
 *  the target on the chain; a site — including an in-flight upgrade — has `built < ONE` and is
 *  skipped), or null. `owned` is canonical ascending, so first hit wins deterministically. */
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
 * The collector goods the build order has REACHED, in list order — the workforce allocator hires a
 * flag gatherer for each (on top of its base goods). An entry is reached while every entry before it
 * is satisfied (or skipped); once reached it stays wanted (the hired collector keeps its post), and
 * a reached-but-unmet collector blocks the entries after it — the plan's sequencing.
 */
export function collectorGoodsWanted(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
): readonly string[] {
  const owned = ownedBuildings(world, player);
  const wanted: string[] = [];
  for (const entry of order) {
    const status = entryStatus(world, ctx, player, owned, entry);
    if (entry.kind === 'collector' && status !== 'skip') wanted.push(entry.good);
    if (status === 'unmet') break;
  }
  return wanted;
}
