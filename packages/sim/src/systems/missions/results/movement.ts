import { Person, Position, Resting, Settler } from '../../../components/index.js';
import { type HalfCellNode, hexagonRing, hexDistance, nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import { dynamicBlockOverlay } from '../../footprint/index.js';
import { isTravelling } from '../../movement/nav-state.js';
import { sendUnit } from '../../orders/movement.js';
import { teleportHuman } from '../../orders/teleport.js';
import { dockVehicle } from '../../vehicles/dock.js';
import { moveVehicle } from '../../vehicles/movement.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';
import { missionVehicles, ownedBy, scriptedHumans, withinRange } from '../targets.js';
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

/** Order every vehicle with the id to drive to the point: the seat's goto, which snaps the point to
 *  the vehicle's continent within its snap radius and refuses like a player's click would. */
export function sendScriptedVehicles(pass: MissionPass, id: number, point: HalfCellNode): void {
  const { world, ctx } = pass;
  for (const vehicle of missionVehicles(world, id)) {
    moveVehicle(world, ctx, { kind: 'moveVehicle', vehicle, x: point.hx, y: point.hy });
  }
}

/** Original behavior: a blocked script dock point first snaps to an open point on the same
 *  terrain component within nine hexagon rings; the normal dock order then finds its sea position.
 *  The search boundary is not yet checked against the running original. */
export function dockScriptedVehicles(pass: MissionPass, id: number, point: HalfCellNode): void {
  const { world, ctx } = pass;
  const terrain = ctx.terrain;
  if (terrain === undefined || !terrain.inBounds(point.hx, point.hy)) return;
  const component = terrain.componentOf(terrain.nodeAt(point.hx, point.hy));
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  let target: HalfCellNode | null = null;
  for (let radius = 0; radius <= 9 && target === null; radius++) {
    for (const { point: candidate } of hexagonRing(point, radius)) {
      if (!terrain.inBounds(candidate.hx, candidate.hy)) continue;
      const node = terrain.nodeAt(candidate.hx, candidate.hy);
      if (component < 0 || terrain.componentOf(node) !== component || blocked.has(node)) continue;
      target = candidate;
      break;
    }
  }
  // No valid snap leaves the authored point for the ordinary dock order to judge.
  // This failure fallback remains unconfirmed against the original.
  target ??= point;
  for (const vehicle of missionVehicles(world, id)) {
    dockVehicle(world, ctx, { kind: 'dockVehicle', vehicle, x: target.hx, y: target.hy });
  }
}

/** Teleport up to {@link TELEPORT_CAP} humans with the id to the point and let them settle there. */
export function teleportScriptedHumans(pass: MissionPass, id: number, point: HalfCellNode): void {
  if (!landable(pass, point)) return;
  const claimed = new Set<NodeId>();
  for (const e of scriptedHumans(pass.world, id).slice(0, TELEPORT_CAP)) {
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
    const here = nodeOfPosition(at.x, at.y);
    sendUnit(world, pass.ctx, e, here.hx, here.hy);
  }
}
