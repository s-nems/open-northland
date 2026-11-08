import { Owner, RallyPoint } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { mintFlagMarker, relocateWorkFlag } from '../economy/work-flag.js';
import { nearestWorkFlagPlacement } from '../footprint/placement/work-flag/queries.js';
import { isBarracks } from '../readviews/index.js';
import { entityNode } from '../spatial/nodes.js';
import { WORK_FLAG_SNAP_MAX_RADIUS } from './work/selection.js';

/** `building`'s rally flag while its marker entity still exists; a stale binding reads as undefined. */
function liveRallyFlag(world: World, building: Entity): Entity | undefined {
  const rally = world.tryGet(building, RallyPoint);
  return rally !== undefined && world.isAlive(rally.flag) ? rally.flag : undefined;
}

/** The node the soldiers `barracks` trains walk to, or undefined while it has no rally point. Read off the
 *  flag, so a flag the placement rules pushed aside still names where it stands. */
export function rallyNodeOf(world: World, terrain: TerrainGraph, barracks: Entity): NodeId | undefined {
  const flag = liveRallyFlag(world, barracks);
  return flag === undefined ? undefined : entityNode(world, terrain, flag);
}

/**
 * Plant or move an owned, finished barracks' rally flag - see the command doc. The clicked node snaps to the
 * nearest legal flag ground within {@link WORK_FLAG_SNAP_MAX_RADIUS}, as a gatherer's work flag does; a click
 * past that is not workable ground and changes nothing. An existing flag only moves, so the same marker
 * stands throughout. Only soldiers trained after the order take the new point.
 */
export function setRallyPoint(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setRallyPoint' }>,
): void {
  const { building } = command;
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless: no ground to plant a flag on
  if (!world.has(building, Owner) || !isBarracks(world, ctx, building)) return;
  const live = liveRallyFlag(world, building);
  const target = nearestWorkFlagPlacement(world, ctx, terrain, terrain.nodeAtClamped(command.x, command.y), {
    ignoreFlag: live,
    withinRadius: WORK_FLAG_SNAP_MAX_RADIUS,
  });
  if (target === null) return;
  const c = terrain.coordsOf(target);
  const pos = positionOfNode(c.x, c.y);
  if (live !== undefined) relocateWorkFlag(world, live, pos);
  else world.add(building, RallyPoint, { flag: mintFlagMarker(world, pos) });
}

/** Take a barracks' rally point away and its flag with it; never refused. */
export function clearRallyPoint(world: World, command: Extract<Command, { kind: 'clearRallyPoint' }>): void {
  if (world.isAlive(command.building)) dropRallyPoint(world, command.building);
}

/** Destroy `building`'s rally flag and forget it. Also the barracks' teardown, so no flag outlives it. */
export function dropRallyPoint(world: World, building: Entity): void {
  const rally = world.tryGet(building, RallyPoint);
  if (rally === undefined) return;
  if (world.isAlive(rally.flag)) world.destroy(rally.flag);
  world.remove(building, RallyPoint);
}
