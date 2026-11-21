import { Building, type GoodsLine, UnderConstruction } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { buildingTypeByContentId } from '../../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../../context.js';
import { homeStockOf } from '../../home-stock.js';
import type { BuildOrderEntry } from '../order/entries.js';
import { ownProductsLacking } from './upgrade-supply.js';

/**
 * Whether the seat has a source for every good of the step's merged tier-chain bill: a good with a
 * harvest atomic is gathered, any other is made by a building the seat owns, a site included, or
 * already in store to the bill's amount. A step without one waits in its line, so no line raises a site
 * whose bill nothing can fill while the workshop that would make the good belongs to another line.
 * `made` is the decision's {@link goodsMadeBy} answer, asked only when a bill needs it.
 */
export function billSourced(
  world: World,
  ctx: SystemContext,
  player: number,
  entry: BuildOrderEntry,
  made: () => ReadonlySet<number>,
): boolean {
  if (entry.kind === 'collector') return true;
  const type = buildingTypeByContentId(ctx.content, entry.building);
  if (type === undefined) return true;
  const bill = contentIndex(ctx.content).constructionBillByBuilding.get(type.typeId) ?? [];
  return linesSourced(world, ctx, player, bill, made);
}

/** The leading run of upgrade `tiers` whose own bills have a source, as {@link billSourced} judges it, so
 *  one site never jumps a building to a tier whose bill nothing can fill. */
export function sourcedTiers(
  world: World,
  ctx: SystemContext,
  player: number,
  tiers: readonly number[],
  made: () => ReadonlySet<number>,
): readonly number[] {
  const index = contentIndex(ctx.content);
  const sourced = tiers.findIndex(
    (tier) => !linesSourced(world, ctx, player, index.buildings.get(tier)?.construction ?? [], made),
  );
  return sourced < 0 ? tiers : tiers.slice(0, sourced);
}

function linesSourced(
  world: World,
  ctx: SystemContext,
  player: number,
  bill: readonly GoodsLine[],
  made: () => ReadonlySet<number>,
): boolean {
  const goods = contentIndex(ctx.content).goods;
  for (const line of bill) {
    if (goods.get(line.goodType)?.atomics?.harvest !== undefined) continue;
    if (made().has(line.goodType)) continue;
    if (!homeStockOf(world, ctx, player).exceeds(line.goodType, line.amount - 1)) return false;
  }
  return true;
}

/** Every good one of `owned`'s buildings makes by recipe or produces. A site counts for the goods it
 *  will make once standing, except one its own bill still lacks ({@link ownProductsLacking}): a pottery
 *  upgrading without its bricks is no source of bricks. */
export function goodsMadeBy(world: World, ctx: SystemContext, owned: readonly Entity[]): ReadonlySet<number> {
  const index = contentIndex(ctx.content);
  const made = new Set<number>();
  const seen = new Set<number>();
  for (let i = 0; i < owned.length; i++) {
    const e = owned[i] as Entity;
    const typeId = world.get(e, Building).buildingType;
    const site = world.has(e, UnderConstruction);
    if (!site && seen.has(typeId)) continue;
    const type = index.buildings.get(typeId);
    if (type === undefined) continue;
    const lacking = site ? ownProductsLacking(world, ctx, e) : undefined;
    if (!site) seen.add(typeId);
    for (let j = 0; j < type.recipes.length; j++) {
      const recipe = type.recipes[j];
      if (recipe === undefined) continue;
      for (let k = 0; k < recipe.outputs.length; k++) {
        const output = recipe.outputs[k];
        if (output === undefined) continue;
        if (!lacking?.has(output.goodType)) made.add(output.goodType);
      }
    }
    for (let j = 0; j < type.produces.length; j++) {
      const good = type.produces[j] as number;
      if (!lacking?.has(good)) made.add(good);
    }
  }
  return made;
}
