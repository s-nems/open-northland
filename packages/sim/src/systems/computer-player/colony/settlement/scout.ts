import { Building, Settler } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import { buildingTypeByContentId, goodTypeByContentId } from '../../../ai-shared/content-lookup.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import { isBuilt } from '../../../ai-shared/seat-roster.js';
import { routeRegions } from '../../../footprint/index.js';
import { herdOf, wildStockOf } from '../../../livestock/index.js';
import { isScoutJob } from '../../../readviews/index.js';
import { playerSeesNode } from '../../../vision/gates.js';
import { HERD_PAIR } from '../../herd.js';
import {
  knownAnd,
  knownResourceTest,
  nearestLiveResource,
  reachableResourceTest,
  workableResourceTest,
} from '../../live-resources.js';
import { SCOUT_CATCH_RADIUS_NODES, type ScoutDanger, scoutBusy, scoutDanger } from '../../scout/index.js';
import { corridorSamples, signpostTargetAround } from '../../scout/signpost-coverage.js';
import type { ColonyEnv } from '../env.js';
import { LAND_GOOD_IDS } from '../land.js';
import type { FoundingRead } from './posts.js';

/** The animal farm whose herd the colony's scout rounds up. */
const ANIMAL_FARM_ID = 'work_animal_farm';

/** The nearest known deposit of each good the land holds: a flag stands only inside the signposts, so a
 *  deposit past the store's walk range stays out of work until the lattice reaches it. */
function depositsOf(env: ColonyEnv, origin: HalfCellNode): HalfCellNode[] {
  const { world, ctx, terrain, seat } = env;
  const workable = workableResourceTest(world, ctx, terrain);
  const reachable = reachableResourceTest(world, ctx, terrain, origin, workable);
  const known = knownAnd(knownResourceTest(world, ctx, seat), reachable);
  return LAND_GOOD_IDS.flatMap((id) => {
    const good = goodTypeByContentId(ctx.content, id);
    const near = good === undefined ? null : nearestLiveResource(world, good.typeId, origin, known);
    return near === null ? [] : (anchorNodeOf(world, near) ?? []);
  });
}

/** The animals a colony's farm holds before its scout stops rounding up wild ones (authored): two breeding
 *  pairs, so one lost leaves the farm breeding. */
const COLONY_HERD = 2 * HERD_PAIR;

/** The wild animal the colony's scout rounds up next (owner ruling: husbandry where the scout can capture
 *  animals), or null: while an animal farm stands there short of {@link COLONY_HERD}, the ownerless one he
 *  sees on its land within his catch reach of `read`'s origin, out of enemy reach and routable from the
 *  origin, nearest him, the lowest id on a tie. A claimed animal joins a farm on its own land. Cost: the
 *  livestock, only while such a farm is short. */
function herdToClaim(env: ColonyEnv, scout: Entity, read: FoundingRead): Entity | null {
  const { world, ctx, terrain, seat } = env;
  const farm = buildingTypeByContentId(ctx.content, ANIMAL_FARM_ID);
  const farms = read.buildings.filter(
    (e) => world.get(e, Building).buildingType === farm?.typeId && isBuilt(world, e),
  );
  const held = farms.reduce((sum, e) => sum + herdOf(world, e).length, 0);
  const at = anchorNodeOf(world, scout);
  if (farms.length === 0 || held >= COLONY_HERD || at === null) return null;
  const from = terrain.nodeAtClamped(read.origin.hx, read.origin.hy);
  const regions = routeRegions(world, ctx, terrain);
  const sealed = regions.pocketed(from) ? null : regions;
  let danger: ScoutDanger | null = null;
  let best: { readonly animal: Entity; readonly distance: number } | null = null;
  for (const animal of wildStockOf(world)) {
    const node = anchorNodeOf(world, animal);
    if (node === null || !terrain.inBounds(node.hx, node.hy)) continue;
    const cell = terrain.nodeAt(node.hx, node.hy);
    if (terrain.componentOf(cell) !== env.colony.land) continue;
    if (nodeManhattan(node, read.origin) > SCOUT_CATCH_RADIUS_NODES) continue;
    if (!playerSeesNode(ctx.fog, seat, node.hx, node.hy)) continue;
    danger ??= scoutDanger(world, ctx, seat);
    if (danger.covers(node.hx, node.hy) || sealed?.unroutable(from, cell) === true) continue;
    const distance = nodeManhattan(node, at);
    if (best === null || distance < best.distance || (distance === best.distance && animal < best.animal))
      best = { animal, distance };
  }
  return best?.animal ?? null;
}

/** The colony's one scout rounds up its farm's herd ({@link herdToClaim}), else carries its lattice round
 *  what stands there and out to its land's deposits. */
export function raiseSignposts(env: ColonyEnv, men: readonly Entity[], read: FoundingRead): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const scout = men.find((e) => isScoutJob(ctx.content, world.get(e, Settler).jobType));
  if (scout === undefined || read.store === null || scoutBusy(world, ctx, scout)) return [];
  const animal = herdToClaim(env, scout, read);
  if (animal !== null) return [{ kind: 'claimAnimal', entity: scout, animal }];
  const buildings = read.buildings.flatMap((e) => anchorNodeOf(world, e) ?? []);
  const corridors = depositsOf(env, read.origin).map((at) => corridorSamples(read.origin, at));
  const from = anchorNodeOf(world, scout);
  const post = signpostTargetAround(world, ctx, seat, read.store, buildings, corridors, from);
  return post === null ? [] : [{ kind: 'placeSignpost', entity: scout, x: post.hx, y: post.hy }];
}
