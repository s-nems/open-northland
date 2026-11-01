import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import { Building, Upgrading } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { buildingTypeByContentId, tiersAtOrAbove } from '../../ai-shared/content-lookup.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { isServedConstructionSite } from '../../settlers/targets/index.js';
import { inFoodChain } from '../workforce/food.js';
import type { BuildOrderEntry } from './entries.js';
import { housingStage } from './housing.js';

/**
 * Whether the seat's food production is missing (owner ruling: food production comes before the population,
 * the weapons and the joiner): no bakery stands and no fisher fishes, the housing lane's `opening` and
 * `herding` stages. Such a seat gives the first building of each food chain kind it lacks the free site
 * ahead of the towers, a barracks not yet due and the other crafts (`./index.ts`). Stored food is no
 * signal here: a growing seat eats its store empty while its bakeries run.
 */
export function seatFoodFailing(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): boolean {
  const stage = housingStage(world, ctx, player, owned);
  return stage === 'opening' || stage === 'herding';
}

/** Whether `entry` places or upgrades a food chain workplace: a maker of food, or of a good one takes
 *  (`../workforce/food.ts`), as the farm, the mill, a well or the brewery. */
export function foodChainStep(ctx: SystemContext, entry: BuildOrderEntry): boolean {
  if (entry.kind !== 'place' && entry.kind !== 'upgrade') return false;
  const type = buildingTypeByContentId(ctx.content, entry.building);
  return type !== undefined && type.kind === BUILDING_KIND.workplace && inFoodChain(ctx, type);
}

/** The bread chain's first buildings by stable content id, in the order the seat's builders raise them
 *  (owner ruling: bread is a lean start's way out, since the women start children only on steady bread).
 *  The well comes before the bakery because the bakery bakes nothing without water, and the mason hut
 *  because its bill takes a pillar. The first id, the mill, opens the chain. */
export const BREAD_CHAIN_FOCUS: readonly string[] = [
  'work_mill_00',
  'work_well_00',
  'work_mason_hut_00',
  'work_bakery_00',
];

/** Whether `type` is one of the bread chain's workshops a discovery opens: the mill or the bakery at any
 *  tier, whose first post goes to the man who earned its trade (owner ruling). */
export function breadChainWorkshop(ctx: SystemContext, type: BuildingType): boolean {
  const index = contentIndex(ctx.content);
  return BREAD_CHAIN_WORKSHOPS.some((id) => {
    const base = buildingTypeByContentId(ctx.content, id);
    return base !== undefined && tiersAtOrAbove(index, base).has(type.typeId);
  });
}

const BREAD_CHAIN_WORKSHOPS: readonly string[] = ['work_mill_00', 'work_bakery_00'];

/**
 * The construction site every builder of the seat works ahead of its other sites (owner ruling: when the
 * mill, and then the bakery, is earned, all builders go to it): the open site of the first
 * {@link BREAD_CHAIN_FOCUS} kind the seat has none standing of at that tier or above, the lowest entity id
 * among several of one kind. Null before the seat owns a mill, site or standing, once each kind stands or
 * while none has a site open; an upgrade site never counts.
 */
export function breadFocusSite(world: World, ctx: SystemContext, owned: readonly Entity[]): Entity | null {
  const index = contentIndex(ctx.content);
  for (const [rank, id] of BREAD_CHAIN_FOCUS.entries()) {
    const type = buildingTypeByContentId(ctx.content, id);
    if (type === undefined) continue;
    const tiers = tiersAtOrAbove(index, type);
    let site: Entity | null = null;
    let stands = false;
    let owns = false;
    for (const e of owned) {
      if (!tiers.has(world.get(e, Building).buildingType)) continue;
      owns = true;
      if (isBuilt(world, e)) {
        stands = true;
        break;
      }
      if (site === null && !world.has(e, Upgrading) && isServedConstructionSite(world, ctx.content, e))
        site = e;
    }
    if (rank === 0 && !owns) return null;
    if (!stands && site !== null) return site;
  }
  return null;
}
