import { Building, Stockpile, UnderConstruction } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { FetchableStock } from '../../settlers/targets/index.js';
import { constructionBillOf, upgradeTierOf } from '../../stores/index.js';

/**
 * Whether the seat can start upgrading `candidate` without starving the site. An upgrade sends the crew
 * out, so a bill good that only the candidate or another site could make (the pottery's own bricks, or
 * the bricks a mason hut needs while the pottery is upgrading) must already be fetchable, beyond what the
 * seat's other sites still lack of it. A good no owned building makes is gathered, and never holds an
 * upgrade back.
 */
export function upgradeBillCovered(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  candidate: Entity,
): boolean {
  const index = contentIndex(ctx.content);
  const type = index.buildings.get(world.get(candidate, Building).buildingType);
  const target = type === undefined ? undefined : upgradeTierOf(type, ctx);
  if (target === undefined) return true;
  const stock = FetchableStock.of(world, ctx);
  for (const line of target.construction) {
    if (!producedOnlyByIdleBuildings(world, ctx, owned, candidate, line.goodType)) continue;
    const committed = sitesShortfall(world, ctx, owned, line.goodType);
    if (!stock.exceeds(player, line.goodType, committed + line.amount - 1)) return false;
  }
  return true;
}

/** Whether the seat owns a producer of `goodType` and every one is `candidate` or a site. */
function producedOnlyByIdleBuildings(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  candidate: Entity,
  goodType: number,
): boolean {
  const index = contentIndex(ctx.content);
  let producers = 0;
  for (const e of owned) {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type === undefined || !type.recipes.some((r) => r.outputs.some((o) => o.goodType === goodType)))
      continue;
    if (e !== candidate && !world.has(e, UnderConstruction)) return false;
    producers++;
  }
  return producers > 0;
}

/** How much of `goodType` the seat's construction sites still lack. */
export function sitesShortfall(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  goodType: number,
): number {
  let shortfall = 0;
  for (const e of owned) {
    if (!world.has(e, UnderConstruction)) continue;
    const held = world.tryGet(e, Stockpile)?.amounts.get(goodType) ?? 0;
    for (const line of constructionBillOf(world, ctx, e)) {
      if (line.goodType === goodType) shortfall += Math.max(0, line.amount - held);
    }
  }
  return shortfall;
}
