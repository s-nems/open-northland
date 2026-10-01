import { BUILDING_KIND } from '@open-northland/data';
import { AI_REBUILD_LIST_LIMIT, type AiHouseRecord, Building, Settler } from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import { buildingLevelOf, type ContentIndex, contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { type SpotAcceptor, spotAcceptor } from '../ai-player/build-order/placement.js';
import {
  enemyFire,
  enemyPosts,
  nearestRaiderWithin,
  type Raider,
} from '../ai-player/military/defence/threat.js';
import { anchorNodeOf, bestRingNode } from '../ai-player/node-geometry.js';
import { isBuilt, ownedBuildings, ownedSettlers } from '../ai-player/seat-roster.js';
import type { SystemContext } from '../context.js';
import { buildingEnabled } from '../progression/availability.js';
import { isFighterJob } from '../readviews/index.js';
import { entityNode } from '../spatial/nodes.js';

/** How far from its old anchor a remembered building may stand, or be raised again, in map points.
 *  Original behavior. */
export const REBUILD_RADIUS_POINTS = 12;
/** Unfinished buildings past which the handler raises nothing more. Original behavior. */
export const REBUILD_SITE_LIMIT = 3;
/** How close an enemy fighter keeps a site from going up, and how close one of the seat's civilians must
 *  stand to it, in map points. Original behavior (the enemy test also counts vehicles there). */
export const REBUILD_NEAR_POINTS = 40;

/** The seat's buildings as its first handler turn finds them, the first {@link AI_REBUILD_LIST_LIMIT}. */
export function rebuildList(world: World, ctx: SystemContext, seat: number): AiHouseRecord[] {
  const houses: AiHouseRecord[] = [];
  for (const e of townBuildings(world, contentIndex(ctx.content), ownedBuildings(world, seat))) {
    const anchor = anchorNodeOf(world, e);
    if (anchor === null) continue;
    const { buildingType, tribe } = world.get(e, Building);
    houses.push({ buildingType, tribe, hx: anchor.hx, hy: anchor.hy });
    if (houses.length === AI_REBUILD_LIST_LIMIT) break;
  }
  return houses;
}

/**
 * Raise again each remembered building of whose upgrade line nothing stands near its old spot: a site on
 * the nearest free spot within {@link REBUILD_RADIUS_POINTS}, unless an enemy is near it or none of the
 * seat's civilians is near enough to build it, while fewer than {@link REBUILD_SITE_LIMIT} of the seat's
 * buildings are unfinished. A tier with no construction cost (the headquarters) is never raised. Original
 * behavior, with these departures:
 *
 * - Each standing building answers for one remembered building, the one on its own anchor first, so a
 *   razed home among others is raised again; the original counts any building of the line within the
 *   radius as the remembered one standing.
 * - A spot inside enemy tower fire is refused.
 * - The site is the highest tier at or below the remembered one the seat may place; the original raises
 *   the remembered tier directly, past the tech gates.
 */
export function rebuildOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  seat: number,
  houses: readonly AiHouseRecord[],
  raiders: readonly Raider[],
): PlayerCommand[] {
  const people = ownedSettlers(world, seat).filter(
    (e) => !isFighterJob(ctx.content, world.get(e, Settler).jobType),
  );
  if (houses.length === 0 || people.length === 0) return [];
  const index = contentIndex(ctx.content);
  const owned = townBuildings(world, index, ownedBuildings(world, seat));
  let unfinished = owned.filter((e) => !isBuilt(world, e)).length;
  if (unfinished >= REBUILD_SITE_LIMIT) return [];
  const lost = lostHouses(world, index, owned, houses);
  if (lost.length === 0) return [];
  const crew = people.map((e) => terrain.coordsOf(entityNode(world, terrain, e)));
  const crewWithin = (x: number, y: number, radius: number): boolean =>
    crew.some((at) => hexDistanceBetween(at.x, at.y, x, y) <= radius);
  const fire = enemyFire([...raiders, ...enemyPosts(world, ctx, terrain, seat)]);
  // One acceptor per type and tribe: each walks every building of the world to set up.
  const acceptors = new Map<string, SpotAcceptor>();
  const commands: PlayerCommand[] = [];
  for (const house of lost) {
    // Cheap tests first: a seat beaten back from its old ground, or one with a raider standing on it,
    // pays no spot search for each lost house. A raider this near the old anchor is near every spot.
    if (!crewWithin(house.hx, house.hy, REBUILD_NEAR_POINTS + REBUILD_RADIUS_POINTS)) continue;
    const nearAnywhere = REBUILD_NEAR_POINTS - REBUILD_RADIUS_POINTS;
    if (nearestRaiderWithin(raiders, house.hx, house.hy, nearAnywhere, null) !== null) continue;
    const buildingType = placeableTier(world, ctx, index, seat, house);
    if (buildingType === null) continue;
    const key = `${buildingType}:${house.tribe}`;
    let acceptor = acceptors.get(key);
    if (acceptor === undefined) {
      acceptor = spotAcceptor(world, ctx, terrain, seat, buildingType, house.tribe);
      acceptors.set(key, acceptor);
    }
    const centre = { hx: house.hx, hy: house.hy };
    const accept = acceptor.around(fire, centre, REBUILD_RADIUS_POINTS);
    const spot = bestRingNode(house.hx, house.hy, REBUILD_RADIUS_POINTS, () => 0, accept);
    if (spot === null) continue;
    if (nearestRaiderWithin(raiders, spot.hx, spot.hy, REBUILD_NEAR_POINTS, null) !== null) continue;
    if (!crewWithin(spot.hx, spot.hy, REBUILD_NEAR_POINTS)) continue;
    commands.push({
      kind: 'placeBuilding',
      buildingType,
      x: spot.hx,
      y: spot.hy,
      tribe: house.tribe,
      owner: seat,
      underConstruction: true,
    });
    if (++unfinished >= REBUILD_SITE_LIMIT) break;
  }
  return commands;
}

