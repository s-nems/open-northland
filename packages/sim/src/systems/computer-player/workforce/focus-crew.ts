import {
  Building,
  BuildMode,
  Carrying,
  Settler,
  SiteAssignment,
  Stockpile,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { type Fixed, fx } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { ownedSettlers } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { atomicHoldsSettler } from '../../settlers/atomics/busy.js';
import { isServedConstructionSite } from '../../settlers/targets/index.js';
import {
  constructionBillOf,
  constructionTotalUnits,
  deliveredConstructionFraction,
} from '../../stores/index.js';

/** The delivered share of its bill from which another open site keeps one builder off the focus
 *  (authored, the builder drive's nearly-done share): on battle_for_the_four_hills_multiplayer, seed 7,
 *  a seat whose mill came at minute 6 pinned both builders to it while its first homes stood at 53-75%,
 *  and its first child came six minutes late, which cost it eight settlers at minute 30. */
const NEARLY_DONE_SHARE: Fixed = fx.div(fx.fromInt(2), fx.fromInt(3));

/**
 * Pin the seat's `builders` to its focus `site` (`../build-order/food-first.ts`) with the player's
 * `assignBuilder` order, the nearest first and ties to the lower id, up to one builder per unit of the
 * site's bill: each unit is one haul and its hammer steps, so a builder past them would only wait beside
 * the site while the other sites keep their crews (authored: the mill's bill is five units, the
 * bakery's six, the well's three, so a seat of few builders sends them all). A builder on a road run,
 * mid-action or holding a load is pinned on a later decision, since the order would cancel the one or
 * carry the load off to a site that may not take it. Each other open site with delivered material
 * still to hammer, or {@link NEARLY_DONE_SHARE} of its bill delivered, keeps one builder unpinned, so a
 * seat of one builder finishes its nearly done home before it turns to the focus (authored: on
 * ciezka_wspolpraca, seed 7, a one-builder seat left a home at 92% for six minutes while he raised the
 * mill's well, and a two-builder seat's third home, which the pottery waits on, stood until minute 37). A pin
 * lapses when the site stands.
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
  owned: readonly Entity[],
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
  let finishing = 0;
  for (const e of owned) {
    if (e === site || !isServedConstructionSite(world, ctx.content, e)) continue;
    const delivered = deliveredConstructionFraction(world, ctx, e);
    if (delivered >= NEARLY_DONE_SHARE || delivered > world.get(e, Building).built) finishing++;
  }
  const crew = Math.min(constructionTotalUnits(world, ctx, site), pinned + free.length - finishing);
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
