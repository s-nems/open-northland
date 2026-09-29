import { Building, Stockpile, UnderConstruction } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { constructionBillOf, seatStockOf, upgradeTierOf } from '../../stores/index.js';

/**
 * Whether the seat can start upgrading `candidate` without starving the site or the seat. An upgrade
 * sends the crew out, so a bill good that only the candidate or another site could make (the pottery's
 * own bricks, or the bricks a mason hut needs while the pottery is upgrading) must already be in stock,
 * beyond what the seat's sites hold or still lack of it. A good no owned building makes is gathered, and
 * never holds an upgrade back. Nor does an upgrade idle the seat's last working maker of a good while
 * another maker of it is still a site: the second bakery waits for the first to come back.
 */
export function upgradeKeepsSupply(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  candidate: Entity,
): boolean {
  const index = contentIndex(ctx.content);
  const type = index.buildings.get(world.get(candidate, Building).buildingType);
  const target = type === undefined ? undefined : upgradeTierOf(type, ctx);
  if (type === undefined || target === undefined) return true;
  for (const recipe of type.recipes) {
    for (const output of recipe.outputs) {
      const makers = makersOf(world, ctx, owned, candidate, output.goodType);
      if (makers.working === 0 && makers.sites > 0) return false;
    }
  }
  const stock = seatStockOf(world, player);
  const claimed = sitesClaims(world, ctx, owned);
  for (const line of target.construction) {
    const makers = makersOf(world, ctx, owned, candidate, line.goodType);
    if (makers.working > 0 || (!makers.candidate && makers.sites === 0)) continue;
    const committed = claimed.get(line.goodType) ?? 0;
    if (!stock.exceeds(line.goodType, committed + line.amount - 1)) return false;
  }
  return true;
}

/** The seat's makers of one good, `candidate` counted apart from the rest. */
interface Makers {
  /** Built makers other than `candidate`. */
  readonly working: number;
  /** Makers standing as sites, from scratch or upgrading, other than `candidate`. */
  readonly sites: number;
  /** Whether `candidate` makes the good. */
  readonly candidate: boolean;
}

function makersOf(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  candidate: Entity,
  goodType: number,
): Makers {
  const index = contentIndex(ctx.content);
  let working = 0;
  let sites = 0;
  let isMaker = false;
  for (const e of owned) {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type === undefined || !type.recipes.some((r) => r.outputs.some((o) => o.goodType === goodType)))
      continue;
    if (e === candidate) isMaker = true;
    else if (world.has(e, UnderConstruction)) sites++;
    else working++;
  }
  return { working, sites, candidate: isMaker };
}

/**
 * What the seat's construction sites hold or still lack, by good type. Seat stock counts a site's
 * delivered hold too, and the bill is paid only when the site finishes, so both are spoken for.
 */
function sitesClaims(world: World, ctx: SystemContext, owned: readonly Entity[]): Map<number, number> {
  const claims = sitesShortfalls(world, ctx, owned);
  for (const e of owned) {
    if (!world.has(e, UnderConstruction)) continue;
    for (const [good, held] of world.tryGet(e, Stockpile)?.amounts ?? [])
      claims.set(good, (claims.get(good) ?? 0) + held);
  }
  return claims;
}

/** How much of each good the seat's construction sites still lack, by good type. */
export function sitesShortfalls(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
): Map<number, number> {
  const shortfalls = new Map<number, number>();
  for (const e of owned) {
    if (!world.has(e, UnderConstruction)) continue;
    const held = world.tryGet(e, Stockpile)?.amounts;
    for (const line of constructionBillOf(world, ctx, e)) {
      const lacking = Math.max(0, line.amount - (held?.get(line.goodType) ?? 0));
      shortfalls.set(line.goodType, (shortfalls.get(line.goodType) ?? 0) + lacking);
    }
  }
  return shortfalls;
}
