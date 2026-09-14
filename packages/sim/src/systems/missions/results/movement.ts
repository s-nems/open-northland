import { Person, Position, Resting, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistance, nodeOfPosition, positionOfNode } from '../../../nav/halfcell.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { evictSettlerFromBlockedSpawn } from '../../movement/evict.js';
import { clearNavState, isTravelling } from '../../movement/nav-state.js';
import { sendUnit } from '../../orders/movement.js';
import { stepOut } from '../../settlers/indoors.js';
import { canonicalById } from '../../spatial/nodes.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';
import { missionHumans, ownedBy, withinRange } from '../targets.js';

/** How many humans one teleport line may carry, whatever it addresses (reading: the original fills a
 *  20-entry buffer and stops). */
const TELEPORT_CAP = 20;

/** Whether the map has ground at `point`. A teleport writes a position outright, so a line naming a
 *  spot off the lattice would strand its group there; a walk order needs no such guard, since it
 *  clamps its goal into bounds. */
function landable(pass: MissionPass, point: HalfCellNode): boolean {
  return pass.ctx.terrain?.inBounds(point.hx, point.hy) ?? false;
}

/** Order every human with the id to walk to the point. The walk order snaps to the nearest node the
 *  unit can stand on, so a script may aim at a blocked spot and still be obeyed. */
export function sendScriptedHumans(pass: MissionPass, id: number, point: HalfCellNode): void {
  for (const e of missionHumans(pass.world, id)) walkTo(pass.world, pass.ctx, e, point);
}

/** Teleport up to {@link TELEPORT_CAP} humans with the id to the point and let them settle there. */
export function teleportScriptedHumans(pass: MissionPass, id: number, point: HalfCellNode): void {
  if (!landable(pass, point)) return;
  const claimed = new Set<NodeId>();
  for (const e of missionHumans(pass.world, id).slice(0, TELEPORT_CAP)) {
    teleportAndSettle(pass, e, point, claimed);
  }
}

/**
 * Teleport up to {@link TELEPORT_CAP} of the player's free humans from around one point to another.
 * The line is inert unless the destination lies farther than `range` from the source, which is what
 * keeps a repeating mission from shuffling the same crowd on the spot (reading).
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
  let moved = 0;
  for (const e of canonicalById(world.query(Person, Position))) {
    if (moved >= TELEPORT_CAP) break;
    // The original skips a human a vehicle carries; with no vehicles here, standing inside a building
    // is the nearest thing to a human this line cannot pick up.
    if (world.has(e, Resting)) continue;
    if (!ownedBy(world, e, op.player) || !withinRange(world, e, op.point, op.range)) continue;
    teleportAndSettle(pass, e, destination, claimed);
    moved++;
  }
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

/**
 * Put `e` on the destination node, push it off if the landing is blocked, and hand it the same walk
 * order the original issues after its own teleport, so the planner takes the unit back from there.
 * That order carries a player walk's whole teardown: a guard's post moves to the destination, and a
 * carrier sets its load down where it lands rather than where it was lifted. `claimed` threads one
 * line's batch so a group fans out instead of stacking. The destination needs no explicit reveal: the
 * moved unit's own eye covers it on the next vision pass, which is what the original's explore call
 * achieves. Approximation: a unit inside a non-interruptible clip finishes it where it no longer
 * stands, because the walk order parks behind that clip rather than cancelling it.
 */
function teleportAndSettle(pass: MissionPass, e: Entity, point: HalfCellNode, claimed: Set<NodeId>): void {
  const { world, ctx } = pass;
  const at = world.tryMut(e, Position);
  if (at === undefined) return;
  // Landing outdoors, so the marker that says it is inside a building goes with the old position.
  stepOut(world, e);
  const centre = positionOfNode(point.hx, point.hy);
  at.x = centre.x;
  at.y = centre.y;
  // The route it was walking points back at where it came from, so it goes before anything re-aims.
  clearNavState(world, e);
  evictSettlerFromBlockedSpawn(world, ctx, e, claimed);
  walkTo(world, ctx, e, point);
}

function walkTo(world: World, ctx: SystemContext, e: Entity, point: HalfCellNode): void {
  sendUnit(world, ctx, e, point.hx, point.hy);
}
