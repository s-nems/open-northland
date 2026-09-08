import { Building, Health } from '../../../components/index.js';
import { type ContentIndex, contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistance } from '../../../nav/halfcell.js';
import { placeBuilding } from '../../command/placement.js';
import type { SystemContext } from '../../context.js';
import { placementProbe } from '../../footprint/index.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';
import { missionHouses } from '../targets.js';

/** How far from its point a `SetHouse` looks for ground its footprint fits (reading). */
const HOUSE_SEARCH_RANGE = 12;

/** How many houses one `SetHouseExtensionLevel` rebuilds (reading). */
const EXTENSION_LEVEL_CAP = 10;

/** The longest growth chain the shipped houses declare is five levels; the walk stops here rather
 *  than trusting a script's level column or a content set with a cyclic `upgradeTarget`. */
const MAX_BUILDING_LEVEL = 16;

/**
 * Place a house at the nearest spot its footprint fits within {@link HOUSE_SEARCH_RANGE} of the
 * line's point, finished or as a construction site. The tech gate does not apply: a script places
 * what the map author wrote, whatever the player has unlocked.
 */
export function placeScriptedHouse(
  pass: MissionPass,
  mission: number,
  op: Extract<MissionResultOp, { opcode: 'SetHouse' }>,
): void {
  const { world, ctx } = pass;
  const { typeId, tribe } = op.houseName;
  if (!contentIndex(ctx.content).commandBuildings.has(typeId)) {
    pass.reportFailed(mission, op.opcode); // the map named a house its own content does not declare
    return;
  }
  const spot = nearestBuildableSpot(world, ctx, typeId, op.point);
  if (spot === null) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  placeBuilding(world, ctx, {
    kind: 'placeBuilding',
    buildingType: typeId,
    tribe,
    x: spot.hx,
    y: spot.hy,
    owner: op.player,
    underConstruction: op.asSite,
    force: true,
    missionId: op.objectId,
  });
}

/** Rebuild the houses stamped with the id at another growth level, in place: the plot, the owner and
 *  everyone bound to the house stay, only its type and life pool move up or down the chain. */
export function setScriptedHouseLevel(pass: MissionPass, id: number, level: number): void {
  const index = contentIndex(pass.ctx.content);
  for (const e of missionHouses(pass.world, id).slice(0, EXTENSION_LEVEL_CAP)) {
    rebuildAtLevel(pass.world, index, e, level);
  }
}

function rebuildAtLevel(world: World, index: ContentIndex, e: Entity, level: number): void {
  const wanted = Math.min(Math.max(level, 0), MAX_BUILDING_LEVEL);
  let typeId = world.get(e, Building).buildingType;
  // The stored level does not answer this: every placement is stamped level 0, whatever rung of the
  // chain its type sits on, so the chain itself is what says where the house currently stands.
  let at = levelOfType(index, typeId);
  for (; at < wanted; at++) {
    const above = index.commandBuildings.get(typeId)?.upgradeTarget;
    if (above === undefined) return; // the chain tops out below the level the script asked for
    typeId = above;
  }
  for (; at > wanted; at--) {
    const below = index.buildingLevelBelow.get(typeId);
    if (below === undefined) return;
    typeId = below;
  }
  const type = index.commandBuildings.get(typeId);
  if (type === undefined) return;
  const building = world.mut(e, Building);
  building.buildingType = typeId;
  building.level = at;
  const max = type.hitpoints;
  if (max === undefined) {
    world.remove(e, Health); // the new level carries no life pool, so the house cannot be besieged
    return;
  }
  const held = world.tryGet(e, Health)?.hitpoints ?? max;
  world.add(e, Health, { hitpoints: Math.min(held, max), max });
}

/** How many rungs a type sits above the root of its growth chain. */
function levelOfType(index: ContentIndex, typeId: number): number {
  let level = 0;
  let at = typeId;
  while (level < MAX_BUILDING_LEVEL) {
    const below = index.buildingLevelBelow.get(at);
    if (below === undefined) return level;
    at = below;
    level++;
  }
  return level;
}

/** The buildable node nearest `point`, ties going to the lower node id; null when the whole band is
 *  blocked. A world with no terrain takes the point as written. */
function nearestBuildableSpot(
  world: World,
  ctx: SystemContext,
  buildingType: number,
  point: HalfCellNode,
): HalfCellNode | null {
  const terrain = ctx.terrain;
  if (terrain === undefined) return point;
  const probe = placementProbe(world, ctx.content, terrain, buildingType);
  let best: HalfCellNode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  // A column step never costs less than a row step, so every node in range fits this square.
  for (let hy = point.hy - HOUSE_SEARCH_RANGE; hy <= point.hy + HOUSE_SEARCH_RANGE; hy++) {
    for (let hx = point.hx - HOUSE_SEARCH_RANGE; hx <= point.hx + HOUSE_SEARCH_RANGE; hx++) {
      const distance = hexDistance(point, { hx, hy });
      if (distance > HOUSE_SEARCH_RANGE || distance >= bestDistance) continue;
      if (!terrain.inBounds(hx, hy) || !probe.canPlace(hx, hy)) continue;
      best = { hx, hy };
      bestDistance = distance;
    }
  }
  return best;
}
