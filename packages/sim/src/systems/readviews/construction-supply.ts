import { Building, ownerOf, ownersCompatible, Stockpile, UnderConstruction } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { FetchableStock } from '../settlers/targets/stores/fetchable-stock.js';
import { collectSupplyTally, constructionBillOf } from '../stores/index.js';

/** Holders of a good one diagnosis weighs, any side, before it stops calling the case decided. */
const MAX_DIAGNOSTIC_STORES = 128;

/** One bill line a building site still lacks. */
export interface ConstructionShortfall {
  readonly goodType: number;
  readonly required: number;
  /** Units on site. */
  readonly delivered: number;
  /** Units some settler is bringing it. */
  readonly inbound: number;
  /** Whether a store the site's owner owns lends a unit, so the shortfall is the builders' errand rather
   *  than the player's. A neutral pile, a felled trunk in a far wood say, is no store the player keeps,
   *  so it does not count. Reach is not weighed: an own store beyond the signposts counts, and the
   *  builder's own lost-way note reports that case. A good with more holders than the diagnosis weighs
   *  counts as held. */
  readonly held: boolean;
}

/** A building site's supply, for the note about a site short of a material. */
export type ConstructionSupply =
  | { readonly kind: 'short'; readonly shortfalls: readonly ConstructionShortfall[] }
  | { readonly kind: 'covered' };

/**
 * What `site`'s bill still lacks, on site and on its way, and whether its side holds each missing good;
 * `covered` once every line is on site or inbound. Undefined for anything but a building site. Derived on
 * demand, never read by the planner.
 */
export function constructionSupply(
  world: World,
  ctx: SystemContext,
  site: Entity,
): ConstructionSupply | undefined {
  if (!world.isAlive(site) || !world.has(site, Building) || !world.has(site, UnderConstruction)) {
    return undefined;
  }
  const supply = collectSupplyTally(world);
  const stock = FetchableStock.of(world, ctx);
  const owner = ownerOf(world, site);
  const onSite = world.tryGet(site, Stockpile)?.amounts;
  const shortfalls: ConstructionShortfall[] = [];
  for (const line of constructionBillOf(world, ctx, site)) {
    const delivered = Math.max(onSite?.get(line.goodType) ?? 0, 0);
    const inbound = supply.inboundOf(site, line.goodType);
    if (delivered + inbound >= line.amount) continue;
    shortfalls.push({
      goodType: line.goodType,
      required: line.amount,
      delivered,
      inbound,
      held: sideHolds(world, stock, owner, line.goodType),
    });
  }
  return shortfalls.length === 0 ? { kind: 'covered' } : { kind: 'short', shortfalls };
}

function sideHolds(
  world: World,
  stock: FetchableStock,
  owner: number | undefined,
  goodType: number,
): boolean {
  let examined = 0;
  for (const store of stock.holders(goodType)) {
    if (ownerOf(world, store) === owner) return true;
    if (++examined >= MAX_DIAGNOSTIC_STORES) return true;
  }
  return false;
}
