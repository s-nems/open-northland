import { Owner, RallyPoint, type RallyPost, Stance } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { MILITARY_ROW_SPACING } from '../../nav/formation.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { guardPost } from '../conflict/chase.js';
import type { SystemContext } from '../context.js';
import { mintFlagMarker, relocateWorkFlag } from '../economy/work-flag.js';
import { nearestWorkFlagPlacement } from '../footprint/placement/work-flag/queries.js';
import { standingFighterPosts } from '../movement/collision/standing-posts.js';
import { isBarracks } from '../readviews/index.js';
import { entityNode } from '../spatial/nodes.js';
import { moveAnchor } from './combat.js';
import { formationSlotGroups, type Occupancy } from './formation-slots.js';
import { WORK_FLAG_SNAP_MAX_RADIUS } from './work/selection.js';

/** `building`'s rally flag while its marker entity still exists; a stale binding reads as undefined. */
function liveRallyFlag(world: World, building: Entity): Entity | undefined {
  const rally = world.tryGet(building, RallyPoint);
  return rally !== undefined && world.isAlive(rally.flag) ? rally.flag : undefined;
}

/** The node the soldiers `barracks` trains gather around, or undefined while it has no rally point. Read
 *  off the flag, so a flag the placement rules pushed aside still names where it stands. */
export function rallyNodeOf(world: World, terrain: TerrainGraph, barracks: Entity): NodeId | undefined {
  const flag = liveRallyFlag(world, barracks);
  return flag === undefined ? undefined : entityNode(world, terrain, flag);
}

/**
 * Post `soldier` at `barracks`' rally point and anchor him there: the first place of a fighters' group
 * formation around the flag that no standing fighter takes and no soldier posted here still holds, else the
 * open node at the flag. A soldier who still holds his post at the flag where it stands keeps it. Undefined
 * while the barracks keeps no flag on the soldier's land. Our rule: one shared node would pile every
 * recruit on it.
 */
export function takeRallyPost(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  barracks: Entity,
  soldier: Entity,
): NodeId | undefined {
  const rally = world.tryGet(barracks, RallyPoint);
  const flag = liveRallyFlag(world, barracks);
  if (rally === undefined || flag === undefined) return undefined;
  const centre = entityNode(world, terrain, flag);
  const here = entityNode(world, terrain, soldier);
  if (terrain.componentOf(centre) !== terrain.componentOf(here)) return undefined;
  const own = rally.posts.find((post) => post.soldier === soldier);
  if (own !== undefined && own.centre === centre && holdsPost(world, own)) return own.node;
  // Places handed out around an earlier flag spot stay taken while held: their men may still be walking.
  const held = rally.posts.filter((post) => post.soldier !== soldier && holdsPost(world, post));
  const standing = standingFighterPosts(world, ctx.content, terrain);
  const taken = new Set(held.map((post) => post.node));
  const occupancy: Occupancy = () => (node) => taken.has(node) || standing.has(node);
  const at = terrain.coordsOf(centre);
  // Places by land alone, as an attack-move takes them: a gate shut at this moment must not pin his post
  // on its near side for good.
  const [group] = formationSlotGroups(
    world,
    ctx.content,
    terrain,
    { hx: at.x, hy: at.y },
    [soldier],
    MILITARY_ROW_SPACING,
    occupancy,
    'attackMove',
  );
  const slot = group?.slots[0];
  const node =
    slot === undefined ? guardPost(world, ctx, terrain, centre, here) : terrain.nodeAt(slot.hx, slot.hy);
  world.mutUnseen(barracks, RallyPoint).posts = [...held, { soldier, node, centre }];
  moveAnchor(world, ctx.content, soldier, node);
  return node;
}

/** Whether `post`'s soldier lives and still holds it: an order elsewhere or a stance without an anchor
 *  hands the place back. */
function holdsPost(world: World, post: RallyPost): boolean {
  return world.isAlive(post.soldier) && world.tryGet(post.soldier, Stance)?.anchorCell === post.node;
}

/**
 * Plant or move an owned, finished barracks' rally flag - see the command doc. The clicked node snaps to the
 * nearest legal flag ground within {@link WORK_FLAG_SNAP_MAX_RADIUS}, as a gatherer's work flag does; a click
 * past that is not workable ground and changes nothing. Only the barracks' own land takes the flag: no
 * soldier walks to another shore. An existing flag only moves, so the same marker stands throughout. Only
 * soldiers the barracks trains or the assistant arms through it after the order take the new point.
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
  const land = terrain.componentOf(entityNode(world, terrain, building));
  const target = nearestWorkFlagPlacement(world, ctx, terrain, terrain.nodeAtClamped(command.x, command.y), {
    ignoreFlag: live,
    withinRadius: WORK_FLAG_SNAP_MAX_RADIUS,
    accept: (node) => terrain.componentOf(node) === land,
  });
  if (target === null) return;
  const c = terrain.coordsOf(target);
  const pos = positionOfNode(c.x, c.y);
  if (live !== undefined) relocateWorkFlag(world, live, pos);
  else world.add(building, RallyPoint, { flag: mintFlagMarker(world, pos), posts: [] });
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