/** The remembered buildings no standing building of their line answers for, in list order: each standing
 *  one is matched to the record on its own anchor first, then to the nearest record within
 *  {@link REBUILD_RADIUS_POINTS}. */
function lostHouses(
  world: World,
  index: ContentIndex,
  owned: readonly Entity[],
  houses: readonly AiHouseRecord[],
): AiHouseRecord[] {
  const open = houses.map((house) => ({ house, line: lineOf(index, house.buildingType), matched: false }));
  const unmatched: { line: number; hx: number; hy: number }[] = [];
  for (const e of owned) {
    const at = anchorNodeOf(world, e);
    if (at === null) continue;
    const line = lineOf(index, world.get(e, Building).buildingType);
    const own = open.find(
      (r) => !r.matched && r.line === line && r.house.hx === at.hx && r.house.hy === at.hy,
    );
    if (own === undefined) unmatched.push({ line, ...at });
    else own.matched = true;
  }
  for (const b of unmatched) {
    let best: (typeof open)[number] | undefined;
    let bestDistance = REBUILD_RADIUS_POINTS + 1;
    for (const r of open) {
      if (r.matched || r.line !== b.line) continue;
      const distance = hexDistanceBetween(r.house.hx, r.house.hy, b.hx, b.hy);
      if (distance < bestDistance) {
        best = r;
        bestDistance = distance;
      }
    }
    if (best !== undefined) best.matched = true;
  }
  return open.filter((r) => !r.matched).map((r) => r.house);
}

/** The buildings of `owned` the town raises and remembers: a workshop's vehicle yard is its crew's own
 *  work and leaves as a vehicle once built, so it is never a lost building. */
function townBuildings(world: World, index: ContentIndex, owned: readonly Entity[]): Entity[] {
  return owned.filter(
    (e) => index.buildings.get(world.get(e, Building).buildingType)?.kind !== BUILDING_KIND.vehicle,
  );
}

/** The first tier of `typeId`'s upgrade line, which names the line. */
function lineOf(index: ContentIndex, typeId: number): number {
  let at = typeId;
  for (let level = buildingLevelOf(index, typeId); level > 0; level--) {
    at = index.buildingLevelBelow.get(at) ?? at;
  }
  return at;
}

/** The highest tier at or below the remembered one that has a construction cost and the seat may place,
 *  or null. */
function placeableTier(
  world: World,
  ctx: SystemContext,
  index: ContentIndex,
  seat: number,
  house: AiHouseRecord,
): number | null {
  let at: number | undefined = house.buildingType;
  // Bounded by the line's own length, so a looping chain cannot hang it.
  for (let tiers = buildingLevelOf(index, house.buildingType); at !== undefined && tiers >= 0; tiers--) {
    const type = index.buildings.get(at);
    if (
      type !== undefined &&
      type.construction.length > 0 &&
      buildingEnabled(world, ctx, seat, house.tribe, at)
    ) {
      return at;
    }
    at = index.buildingLevelBelow.get(at);
  }
  return null;
}
