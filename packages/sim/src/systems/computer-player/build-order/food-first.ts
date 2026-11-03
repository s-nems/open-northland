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

/** The core workshops and the bread chain's first buildings by stable content id, in the order the
 *  seat's builders raise them (owner ruling: farm, then potter and mason, then mill, then bakery, then the
 *  rest). The pottery comes first because the school's bill takes its bricks and every later bill waits
 *  on them; the mason hut next because the school's and the bakery's bills take its pillar. The well goes
 *  before the bakery because the bakery bakes nothing without water. The mill opens the bread chain
 *  ({@link BREAD_CHAIN_OPENER}); the last id, the bakery, closes it. */
export const FOCUS_CHAIN: readonly string[] = [
  'work_pottery_00',
  'work_mason_hut_00',
  'work_mill_00',
  'work_well_00',
  'work_bakery_00',
];

/** The focus kind that opens the bread chain: the focus kinds after it count only once the seat owns
 *  one, site or standing, since a well rises for many lines; the ones before it count on their own. */
const BREAD_CHAIN_OPENER = 'work_mill_00';

/** Whether `type` is a workshop whose first post goes to the man who earned its trade, ahead of a school
 *  lesson and with the food chain's first hands (owner ruling): the pottery, whose bricks the school
 *  waits on, the mason hut, the mill and the bakery, at any tier. */
export function earnedTradeWorkshop(ctx: SystemContext, type: BuildingType): boolean {
  return EARNED_TRADE_WORKSHOPS.some((id) => ofKind(ctx, id, type));
}

const EARNED_TRADE_WORKSHOPS: readonly string[] = [
  'work_pottery_00',
  'work_mason_hut_00',
  'work_mill_00',
  'work_bakery_00',
];

/** The site past the chain every builder goes to: a seat's first barracks. Authored: observed on
 *  arabskie_wyspy_wolna_gra_mieszana, a seat's barracks stood unbuilt for most of an hour with its goods in
 *  stock, its builders spread over many sites and the towers beside them, and a rival's landing razed a seat
 *  with no soldier. */
const FOCUS_BARRACKS = 'barracks';

/** The bread chain's supplier ({@link FOCUS_CHAIN}): the workshop making a good the bakery's bill
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

/** Whether the seat's bread chain is open and unfinished: it owns a building of the chain's opener
 *  ({@link BREAD_CHAIN_OPENER}), site or standing, and no building of its last kind stands. */
export function breadChainUnfinished(world: World, ctx: SystemContext, owned: readonly Entity[]): boolean {
  const last = FOCUS_CHAIN[FOCUS_CHAIN.length - 1];
  if (last === undefined) return false;
  let opened = false;
  for (const e of owned) {
    const type = contentIndex(ctx.content).buildings.get(world.get(e, Building).buildingType);
    if (type === undefined) continue;
    if (ofKind(ctx, last, type) && isBuilt(world, e)) return false;
    if (ofKind(ctx, BREAD_CHAIN_OPENER, type)) opened = true;
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
 * pottery, the mason hut, the mill and then the bakery is earned, all builders go to it): the open site of
 * the first {@link FOCUS_CHAIN} kind the seat has none standing of at that tier or above, the lowest
 * entity id among several of one kind. The kinds past the mill count only once the seat owns a mill, site
 * or standing. Null once each counted kind stands or while none has a site open; an upgrade site never
 * counts. Past the chain the first barracks takes its turn ({@link FOCUS_BARRACKS}).
 */
export function focusChainSite(world: World, ctx: SystemContext, owned: readonly Entity[]): Entity | null {
  for (const id of FOCUS_CHAIN) {
    const kind = siteOfKind(world, ctx, owned, id);
    if (kind === null) continue;
    if (id === BREAD_CHAIN_OPENER && !kind.owns) break;
    if (!kind.stands && kind.site !== null) return kind.site;
  }
  const barracks = siteOfKind(world, ctx, owned, FOCUS_BARRACKS);
  return barracks === null || barracks.stands ? null : barracks.site;
}

/** What the seat owns of the kind `id` at its tier or above: its first open site, whether one stands, and
 *  whether it owns any; null for a kind the content lacks. */
function siteOfKind(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  id: string,
): { readonly site: Entity | null; readonly stands: boolean; readonly owns: boolean } | null {
  const type = buildingTypeByContentId(ctx.content, id);
  if (type === undefined) return null;
  const tiers = tiersAtOrAbove(contentIndex(ctx.content), type);
  let site: Entity | null = null;
  let owns = false;
  for (const e of owned) {
    if (!tiers.has(world.get(e, Building).buildingType)) continue;
    owns = true;
    if (isBuilt(world, e)) return { site: null, stands: true, owns };
    if (site === null && !world.has(e, Upgrading) && isServedConstructionSite(world, ctx.content, e))
      site = e;
  }
  return { site, stands: false, owns };
}
