import type { BuildingType } from '@open-northland/data';
import {
  Building,
  type GoodsLine,
  Stockpile,
  UnderConstruction,
  Upgrading,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { constructionBillOf, seatStockOf } from '../../stores/index.js';

const NO_CLAIMS: ReadonlyMap<number, number> = new Map();

/**
 * The highest of `tiers` the seat can start upgrading `candidate` to without starving the site or the
 * seat, judged against the merged bill of every tier the jump raises; undefined when none can. An
 * upgrade sends the crew out, so a bill good that only the candidate or another site could make (the
 * pottery's own bricks, or the bricks a mason hut needs while the pottery is upgrading) must already be
 * in stock, beyond what the seat's sites hold or still lack of it. A good no owned building makes is
 * gathered, and never holds an upgrade back. Nor does an upgrade idle the seat's last working maker of a
 * good while another maker of it is still a site: the second bakery waits for the first to come back.
 * The upgrade seeds its site from the candidate's own pile and keeps the rest of that pile aside until it
 * finishes, so a pile beyond the bill is no stock the seat's other sites can spend meanwhile. With
 * `aheadOfSites` the stock only has to hold the bill, whatever other sites still lack of it.
 */
export function suppliedUpgrade(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  candidate: Entity,
  tiers: readonly number[],
  aheadOfSites = false,
): number | undefined {
  const index = contentIndex(ctx.content);
  const typeId = world.get(candidate, Building).buildingType;
  const type = index.buildings.get(typeId);
  if (type === undefined) return undefined;
  for (const recipe of type.recipes) {
    for (const output of recipe.outputs) {
      const makers = makersOf(world, ctx, owned, candidate, output.goodType);
      if (makers.working === 0 && makers.sites > 0) return undefined;
    }
  }
  const stock = seatStockOf(world, player);
  const claimed = aheadOfSites ? NO_CLAIMS : sitesClaims(world, ctx, owned);
  const pile = world.tryGet(candidate, Stockpile)?.amounts;
  const madeElsewhere = new Map<number, boolean>();
  const backed = (bill: readonly GoodsLine[]): boolean =>
    bill.every((line) => {
      let free = madeElsewhere.get(line.goodType);
      if (free === undefined) {
        const makers = makersOf(world, ctx, owned, candidate, line.goodType);
        free = makers.working > 0 || (!makers.candidate && makers.sites === 0);
        madeElsewhere.set(line.goodType, free);
      }
      if (free) return true;
      const aside = Math.max(0, (pile?.get(line.goodType) ?? 0) - line.amount);
      return stock.exceeds(line.goodType, (claimed.get(line.goodType) ?? 0) + aside + line.amount - 1);
    });
  for (let i = tiers.length - 1; i >= 0; i--) {
    const tier = tiers[i];
    const bill = tier === undefined ? undefined : index.upgradeBillByTarget.get(typeId)?.get(tier);
    if (bill !== undefined && backed(bill)) return tier;
  }
  return undefined;
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
 * What the seat's construction sites hold or still lack, and what its upgrades keep aside, by good type.
 * Seat stock counts a site's delivered hold and an upgrade's stash too, yet the bill is paid only when the
 * site finishes and the stash comes back only then, so all of it is spoken for.
 */
export function sitesClaims(world: World, ctx: SystemContext, owned: readonly Entity[]): Map<number, number> {
  const claims = sitesShortfalls(world, ctx, owned);
  for (const [good, units] of setAside(world, owned)) claims.set(good, (claims.get(good) ?? 0) + units);
  return claims;
}

/** What the seat's construction sites hold and its upgrades keep aside, by good type: seat stock no
 *  other site can draw on before they finish. */
function setAside(world: World, owned: readonly Entity[]): Map<number, number> {
  const aside = new Map<number, number>();
  const add = (amounts: ReadonlyMap<number, number> | undefined): void => {
    for (const [good, units] of amounts ?? []) aside.set(good, (aside.get(good) ?? 0) + units);
  };
  for (const e of owned) {
    if (!world.has(e, UnderConstruction)) continue;
    add(world.tryGet(e, Stockpile)?.amounts);
    add(world.tryGet(e, Upgrading)?.savedStock);
  }
  return aside;
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
    for (const [good, lacking] of siteShortfall(world, ctx, e))
      shortfalls.set(good, (shortfalls.get(good) ?? 0) + lacking);
  }
  return shortfalls;
}

/** What one construction site still lacks of its bill, by good type, goods it lacks none of left out. */
function siteShortfall(world: World, ctx: SystemContext, site: Entity): Map<number, number> {
  const lacking = new Map<number, number>();
  const held = world.tryGet(site, Stockpile)?.amounts;
  for (const line of constructionBillOf(world, ctx, site)) {
    const short = Math.max(0, line.amount - (held?.get(line.goodType) ?? 0));
    if (short > 0) lacking.set(line.goodType, (lacking.get(line.goodType) ?? 0) + short);
  }
  return lacking;
}

/**
 * The goods construction `site` still lacks that it would make itself once standing, by good type: those
 * of its current type and, for an upgrade, of its target. A site makes nothing until it finishes, so it
 * is no source of these; another building or the stock has to pay them.
 */
export function ownProductsLacking(world: World, ctx: SystemContext, site: Entity): Map<number, number> {
  const index = contentIndex(ctx.content);
  const target = world.tryGet(site, Upgrading)?.target;
  const own = [
    index.buildings.get(world.get(site, Building).buildingType),
    target === undefined ? undefined : index.buildings.get(target),
  ];
  const lacking = siteShortfall(world, ctx, site);
  for (const good of lacking.keys()) if (!own.some((type) => makes(type, good))) lacking.delete(good);
  return lacking;
}

/** Whether `type` makes `goodType` by recipe or produces it. */
export function makes(type: BuildingType | undefined, goodType: number): boolean {
  if (type === undefined) return false;
  return (
    type.produces.includes(goodType) ||
    type.recipes.some((r) => r.outputs.some((o) => o.goodType === goodType))
  );
}

/**
 * An upgrade of the seat's that can never finish, null when there is none: its site still lacks a good it
 * would make itself ({@link ownProductsLacking}), no other building of the seat is a source of that good
 * (a standing maker, or a site that does not itself lack it), and the seat's free stock of it, what no
 * site holds and no upgrade keeps aside, falls short of what the site lacks. Cancelling it gives the
 * workshop back to make the good.
 */
export function starvedUpgrade(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  sites: readonly Entity[],
): Entity | null {
  const index = contentIndex(ctx.content);
  let aside: Map<number, number> | undefined;
  const sourced = (site: Entity, good: number): boolean =>
    owned.some(
      (e) =>
        e !== site &&
        makes(index.buildings.get(world.get(e, Building).buildingType), good) &&
        (!world.has(e, UnderConstruction) || !ownProductsLacking(world, ctx, e).has(good)),
    );
  for (const site of sites) {
    if (!world.has(site, Upgrading)) continue;
    for (const [good, lacking] of ownProductsLacking(world, ctx, site)) {
      if (sourced(site, good)) continue;
      aside ??= setAside(world, owned);
      const free = seatStockOf(world, player).units(good) - (aside.get(good) ?? 0);
      if (free < lacking) return site;
    }
  }
  return null;
}
