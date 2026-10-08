import { Engagement, MoveGoal, PlayerOrder, Position, Rider, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { pairBySpace } from '../../../nav/formation.js';
import { type HalfCellNode, hexDistance, nodeOfPosition } from '../../../nav/halfcell.js';
import { NEAREST_NODE_SEARCH_CAP } from '../../../nav/nearest.js';
import { ringSearch } from '../../../nav/ring-search.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { HALF_COLUMN, HALF_ROW } from '../../../nav/world-metric.js';
import type { SystemContext } from '../../context.js';
import { dynamicBlockOverlay } from '../../footprint/blocked.js';
import { standingPostGrid, unitWalkBlocks } from '../../movement/collision/standing-posts.js';
import { formationSlotGroups, type Occupancy } from '../../orders/formation-slots.js';
import { sendUnit } from '../../orders/movement.js';
import { isFighterJob } from '../../readviews/index.js';
import { detachBeforeOrder } from '../../vehicles/crew.js';
import type { MissionPass } from '../pass.js';
import { missionHumans } from '../targets.js';

/** How far past its formation a band's man may stand and still hold it, so a band a fight has thinned
 *  or pushed about keeps its orders. Authored. */
const FORMATION_HOLD_SLACK_NODES = 8;

/**
 * Order every human with the id to the point: each to his own place around it, as a player's group
 * order seats a band (avoiding standing fighters), paired so neighbours stay neighbours; a fighter goes
 * on an attack-move, so the band fights what it meets, and a civilian walks. A man whose order already
 * leads into the formation, or a fighter fighting within it, keeps it, so a repeating line neither
 * breaks off a fight nor reshuffles a walking band; a man the line adds takes a place nobody holds.
 * The places the pass's earlier lines handed out are held too, so a party sent in one line per man
 * stands around the point rather than queueing behind one place. Authored: the original sends every
 * one of them on a plain walk to the one point. A man left without a place walks to the point, which
 * the walk order snaps to the nearest node he can stand on.
 */
export function sendScriptedHumans(pass: MissionPass, id: number, point: HalfCellNode): void {
  const { world, ctx } = pass;
  const terrain = ctx.terrain;
  const humans = missionHumans(world, id).filter((e) => {
    const held = world.tryGet(e, Rider)?.leaving;
    if (held !== undefined && held !== null && !world.has(e, Position)) {
      world.mut(e, Rider).leaving = { to: { hx: point.hx, hy: point.hy } };
      return false; // walks on from the shore once the ship moors
    }
    // A rider aboard steps off first, as the original's walk command does; one aboard a ship at sea
    // is refused and left out, as the original leaves it.
    return detachBeforeOrder(world, ctx, e) && world.has(e, Position);
  });
  if (terrain === undefined || humans.length === 0) return;
  const fighter = (e: Entity): boolean =>
    isFighterJob(ctx.content, world.tryGet(e, Settler)?.jobType ?? null);
  const military = humans.some(fighter);
  pass.walkGoals ??= new Set();
  const held = pass.walkGoals;
  let places = formationPlaces(pass, terrain, humans, point, military, held);
  let reach = 0;
  for (const place of places.values()) reach = Math.max(reach, hexDistance(place, point));
  reach += FORMATION_HOLD_SLACK_NODES;
  const movers: Entity[] = [];
  let holders = 0;
  for (const e of humans) {
    const goal = heldGoal(world, terrain, e, point, reach, fighter(e));
    if (goal === undefined) movers.push(e);
    else if (goal !== null) {
      held.add(goal);
      holders++;
    }
  }
  if (movers.length === 0) return;
  if (holders > 0) places = formationPlaces(pass, terrain, movers, point, military, held);
  for (const e of movers) {
    const place = places.get(e) ?? point;
    held.add(terrain.nodeAt(place.hx, place.hy));
    sendUnit(world, ctx, e, place.hx, place.hy, { attackMove: fighter(e) });
  }
}

/** The goal of the order by which `e` holds the formation within `reach` of `point`, null for a fighter
 *  fighting within it, or undefined when he holds nothing and takes a fresh order. */
function heldGoal(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  point: HalfCellNode,
  reach: number,
  fighter: boolean,
): NodeId | null | undefined {
  const within = (node: NodeId): boolean =>
    hexDistance({ hx: terrain.xOf(node), hy: terrain.yOf(node) }, point) <= reach;
  const order = world.tryGet(e, PlayerOrder);
  if (order?.scripted === true && (order.attackMove !== undefined) === fighter) {
    const goal = order.attackMove?.goal ?? order.pendingGoal ?? world.tryGet(e, MoveGoal)?.cell;
    return goal !== undefined && within(goal) ? goal : undefined;
  }
  if (!fighter || order !== undefined || !world.has(e, Engagement)) return undefined;
  const at = world.get(e, Position);
  const { hx, hy } = nodeOfPosition(at.x, at.y);
  return hexDistance({ hx, hy }, point) <= reach ? null : undefined;
}

/** Each human's place around `point`, off the `held` nodes. Ground too boxed in to seat the band seats
 *  the men nearest the point. A line naming one man seats him on the nearest free node to the point,
 *  as the original's snap of the point does, since a formation of one has no rows to keep. */
function formationPlaces(
  pass: MissionPass,
  terrain: TerrainGraph,
  humans: readonly Entity[],
  point: HalfCellNode,
  military: boolean,
  held: ReadonlySet<NodeId>,
): Map<Entity, HalfCellNode> {
  const { world, ctx } = pass;
  const places = new Map<Entity, HalfCellNode>();
  const [one] = humans;
  if (one !== undefined && humans.length === 1) {
    const occupied = standingStrangers(ctx, held)(world, terrain, new Set(humans));
    const blocked = dynamicBlockOverlay(world, ctx, terrain);
    const open = (node: NodeId): boolean => terrain.isWalkable(node) && !blocked.has(node) && !occupied(node);
    const aim = terrain.nodeAtClamped(point.hx, point.hy);
    const node = open(aim) ? aim : ringSearch(terrain, aim, NEAREST_NODE_SEARCH_CAP, { accept: open });
    if (node !== null) places.set(one, { hx: terrain.xOf(node), hy: terrain.yOf(node) });
    return places;
  }
  const rows = military ? 2 : 1;
  const occupancy = standingStrangers(ctx, held);
  for (const group of formationSlotGroups(world, ctx.content, terrain, point, humans, rows, occupancy)) {
    if (group.commandedVehicle !== undefined) continue;
    const members = group.members.map((e) => {
      const at = world.get(e, Position);
      const node = nodeOfPosition(at.x, at.y);
      return { key: e, node, ...worldPoint(node) };
    });
    members.sort((a, b) => hexDistance(a.node, point) - hexDistance(b.node, point) || a.key - b.key);
    const paired = pairBySpace(
      members.slice(0, group.slots.length),
      group.slots.map((slot, key) => ({ key, ...worldPoint(slot) })),
    );
    for (const [e, key] of paired) {
      const slot = group.slots[key];
      if (slot !== undefined) places.set(e, slot);
    }
  }
  return places;
}

/** A node in world units, so a band splits on the axis it is widest across on screen. */
function worldPoint(node: HalfCellNode): { readonly x: number; readonly y: number } {
  return { x: node.hx * HALF_COLUMN, y: node.hy * HALF_ROW };
}

/** The nodes a standing fighter outside the band holds, read off the standing-body index, and the
 *  `held` ones. */
function standingStrangers(ctx: SystemContext, held: ReadonlySet<NodeId>): Occupancy {
  return (world, terrain, movers) => {
    const { posts } = unitWalkBlocks(world, ctx.content, terrain);
    const grid = standingPostGrid(world, ctx.content, terrain);
    const on: Entity[] = [];
    return (node) => {
      if (held.has(node)) return true;
      if ((posts[node] ?? 0) === 0) return false;
      const count = grid.collect(terrain.xOf(node), terrain.yOf(node), on, 0);
      for (let i = 0; i < count; i++) {
        const post = on[i];
        if (post !== undefined && !movers.has(post)) return true;
      }
      return false;
    };
  };
}
