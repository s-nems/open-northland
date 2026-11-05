import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import { UnderConstruction } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { buildingTypeByContentId, countedTiers } from '../../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../../context.js';
import { homeStockOf } from '../../colony/stock.js';
import { MID_GAME_FROM_TICKS } from '../../game-phase.js';
import { militaryDeadlineTick } from '../../military/deadline.js';
import { enabledTiersAbove } from '../../top-tier.js';
import type { BuildOrderEntry } from '../order/entries.js';
import { seatDefenceFirst } from '../order/seat-order.js';
import { goodsMadeBy, sourcedTiers } from './bill-sources.js';
import { sitesClaims } from './upgrade-supply.js';

/** A step that raises a new building of its chain. */
export type PlacingEntry = Extract<BuildOrderEntry, { kind: 'place' | 'towerCoverage' | 'storeCoverage' }>;

/** Owner ruling: where attacks come early a ring rises as the cheap lower tower, which stands in a
 *  fraction of the upper one's time and bill; from the mid game on, and on every seat whose attacks come
 *  later, a tower goes up at the upper tier at once. */
const EARLY_ATTACKS_BEFORE_TICKS = MID_GAME_FROM_TICKS;

/**
 * The tier a placing `entry` raises (owner ruling: once a higher tier is unlocked, build it outright, not
 * the lower one to upgrade later): the highest tier of the step's chain, below its `belowTier` cap, that
 * the seat has enabled up the chain without a gap, whose own bill has a source ({@link sourcedTiers}), and
 * whose merged bill the store backs as an upgrade's ({@link stockBacks}); else the step's own tier. A tower
 * ring keeps the lower tier while the seat's attacks come early ({@link attacksComeEarly}), and a home its
 * step's: the housing lane paces the home tiers by the seat's food (`../steps/housing.ts`).
 */
export function directTier(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  tribe: number,
  entry: PlacingEntry,
  made: () => ReadonlySet<number>,
): BuildingType | undefined {
  const base = buildingTypeByContentId(ctx.content, entry.building);
  if (base?.upgradeTarget === undefined || base.kind === BUILDING_KIND.home) return base;
  const index = contentIndex(ctx.content);
  const allowed = countedTiers(ctx.content, base, entry.kind === 'place' ? entry.belowTier : undefined);
  const tiers = enabledTiersAbove(world, ctx, player, tribe, base, allowed).map((t) => t.typeId);
  if (tiers.length === 0) return base;
  if (entry.kind === 'towerCoverage' && attacksComeEarly(world, ctx, player)) return base;
  const sourced = sourcedTiers(world, ctx, player, tiers, made);
  for (let i = sourced.length - 1; i >= 0; i--) {
    const tier = sourced[i];
    const type = tier === undefined ? undefined : index.buildings.get(tier);
    if (type !== undefined && stockBacks(world, ctx, player, owned, type)) return type;
  }
  return base;
}

/** Whether `player`'s attacks come early: before the mid game, its defence comes first or its military
 *  deadline (a short peace or a forecast scripted attack) lies before the mid game. */
function attacksComeEarly(world: World, ctx: SystemContext, player: number): boolean {
  if (ctx.tick >= EARLY_ATTACKS_BEFORE_TICKS) return false;
  return (
    seatDefenceFirst(world, ctx, player) ||
    militaryDeadlineTick(world, ctx, player) < EARLY_ATTACKS_BEFORE_TICKS
  );
}

/**
 * Whether the store backs `type`'s merged construction bill as it backs an upgrade: a good that is
 * gathered or that a standing building of the seat makes is free; any other, made only by a site or by
 * nothing the seat owns, must already be in store beyond what the seat's sites hold or still lack of it.
 */
function stockBacks(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  type: BuildingType,
): boolean {
  const index = contentIndex(ctx.content);
  const bill = index.constructionBillByBuilding.get(type.typeId) ?? [];
  let working: ReadonlySet<number> | undefined;
  let claimed: Map<number, number> | undefined;
  const stock = homeStockOf(world, ctx, player);
  for (const line of bill) {
    if (index.goods.get(line.goodType)?.atomics?.harvest !== undefined) continue;
    working ??= goodsMadeBy(
      world,
      ctx,
      owned.filter((e) => !world.has(e, UnderConstruction)),
    );
    if (working.has(line.goodType)) continue;
    claimed ??= sitesClaims(world, ctx, owned);
    if (!stock.exceeds(line.goodType, (claimed.get(line.goodType) ?? 0) + line.amount - 1)) return false;
  }
  return true;
}
