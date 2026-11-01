import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import { Building, Upgrading } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { buildingTypeByContentId, tiersAtOrAbove } from '../../ai-shared/content-lookup.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { isServedConstructionSite } from '../../settlers/targets/index.js';
import { femaleDemand } from '../female-stock.js';
import { flagFishers } from '../workforce/fisher.js';
import { inFoodChain } from '../workforce/food.js';
import type { BuildOrderEntry } from './entries.js';
import { HOUSING_WOMEN_PER_FOOD_SOURCE, housingStage } from './housing.js';

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
 *  The mason hut comes second because the bakery's bill takes a pillar, which its mason makes while the
 *  well rises, and the well before the bakery because the bakery bakes nothing without water. The first
 *  id, the mill, opens the chain; the last, the bakery, closes it. */
export const BREAD_CHAIN_FOCUS: readonly string[] = [
  'work_mill_00',
  'work_mason_hut_00',
  'work_well_00',
  'work_bakery_00',
];

/** Whether `type` is one of the bread chain's workshops a discovery opens: the mill or the bakery at any
 *  tier, whose first post goes to the man who earned its trade (owner ruling). */
export function breadChainWorkshop(ctx: SystemContext, type: BuildingType): boolean {
  return BREAD_CHAIN_WORKSHOPS.some((id) => ofKind(ctx, id, type));
}

const BREAD_CHAIN_WORKSHOPS: readonly string[] = ['work_mill_00', 'work_bakery_00'];

/** The bread chain's supplier ({@link BREAD_CHAIN_FOCUS}): the workshop making a good the bakery's bill
 *  takes and no food. */
const BREAD_CHAIN_SUPPLIER = 'work_mason_hut_00';

/** Whether `type` is the bread chain's supplier ({@link BREAD_CHAIN_SUPPLIER}) at any tier. */
export function breadChainSupplier(ctx: SystemContext, type: BuildingType): boolean {
  return ofKind(ctx, BREAD_CHAIN_SUPPLIER, type);
}

function ofKind(ctx: SystemContext, id: string, type: BuildingType): boolean {
  const base = buildingTypeByContentId(ctx.content, id);
  return base !== undefined && tiersAtOrAbove(contentIndex(ctx.content), base).has(type.typeId);
}

/** Whether the seat's bread chain is open and unfinished: it owns the chain's first building, site or
 *  standing, and no building of its last kind stands ({@link BREAD_CHAIN_FOCUS}). */
export function breadChainUnfinished(world: World, ctx: SystemContext, owned: readonly Entity[]): boolean {
  const first = BREAD_CHAIN_FOCUS[0];
  const last = BREAD_CHAIN_FOCUS[BREAD_CHAIN_FOCUS.length - 1];
  if (first === undefined || last === undefined) return false;
  let opened = false;
  for (const e of owned) {
    const type = contentIndex(ctx.content).buildings.get(world.get(e, Building).buildingType);
    if (type === undefined) continue;
    if (ofKind(ctx, last, type) && isBuilt(world, e)) return false;
    if (ofKind(ctx, first, type)) opened = true;
  }
  return opened;
}

/**
 * Whether the seat's flag fishers feed its women and the daughters booked for them, each carrying
 * {@link HOUSING_WOMEN_PER_FOOD_SOURCE}: then the catch already is the steady food bread would bring, and
 * the bread chain's focus site pins only its floor of builders (`../workforce/index.ts`). Authored: on
 * arabskie_wyspy_wolna_gra_mieszana and ciezka_wspolpraca, where seats fish from the start, pinning every
 * builder to the focus site held the pottery and the home upgrades back about ten minutes.
 */
export function fishFeedsWomen(world: World, ctx: SystemContext, player: number): boolean {
  return femaleDemand(world, ctx, player) < flagFishers(world, ctx, player) * HOUSING_WOMEN_PER_FOOD_SOURCE;
}

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
