import { Building, UnderConstruction } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import type { AiPlayerModule } from '../index.js';
import { anchorNodeOf, buildingTypeByContentId, headquartersOf, ownedBuildings } from '../shared.js';
import { type BuildOrderEntry, MAX_ACTIVE_CONSTRUCTION_SITES } from './entries.js';
import { placementSpot } from './placement.js';
import { entryStatus, upgradeCandidate } from './progress.js';

export * from './entries.js';
export { collectorGoodsWanted } from './progress.js';

/**
 * The HouseBuild module — the executor over the authored {@link BuildOrderEntry} list. It walks the
 * entries in order, keeps at most {@link MAX_ACTIVE_CONSTRUCTION_SITES} sites open (upgrade sites
 * included), places on the affinity-aware near-HQ spot, upgrades toward the named tiers, and waits
 * at a `collector` entry for the workforce module's hire. A destroyed building re-enters its
 * entry's count, so the list self-repairs; an unmet entry with no legal action stalls (is retried
 * next decision), never skipped. Builders are not pinned to sites — the organic builder drive
 * already picks the nearest site and fetches materials.
 */
export function buildOrderModule(order: readonly BuildOrderEntry[]): AiPlayerModule {
  return {
    id: 'houseBuild',
    run: (world, ctx, player) => runBuildOrder(world, ctx, player, order),
  };
}

function runBuildOrder(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
): readonly Command[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return []; // a mapless sim has no ground to place on
  const hq = headquartersOf(world, ctx, player);
  if (hq === null) return [];
  const anchor = anchorNodeOf(world, hq);
  if (anchor === null) return [];

  const index = contentIndex(ctx.content);
  const owned = ownedBuildings(world, player);
  let sites = 0;
  for (const e of owned) {
    if (world.has(e, UnderConstruction)) sites++;
  }
  if (sites >= MAX_ACTIVE_CONSTRUCTION_SITES) return [];

  for (const entry of order) {
    const status = entryStatus(world, ctx, player, owned, entry);
    if (status !== 'unmet') continue;
    switch (entry.kind) {
      case 'place': {
        const type = buildingTypeByContentId(ctx.content, entry.building);
        if (type === undefined) return []; // unreachable after 'skip', kept for the type system
        // One placement per decision: the affinity-aware spot, or a stall when none is legal.
        const spot = placementSpot(world, ctx, terrain, owned, anchor, type, entry);
        if (spot === null) return [];
        return [
          {
            kind: 'placeBuilding',
            buildingType: type.typeId,
            x: spot.hx,
            y: spot.hy,
            tribe: world.get(hq, Building).tribe,
            owner: player,
            underConstruction: true,
          },
        ];
      }
      case 'upgrade': {
        const target = buildingTypeByContentId(ctx.content, entry.building);
        if (target === undefined) return []; // unreachable after 'skip', kept for the type system
        const candidate = upgradeCandidate(world, index, owned, target);
        if (candidate === null) return []; // nothing upgradable yet — stall until one stands
        return [{ kind: 'upgradeBuilding', building: candidate }];
      }
      case 'collector':
        return []; // the workforce module hires it (collectorGoodsWanted) — wait here
    }
  }
  return []; // the list is satisfied — the module goes quiet
}
