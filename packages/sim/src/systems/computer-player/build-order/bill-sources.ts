import { Building, type GoodsLine } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { buildingTypeByContentId } from '../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../context.js';
import { seatStockOf } from '../../stores/index.js';
import type { BuildOrderEntry } from './entries.js';

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
    if (!seatStockOf(world, player).exceeds(line.goodType, line.amount - 1)) return false;
  }
  return true;
}

/** Every good one of `owned`'s buildings makes by recipe or produces. */
export function goodsMadeBy(world: World, ctx: SystemContext, owned: readonly Entity[]): ReadonlySet<number> {
  const index = contentIndex(ctx.content);
  const made = new Set<number>();
  const seen = new Set<number>();
  for (const e of owned) {
    const typeId = world.get(e, Building).buildingType;
    if (seen.has(typeId)) continue;
    seen.add(typeId);
    const type = index.buildings.get(typeId);
    if (type === undefined) continue;
    for (const recipe of type.recipes) for (const output of recipe.outputs) made.add(output.goodType);
    for (const good of type.produces) made.add(good);
  }
  return made;
}
