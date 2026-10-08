import { ownerOf, Position, Stockpile, UnderConstruction } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { interactionNodeId } from '../footprint/interaction.js';
import { FetchableStock } from '../settlers/targets/stores/fetchable-stock.js';
import { spotsReaching } from '../signposts/index.js';
import { collectSupplyTally, constructionBillOf } from '../stores/index.js';

/** Own stores of a good one diagnosis tests for reach before it stops calling the case decided. */
export const MAX_DIAGNOSTIC_STORES = 128;

/** One bill line a site still lacks. */
export interface ConstructionShortfall {
  readonly goodType: number;
  readonly required: number;
  /** Units on site. */
  readonly delivered: number;
  /** Units some settler is bringing it. */
  readonly inbound: number;
  /** Whether a store the site's owner owns lends a unit from where a builder could carry it to the site:
   *  within the site's signpost reach, or anywhere while nothing confines builders. A neutral pile, a
   *  felled trunk in a far wood say, and an own store beyond the signposts count as nothing: a builder
   *  minds its own network alone, and such a shortfall is the player's to fix (owner ruling). A good the
   *  owner holds in more stores than the diagnosis tests for reach counts as held. */
  readonly held: boolean;
}

/** A site's supply, for the note about a site short of a material. */
export type ConstructionSupply =
  | { readonly kind: 'short'; readonly shortfalls: readonly ConstructionShortfall[] }
  | { readonly kind: 'covered' };

/**
 * What `site`'s bill still lacks, on site and on its way, and whether its side holds each missing good
 * in reach; `covered` once every line is on site or inbound. Undefined for anything but an unfinished
 * building, wall or road site. Derived on demand, never read by the planner.
 */
export function constructionSupply(
  world: World,
  ctx: SystemContext,
  site: Entity,
): ConstructionSupply | undefined {
  if (!world.isAlive(site) || !world.has(site, UnderConstruction) || !world.has(site, Position)) {
    return undefined;
  }
  const supply = collectSupplyTally(world);
  const stock = FetchableStock.of(world, ctx);
  const owner = ownerOf(world, site);
  const onSite = world.tryGet(site, Stockpile)?.amounts;
  const reach = builderReachTo(world, ctx, site, owner);
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
      held: sideHolds(world, ctx, stock, owner, line.goodType, reach),
    });
  }
  return shortfalls.length === 0 ? { kind: 'covered' } : { kind: 'short', shortfalls };
}

/** Where a store must stand for a builder to carry its load to `site`, or null when nothing confines
 *  builders: the reverse of the confinement a builder of `owner` carries, around the site's door or, for
 *  a wall or road site, its own node. */
function builderReachTo(
  world: World,
  ctx: SystemContext,
  site: Entity,
  owner: number | undefined,
): ((cell: NodeId) => boolean) | null {
  const terrain = ctx.terrain;
  if (terrain === undefined || owner === undefined) return null;
  const builderJob = builderJobType(ctx);
  if (builderJob === undefined) return null;
  const goal = interactionNodeId(world, ctx, terrain, site) ?? ownNode(world, terrain, site);
  if (goal === null) return null;
  const spots = spotsReaching(world, ctx.content, terrain, builderJob, owner, [goal]);
  return spots === null ? null : (cell) => spots(terrain.xOf(cell), terrain.yOf(cell));
}

/** The content's builder trade, whose walk range sets a site's reach; undefined without one. */
function builderJobType(ctx: SystemContext): number | undefined {
  for (const [typeId, job] of contentIndex(ctx.content).jobs) {
    if (job.id === 'builder') return typeId;
  }
  return undefined;
}

function sideHolds(
  world: World,
  ctx: SystemContext,
  stock: FetchableStock,
  owner: number | undefined,
  goodType: number,
  reach: ((cell: NodeId) => boolean) | null,
): boolean {
  const terrain = ctx.terrain;
  // The ledger's per-owner total settles a bare side without a walk over other sides' holders.
  if (owner !== undefined && !stock.ownsAny(owner, goodType)) return false;
  let examined = 0;
  for (const store of stock.holders(goodType)) {
    if (ownerOf(world, store) !== owner) continue;
    if (reach === null || terrain === undefined) return true;
    if (++examined > MAX_DIAGNOSTIC_STORES) return true;
    const door = storeCell(world, ctx, terrain, store);
    if (door !== null && reach(door)) return true;
  }
  return false;
}

function storeCell(world: World, ctx: SystemContext, terrain: TerrainGraph, store: Entity): NodeId | null {
  return interactionNodeId(world, ctx, terrain, store) ?? ownNode(world, terrain, store);
}

function ownNode(world: World, terrain: TerrainGraph, e: Entity): NodeId | null {
  const p = world.tryGet(e, Position);
  return p === undefined ? null : terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
}
