import { type BriefSeatStart, Building, MAX_PLAYERS } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import { NO_COMPONENT, type TerrainGraph } from '../../../../nav/terrain/index.js';
import { everyBuildingOf, everySettlerOf } from '../../../ai-shared/home-roster.js';
import { anchorCentroid, anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../../context.js';
import { interactionCell } from '../../../settlers/targets/index.js';
import { seatBaseOf } from '../../base.js';

/**
 * Where every player slot holding buildings or settlers starts: the interaction node of the base the
 * economy anchors on ({@link seatBaseOf}), else the centroid of its settlers. Read for every seat, human
 * or computer, since a computer seat knows every start layout.
 */
export function scanSeatStarts(world: World, ctx: SystemContext, terrain: TerrainGraph): BriefSeatStart[] {
  const seats: BriefSeatStart[] = [];
  for (let player = 0; player < MAX_PLAYERS; player++) {
    const buildings = everyBuildingOf(world, player);
    const settlers = everySettlerOf(world, player);
    if (buildings.length === 0 && settlers.length === 0) continue;
    const anchor = startAnchor(world, ctx, terrain, player, settlers.length > 0 ? settlers : buildings);
    if (anchor === null) continue;
    const start: BriefSeatStart = {
      player,
      hx: anchor.hx,
      hy: anchor.hy,
      component: terrain.componentOf(terrain.nodeAt(anchor.hx, anchor.hy)),
      buildings: [],
    };
    for (const e of buildings) {
      const node = anchorNodeOf(world, e);
      if (node === null) continue;
      start.buildings.push({
        entity: e,
        buildingType: world.get(e, Building).buildingType,
        hx: node.hx,
        hy: node.hy,
      });
    }
    seats.push(start);
  }
  return seats;
}

/** The start's anchor node on the map, or null for a seat with nothing positioned. Without a base it is
 *  the centroid of `members` (its settlers, or its buildings while it has none); one falling on ground no one
 *  walks moves to the lowest-id of them standing on a land component. */
function startAnchor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  members: readonly Entity[],
): HalfCellNode | null {
  const base = seatBaseOf(world, ctx, player);
  if (base !== null) {
    const door = interactionCell(world, ctx, terrain, base);
    return { hx: terrain.xOf(door), hy: terrain.yOf(door) };
  }
  const centre = anchorCentroid(world, members);
  if (centre === null) return null;
  const clamped = { hx: terrain.clampX(centre.hx), hy: terrain.clampY(centre.hy) };
  if (terrain.componentOf(terrain.nodeAt(clamped.hx, clamped.hy)) !== NO_COMPONENT) return clamped;
  for (const e of members) {
    const node = anchorNodeOf(world, e);
    if (node === null || !terrain.inBounds(node.hx, node.hy)) continue;
    if (terrain.componentOf(terrain.nodeAt(node.hx, node.hy)) !== NO_COMPONENT) return node;
  }
  return clamped;
}
