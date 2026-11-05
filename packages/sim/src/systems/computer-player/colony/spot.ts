import type { BuildingType } from '@open-northland/data';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { bestRingNode } from '../../ai-shared/node-geometry.js';
import { routeRegions } from '../../footprint/index.js';
import { type NavigationLimit, networkLimitAt } from '../../signposts/index.js';
import { goodsSearchLimitAt } from '../../signposts/reach.js';
import { footprintOnGrass } from '../build-order/placement.js';
import { seatSpotAcceptor } from '../build-order/plots.js';
import { buildReach } from '../build-order/reach.js';
import { seatSiege } from '../build-order/siege.js';
import type { ColonyEnv } from './env.js';
import { colonyBuildings } from './roster.js';

/** The ground a step asks for: a farm's fields, a patch of grass, or any. */
export type StepGround = 'field' | 'grass' | 'any';

/** How far from what stands on the colony a building goes, in Manhattan nodes (authored): the walk range,
 *  so a colony with no signpost still reaches its next site. */
const COLONY_REACH_NODES = 50;

/** How far from the store and what stands a workshop may go (authored): observed on
 *  arabskie_wyspy_wolna_gra_mieszana, a colony's forest left an armory no spot within half this of its store
 *  and many beyond, its footprint being far larger than a home's. */
const WORKSHOP_SPOT_NODES = 100;

/** A search other than the walk range's: its reach of what stands, the signposts that make it walkable,
 *  the goods search of the store its builders fetch the bill from, and `ahead` for land the seat's people
 *  have not landed on, judged without the site reach their landing brings. */
export interface FarGround {
  readonly reachNodes?: number;
  readonly limit?: NavigationLimit | null;
  readonly supply?: NavigationLimit | null;
  readonly ahead?: boolean;
}

/** The goods search from the store at `at`: builders fetch a site's bill only from a store whose search
 *  takes in the site. Null where signposts are off. */
export function storeSupply(env: ColonyEnv, at: HalfCellNode): NavigationLimit | null {
  return goodsSearchLimitAt(env.world, env.ctx.content, env.terrain, env.seat, at.hx, at.hy);
}

/** The spot of a workshop handed over by home, which may lie past the walk range but inside the signposts'
 *  reach from `anchor`. */
export function workshopSpot(
  env: ColonyEnv,
  land: number,
  type: BuildingType,
  tribe: number,
  anchor: HalfCellNode,
): HalfCellNode | null {
  const limit = networkLimitAt(env.world, env.terrain, env.seat, anchor.hx, anchor.hy);
  const far = { reachNodes: WORKSHOP_SPOT_NODES, limit };
  return colonySpot(env, land, type, tribe, anchor, WORKSHOP_SPOT_NODES, 'any', far);
}

/**
 * The spot of `type` nearest `anchor`, a node on the colony's land, within `radius` of it and
 * {@link COLONY_REACH_NODES} of what stands there unless `far` widens it, on `land`, on ground the anchor's walkers reach and out of
 * every enemy shooter's reach; null when none. The home search reads the seat's base throughout, so this
 * is the colony's own over the same parts.
 */
export function colonySpot(
  env: ColonyEnv,
  land: number,
  type: BuildingType,
  tribe: number,
  anchor: HalfCellNode,
  radius: number,
  ground: StepGround = 'any',
  far?: FarGround,
): HalfCellNode | null {
  const { world, ctx, terrain, seat } = env;
  const owned = colonyBuildings(env);
  const reach = buildReach(world, owned, anchor, far?.reachNodes ?? COLONY_REACH_NODES);
  const { underFire } = seatSiege(world, ctx, terrain, seat, owned);
  const acceptor = seatSpotAcceptor(world, ctx, terrain, seat, type.typeId, tribe, far?.ahead !== true);
  const regions = routeRegions(world, ctx, terrain);
  const from = terrain.nodeAtClamped(anchor.hx, anchor.hy);
  const walled = regions.pocketed(from) ? null : regions;
  const search = (fits: (x: number, y: number) => boolean, spareGrass = false): HalfCellNode | null => {
    const accept = acceptor.around(underFire, anchor, radius, spareGrass);
    return bestRingNode(
      anchor.hx,
      anchor.hy,
      radius,
      () => 0,
      (x, y) =>
        terrain.inBounds(x, y) &&
        terrain.componentOf(terrain.nodeAt(x, y)) === land &&
        reach.contains(x, y) &&
        far?.limit?.allowsNode(terrain.nodeAt(x, y)) !== false &&
        far?.supply?.allowsNode(terrain.nodeAt(x, y)) !== false &&
        accept(x, y) &&
        fits(x, y) &&
        walled?.unroutable(from, terrain.nodeAt(x, y)) !== true,
    );
  };
  // Owner ruling: the grass stays for a farm and a well where anything else can stand off it.
  if (ground === 'any') return search(() => true, true) ?? search(() => true);
  if (ground === 'grass') return search(() => true);
  // A farm stands on its grass where it fits, else beside it, as the home search has it.
  return (
    search((x, y) => footprintOnGrass(ctx, terrain, type, tribe, x, y)) ??
    search((x, y) => acceptor.grassBeside(x, y))
  );
}
