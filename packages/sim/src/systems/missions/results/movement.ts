import { Engagement, Person, PlayerOrder, Position, Resting, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { pairBySpace } from '../../../nav/formation.js';
import { type HalfCellNode, hexDistance, nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import { HALF_COLUMN, HALF_ROW } from '../../../nav/world-metric.js';
import type { SystemContext } from '../../context.js';
import { unitWalkBlocks } from '../../movement/collision/standing-posts.js';
import { isTravelling } from '../../movement/nav-state.js';
import { formationSlotGroups, type Occupancy } from '../../orders/formation-slots.js';
import { sendUnit } from '../../orders/movement.js';
import { teleportHuman } from '../../orders/teleport.js';
import { isFighterJob } from '../../readviews/index.js';
import { dockVehicle } from '../../vehicles/dock.js';
import { moveVehicle } from '../../vehicles/movement.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';
import { missionHumans, missionVehicles, ownedBy, withinRange } from '../targets.js';
import { teleportVehiclesInArea } from './vehicles.js';

/** How many humans one teleport line may carry, whatever it addresses (reading: the original fills a
 *  20-entry buffer and stops). */
const TELEPORT_CAP = 20;

/** Whether the map has ground at `point`. A teleport writes a position outright, so a line naming a
 *  spot off the lattice would strand its group there; a walk order needs no such guard, since it
 *  clamps its goal into bounds. */
function landable(pass: MissionPass, point: HalfCellNode): boolean {
  return pass.ctx.terrain?.inBounds(point.hx, point.hy) ?? false;
}

/** How far past the formation a band's men may stand and still count as holding it, so a band thinned
 *  by a fight or spilled round boxed-in ground keeps its order. Authored. */
const FORMATION_HOLD_SLACK_NODES = 8;

/**
 * Order every human with the id to the point: each to his own place of the formation a player's group
 * order takes there, paired so neighbours stay neighbours, and a fighter on an attack-move, so the band
 * fights what it meets and spreads over the ground it arrives on. A fighter marching on the formation
 * or fighting on it keeps his order, so a repeating line does not break off his fight. Authored: the
 * original sends every one of them on a plain walk to the one point. A human with no place walks to
 * the point, which the walk order snaps to the nearest node he can stand on, so a script may aim at a
 * blocked spot and still be obeyed.
 */
export function sendScriptedHumans(pass: MissionPass, id: number, point: HalfCellNode): void {
  const { world, ctx } = pass;
  const humans = missionHumans(world, id);
  const fighter = (e: Entity): boolean =>
    isFighterJob(ctx.content, world.tryGet(e, Settler)?.jobType ?? null);
  const military = humans.some(fighter);
  const places = formationPlaces(pass, humans, point, military);
  const reach = formationReach(humans.length, military) + FORMATION_HOLD_SLACK_NODES;
  for (const e of humans) {
    if (!fighter(e)) {
      walkTo(world, ctx, e, places.get(e) ?? point);
      continue;
    }
    if (holdsFormation(pass, e, point, reach)) continue;
    const place = places.get(e) ?? point;
    sendUnit(world, ctx, e, place.hx, place.hy, { attackMove: true });
  }
}

/** The farthest (hex) a formation of `count` reaches from its point: its square rings, rows doubled
 *  for a military one. */
function formationReach(count: number, military: boolean): number {
  let rings = 0;
  while ((2 * rings + 1) ** 2 < count) rings++;
  return military ? 2 * rings : rings;
}

/** Each human's place around `point`. Ground too boxed in to seat the band seats the men nearest it. */
function formationPlaces(
  pass: MissionPass,
  humans: readonly Entity[],
  point: HalfCellNode,
  military: boolean,
): Map<Entity, HalfCellNode> {
  const { world, ctx } = pass;
  const places = new Map<Entity, HalfCellNode>();
  const terrain = ctx.terrain;
  if (terrain === undefined) return places;
  const rows = military ? 2 : 1;
  for (const group of formationSlotGroups(
    world,
    ctx.content,
    terrain,
    point,
    humans,
    rows,
    standingBodies(ctx),
  )) {
    if (group.commandedVehicle !== undefined) continue;
    const members = group.members.map((e) => {
      const at = world.get(e, Position);
      const node = nodeOfPosition(at.x, at.y);
      return { key: e, node, ...worldPoint(node) };
    });
    members.sort((a, b) => hexDistance(a.node, point) - hexDistance(b.node, point) || a.key - b.key);
    const seated = members.slice(0, group.slots.length);
    const paired = pairBySpace(
      seated,
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

/** The nodes a standing body holds other than the band's own, read off the standing-body index. */
function standingBodies(ctx: SystemContext): Occupancy {
  return (world, terrain, movers) => {
    const { posts } = unitWalkBlocks(world, ctx.content, terrain);
    const own = new Map<NodeId, number>();
    for (const e of movers) {
      const at = world.get(e, Position);
      const { hx, hy } = nodeOfPosition(at.x, at.y);
      if (!terrain.inBounds(hx, hy)) continue;
      const node = terrain.nodeAt(hx, hy);
      own.set(node, (own.get(node) ?? 0) + 1);
    }
    return (node) => (posts[node] ?? 0) > (own.get(node) ?? 0);
  };
}

/** Whether `e` marches on a script's attack-move to within `reach` of `point`, or fights within it. */
function holdsFormation(pass: MissionPass, e: Entity, point: HalfCellNode, reach: number): boolean {
  const { world } = pass;
  const terrain = pass.ctx.terrain;
  if (terrain === undefined) return false;
  const order = world.tryGet(e, PlayerOrder);
  if (order?.scripted === true && order.attackMove !== undefined) {
    const goal = order.attackMove.goal;
    return hexDistance({ hx: terrain.xOf(goal), hy: terrain.yOf(goal) }, point) <= reach;
  }
  if (order !== undefined || !world.has(e, Engagement)) return false;
  const at = world.get(e, Position);
  return hexDistance(nodeOfPosition(at.x, at.y), point) <= reach;
}

/** Order every vehicle with the id to drive to the point: the seat's goto, which snaps the point to
 *  the vehicle's continent within its snap radius and refuses like a player's click would. */
export function sendScriptedVehicles(pass: MissionPass, id: number, point: HalfCellNode): void {
  const { world, ctx } = pass;
  for (const vehicle of missionVehicles(world, id)) {
    moveVehicle(world, ctx, { kind: 'moveVehicle', vehicle, x: point.hx, y: point.hy });
  }
}

/** Order every ship with the id to dock at the shore point: the seat's dock order, whose ring search
 *  is the snap (approximation: the original snaps the point within radius 9 first). */
export function dockScriptedVehicles(pass: MissionPass, id: number, point: HalfCellNode): void {
  const { world, ctx } = pass;
  for (const vehicle of missionVehicles(world, id)) {
    dockVehicle(world, ctx, { kind: 'dockVehicle', vehicle, x: point.hx, y: point.hy });
  }
}

/** Teleport up to {@link TELEPORT_CAP} humans with the id to the point and let them settle there. */
export function teleportScriptedHumans(pass: MissionPass, id: number, point: HalfCellNode): void {
  if (!landable(pass, point)) return;
  const claimed = new Set<NodeId>();
  for (const e of missionHumans(pass.world, id).slice(0, TELEPORT_CAP)) {
    teleportHuman(pass.world, pass.ctx, e, point, claimed);
  }
}

/**
 * Teleport up to {@link TELEPORT_CAP} of the player's free humans, and its vehicles standing in the area,
 * from around one point to another. The line is inert unless the destination lies farther than `range`
 * from the source, which is what keeps a repeating mission from shuffling the same crowd on the spot
 * (reading).
 */
export function moveUnitsInArea(
  pass: MissionPass,
  op: Extract<MissionResultOp, { opcode: 'MoveUnitsInArea' }>,
): void {
  // The only line in the table that spells a point with the generic index and extra kinds.
  const destination = { hx: op.index, hy: op.extra };
  if (hexDistance(op.point, destination) <= op.range || !landable(pass, destination)) return;
  const { world } = pass;
  const claimed = new Set<NodeId>();
  // A human a vehicle carries has no position and is never seen here, as the original skips it;
  // standing inside a building is treated the same way.
  const crowd = world
    .canonicalQuery(Person, Position)
    .filter(
      (e) =>
        !world.has(e, Resting) && ownedBy(world, e, op.player) && withinRange(world, e, op.point, op.range),
    );
  for (const e of crowd.slice(0, TELEPORT_CAP)) teleportHuman(world, pass.ctx, e, destination, claimed);
  teleportVehiclesInArea(pass, op.player, op.point, op.range, destination);
}

/**
 * Stop every walking human of the player where it stands. The order it takes is a walk to its own
 * node, which arrives at once and drops the work, route and fight it was running. Approximation: the
 * original also re-aims the unit's work target, a binding this planner re-derives every tick anyway.
 */
export function stopPlayerHumans(pass: MissionPass, player: number): void {
  const { world } = pass;
  for (const e of [...world.query(Person, Settler, Position)]) {
    if (!ownedBy(world, e, player) || !isTravelling(world, e)) continue;
    const at = world.get(e, Position);
    walkTo(world, pass.ctx, e, nodeOfPosition(at.x, at.y));
  }
}

function walkTo(world: World, ctx: SystemContext, e: Entity, point: HalfCellNode): void {
  sendUnit(world, ctx, e, point.hx, point.hy);
}
