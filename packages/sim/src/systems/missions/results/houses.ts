import { Building, MAX_BUILDING_LEVEL, ownerOf, Position } from '../../../components/index.js';
import { buildingLevelOf, type ContentIndex, contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistance, nodeOfPosition } from '../../../nav/halfcell.js';
import { assembleBuilding, placeBuilding } from '../../command/placement.js';
import type { SystemContext } from '../../context.js';
import { clearUpgradeGround } from '../../economy/upgrade-ground.js';
import { placementProbe } from '../../footprint/index.js';
import { removeBuildingSilently } from '../../lifecycle/cleanup.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';
import { missionHouses } from '../targets.js';

/** How far from its point a `SetHouse` looks for ground its footprint fits (reading). */
const HOUSE_SEARCH_RANGE = 12;

/** How many houses one `SetHouseExtensionLevel` rebuilds (reading). */
const EXTENSION_LEVEL_CAP = 10;

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
  const spot = nearestBuildableSpot(world, ctx, typeId, tribe, op.point);
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
    underConstruction: !op.built,
    force: true,
    missionId: op.objectId,
  });
}

/**
 * Original behavior: each house stamped with the id, up to {@link EXTENSION_LEVEL_CAP}, is removed and set
 * again on its anchor, finished at the new level with the same owner and id; its workers, residents and
 * stock go with the old house. A level the type's chain cannot reach fails the line.
 */
export function setScriptedHouseLevel(
  pass: MissionPass,
  mission: number,
  op: Extract<MissionResultOp, { opcode: 'SetHouseExtensionLevel' }>,
): void {
  const { world, ctx } = pass;
  const index = contentIndex(ctx.content);
  for (const e of missionHouses(world, op.objectId).slice(0, EXTENSION_LEVEL_CAP)) {
    const typeId = typeAtLevel(index, world.get(e, Building).buildingType, op.amount);
    if (typeId === undefined) {
      pass.reportFailed(mission, op.opcode);
      continue;
    }
    rebuildAtLevel(world, ctx, e, typeId, op.amount, op.objectId);
  }
}

/** The type that draws `level` on `typeId`'s chain: a chain rung holds the levels from its own up to the
 *  top its `[GfxHouse]` record draws, and a wonder holds all of them on one type. */
function typeAtLevel(index: ContentIndex, typeId: number, level: number): number | undefined {
  if (level < 0 || level > MAX_BUILDING_LEVEL) return undefined;
  let at = typeId;
  for (let steps = 0; steps < MAX_BUILDING_LEVEL; steps++) {
    const above = index.commandBuildings.get(at)?.upgradeTarget;
    if (level <= topLevelOf(index, at) || above === undefined) break;
    at = above;
  }
  for (let steps = 0; steps < MAX_BUILDING_LEVEL; steps++) {
    const below = index.buildingLevelBelow.get(at);
    if (level >= buildingLevelOf(index, at) || below === undefined) break;
    at = below;
  }
  const holds = level >= buildingLevelOf(index, at) && level <= topLevelOf(index, at);
  return holds && index.commandBuildings.has(at) ? at : undefined;
}

function topLevelOf(index: ContentIndex, typeId: number): number {
  return Math.max(buildingLevelOf(index, typeId), index.buildingTopLevel.get(typeId) ?? 0);
}

/** Replace `e` with a finished `typeId` house at `level` on the same anchor. */
function rebuildAtLevel(
  world: World,
  ctx: SystemContext,
  e: Entity,
  typeId: number,
  level: number,
  missionId: number,
): void {
  const type = contentIndex(ctx.content).commandBuildings.get(typeId);
  if (type === undefined) return;
  const { tribe } = world.get(e, Building);
  const anchor = world.get(e, Position);
  const { hx, hy } = nodeOfPosition(anchor.x, anchor.y);
  const owner = ownerOf(world, e);
  // A larger body takes the walls and roads under it, as a finished upgrade does.
  clearUpgradeGround(world, ctx, e, typeId);
  removeBuildingSilently(world, ctx, e);
  const rebuilt = assembleBuilding(world, ctx, type, {
    buildingType: typeId,
    tribe,
    owner,
    missionId,
    x: hx,
    y: hy,
    underConstruction: false,
    fillStock: false,
  });
  world.mut(rebuilt, Building).level = level;
}

/** The buildable node nearest `point`, ties going to the lower node id; null when the whole band is
 *  blocked. A world with no terrain takes the point as written. */
function nearestBuildableSpot(
  world: World,
  ctx: SystemContext,
  buildingType: number,
  tribe: number,
  point: HalfCellNode,
): HalfCellNode | null {
  const terrain = ctx.terrain;
  if (terrain === undefined) return point;
  // A scripted house has no seat, so every signpost blocks it.
  const probe = placementProbe(world, ctx.content, terrain, buildingType, tribe, []);
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
