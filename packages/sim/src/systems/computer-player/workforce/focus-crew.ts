import { BuildMode, Carrying, Settler, SiteAssignment, Stockpile } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { ownedSettlers } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { atomicHoldsSettler } from '../../settlers/atomics/busy.js';
import { constructionBillOf, constructionTotalUnits } from '../../stores/index.js';

/**
 * Pin the seat's `builders` to its focus `site` (`../build-order/food-first.ts`) with the player's
 * `assignBuilder` order, the nearest first and ties to the lower id, up to one builder per unit of the
 * site's bill: each unit is one haul and its hammer steps, so a builder past them would only wait beside
 * the site while the other sites keep their crews (authored: the mill's bill is five units, the
 * bakery's six, the well's three, so a seat of few builders sends them all). The other sites wait
 * until the focus stands (owner ruling). A builder on a road run, mid-action or holding a load is pinned
 * on a later decision, since the order would cancel the one or carry the load off to a site that may not
 * take it. A pin lapses when the site stands.
 *
 * While the site lacks a good neither the seat's store (`stocked`) nor a crew hand holds, the pins are
 * lifted instead, so the builders raise the workshop that makes it (authored: on
 * battle_for_the_four_hills_multiplayer, seed 7, every bakery stood at five of six units for an hour,
 * its pillar waiting on a mason hut whose builders were all pinned to the bakery).
 */
export function focusCrewOrders(
  world: World,
  ctx: SystemContext,
  player: number,
  site: Entity,
  builders: readonly Entity[],
  builderJob: number | null,
  stocked: (good: number) => number,
): PlayerCommand[] {
  if (builderJob === null) return [];
  const onSite: Entity[] = [];
  for (const e of ownedSettlers(world, player)) {
    const assigned = world.tryGet(e, SiteAssignment);
    if (assigned?.site === site) onSite.push(e);
  }
  if (!siteSourced(world, ctx, site, onSite, stocked)) {
    return onSite
      .filter((e) => world.get(e, SiteAssignment).pinned && !atomicHoldsSettler(world, e))
      .map((entity): PlayerCommand => ({ kind: 'unassignBuilder', entity }));
  }
  const at = anchorNodeOf(world, site);
  if (at === null) return [];
  let pinned = 0;
  const free: { readonly e: Entity; readonly distance: number }[] = [];
  for (const e of builders) {
    if (world.get(e, Settler).jobType !== builderJob) continue;
    const assigned = world.tryGet(e, SiteAssignment);
    if (assigned?.pinned === true && assigned.site === site) {
      pinned++;
      continue;
    }
    if (world.has(e, BuildMode) || world.has(e, Carrying) || atomicHoldsSettler(world, e)) continue;
    const here = anchorNodeOf(world, e);
    if (here === null) continue;
    free.push({ e, distance: Math.abs(here.hx - at.hx) + Math.abs(here.hy - at.hy) });
  }
  free.sort((a, b) => a.distance - b.distance || a.e - b.e);
  const crew = Math.min(constructionTotalUnits(world, ctx, site), pinned + free.length);
  return free
    .slice(0, Math.max(0, crew - pinned))
    .map(({ e }): PlayerCommand => ({ kind: 'assignBuilder', entity: e, site }));
}

/** Whether every line of `site`'s bill is on site, in a `crew` hand or in the seat's store. */
function siteSourced(
  world: World,
  ctx: SystemContext,
  site: Entity,
  crew: readonly Entity[],
  stocked: (good: number) => number,
): boolean {
  const held = world.tryGet(site, Stockpile)?.amounts;
  for (const line of constructionBillOf(world, ctx, site)) {
    let have = Math.max(held?.get(line.goodType) ?? 0, 0) + stocked(line.goodType);
    for (const e of crew) {
      const load = world.tryGet(e, Carrying);
      if (load?.goodType === line.goodType) have += load.amount;
    }
    if (have < line.amount) return false;
  }
  return true;
}
