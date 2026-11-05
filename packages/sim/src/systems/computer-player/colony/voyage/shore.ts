import { playerPlacementTribes } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import { goodTypeByContentId } from '../../../ai-shared/content-lookup.js';
import { placementBlockerGrid } from '../../../footprint/placement/blocker-grid.js';
import { VEHICLE_CARGO_SEARCH_RADIUS } from '../../../settlers/drives/economy/vehicle-cargo.js';
import { fishSwarmsNearNode } from '../../../spatial/fish.js';
import {
  knownAnd,
  knownResourceTest,
  liveResourceWithin,
  reachableResourceTest,
  workableResourceTest,
} from '../../live-resources.js';
import { believedLand, underFire } from '../../military/operations/landing-target.js';
import { shorePoints } from '../../sea-route.js';
import type { ColonyEnv } from '../env.js';
import { LAND_GOOD_IDS } from '../land.js';
import { colonySpot, type FarGround } from '../spot.js';
import { colonyStoreType } from '../store-type.js';
import { homesFitNear } from './room.js';

/** The shores a site's fire test keeps, nearest the site first (authored): spaced ten nodes apart, these span
 *  about the block's coast, so {@link shoreWithStore} has real choices to weigh. */
const SHORE_CANDIDATES = 12;

/** The shores `ship` may land at on the site's land: the spots no believed tower or shelter reaches,
 *  nearest the site first, spaced as {@link shorePoints} spaces them. */
export function colonyShores(env: ColonyEnv, ship: Entity, land: number, site: HalfCellNode): HalfCellNode[] {
  const { world, ctx, terrain } = env;
  const fire = believedLand(env, land).sources;
  const clear = (at: HalfCellNode): boolean => !underFire(fire, at);
  return shorePoints(world, ctx, terrain, ship, land, site, clear, SHORE_CANDIDATES);
}

/** How far round a shore its colony's first buildings and gatherers look, in Manhattan nodes (authored: the
 *  store's walk range). */
const SHORE_LOOK_NODES = 50;

/** Sampling step of a shore's open ground, so its open count costs a few hundred node reads; the room for
 *  homes beside it ({@link homesFitNear}) costs a placement probe per lattice node of the same diamond, up to
 *  about thirteen hundred, until {@link SHORE_HOMES_FULL} fit. */
const SHORE_LOOK_STEP = 3;

/** A shore's score per {@link LAND_GOOD_IDS} good in reach and per live swarm, against one per open node
 *  sampled: a good nobody can reach costs a colony more than a corner of room (authored). */
const SHORE_GOOD_POINTS = 60;

/** A shore's score per home that fits in its look (owner ruling: free room for homes, workshops and towers
 *  weighs heavily): worth more than a good in reach, so a cramped cove loses to a roomy shore (authored). */
const SHORE_HOME_POINTS = 100;

/** The homes past which a shore's room gains nothing (authored): a colony's homes and its industries'
 *  room. */
const SHORE_HOMES_FULL = 12;

const SHORE_FISH_POINTS = 20;

const SHORE_GRASS_DIVISOR = 8;

/** How far from its landing shore a colony's first warehouse may stand, in Manhattan nodes (owner ruling:
 *  fairly close, so the trader's helpers and the unloading walk little): the reach of a hold's hands, who
 *  carry cargo into a warehouse only that near the door. */
export const STORE_SHORE_NODES = VEHICLE_CARGO_SEARCH_RADIUS;

const AHEAD_OF_LANDING: FarGround = { ahead: true };

/** How a shore serves a colony (owner ruling): room for homes round the warehouse spot it gives first, then
 *  open ground, resources in gatherers' reach, grass and fish round the shore. */
export function shoreScore(
  env: ColonyEnv,
  land: number,
  at: HalfCellNode,
  store: HalfCellNode,
  tribe: number,
): number {
  const { world, ctx, terrain, seat } = env;
  const homes = homesFitNear(world, ctx, terrain, tribe, land, store, SHORE_LOOK_NODES, SHORE_HOMES_FULL);
  const grid = placementBlockerGrid(world, ctx.content, terrain);
  let open = 0;
  let grass = 0;
  for (let dy = -SHORE_LOOK_NODES; dy <= SHORE_LOOK_NODES; dy += SHORE_LOOK_STEP) {
    const span = SHORE_LOOK_NODES - Math.abs(dy);
    for (let dx = -span; dx <= span; dx += SHORE_LOOK_STEP) {
      const x = at.hx + dx;
      const y = at.hy + dy;
      if (!terrain.inBounds(x, y)) continue;
      const node = terrain.nodeAt(x, y);
      if (terrain.componentOf(node) !== land || !terrain.isBuildable(node)) continue;
      if ((grid.obstacle[node] ?? 0) === 0) open++;
      if (terrain.isPlantable(node)) grass++;
    }
  }
  // A deposit counts on the shore's own land and known to the seat: one over the water is no gatherer's.
  const reachable = reachableResourceTest(world, ctx, terrain, at, workableResourceTest(world, ctx, terrain));
  const known = knownAnd(knownResourceTest(world, ctx, seat), reachable);
  const goods = LAND_GOOD_IDS.filter((id) => {
    const good = goodTypeByContentId(ctx.content, id);
    return good !== undefined && liveResourceWithin(world, good.typeId, at, SHORE_LOOK_NODES, known);
  }).length;
  const fish = fishSwarmsNearNode(world, at.hx, at.hy, SHORE_LOOK_NODES).length;
  return (
    SHORE_HOME_POINTS * homes +
    open +
    Math.floor(grass / SHORE_GRASS_DIVISOR) +
    SHORE_GOOD_POINTS * goods +
    SHORE_FISH_POINTS * fish
  );
}

/** The best of `shores` with room for a store within {@link STORE_SHORE_NODES}, its room counted round the
 *  nearest such spot, where the founding places the store. The first best on a tie. Null also for a seat
 *  with no tribe or a content with no store. Judged before the party lands, so without the site reach: the
 *  store is placed once its people stand on the shore, well inside their reach. */
export function shoreWithStore(
  env: ColonyEnv,
  land: number,
  shores: readonly HalfCellNode[],
): HalfCellNode | null {
  const { world, ctx, seat } = env;
  const tribe = playerPlacementTribes(world, seat)?.[0];
  const type = colonyStoreType(world, ctx, seat);
  if (tribe === undefined || type === undefined) return null;
  let best: HalfCellNode | null = null;
  let bestScore = -1;
  for (const at of shores) {
    const store = colonySpot(env, land, type, tribe, at, STORE_SHORE_NODES, 'any', AHEAD_OF_LANDING);
    if (store === null) continue;
    const score = shoreScore(env, land, at, store, tribe);
    if (score <= bestScore) continue;
    best = at;
    bestScore = score;
  }
  return best;
}
