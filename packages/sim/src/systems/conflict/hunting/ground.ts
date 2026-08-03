import { HUNTER_WORK_FLAG_RADIUS, JobAssignment, Position, WorkFlag } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';

// The hunting ground: the one circle that answers where a posted hunter hunts and which bodies are its work.

/**
 * How far (Manhattan nodes) past its hunting ground's radius a hunter's chase may step, so it can walk up
 * to game right at the area edge without pursuing a fleeing herd across the map. Approximated (source
 * basis "Combat stances").
 */
export const HUNT_CHASE_SLACK_NODES = 4;

/**
 * How much wider than its hunting ground a hunter probes for real game before it will draw on last-resort
 * livestock. A multiple of the ground radius rather than its own length, so the probe stays proportional to
 * the area the hunter was posted over. Approximation - no source describes an empty ground.
 */
export const HUNT_LAST_RESORT_SCAN_FACTOR = 2;

/**
 * How far (Manhattan nodes) past the ground's radius a hunter's carcass may lie and still be its work: the
 * chase overshoot ({@link HUNT_CHASE_SLACK_NODES}) plus a drift margin for prey that keeps fleeing between
 * the release and the arrow's contact. Not airtight - a runner can be carried past even this band, and such
 * a body becomes a permanent decal that no hunter can claim.
 */
export const HUNT_CARCASS_SLACK_NODES = HUNT_CHASE_SLACK_NODES + 4;

/**
 * The area an owned hunter hunts and harvests: its work-flag circle, or the
 * {@link HUNTER_WORK_FLAG_RADIUS} circle around the workplace it is employed at instead (the two are
 * mutually exclusive). Null for a hunter with neither, which hunts by plain sight and forages unbounded.
 */
export function huntingGround(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
): { anchorCell: NodeId; radius: number } | null {
  const flag = world.tryGet(e, WorkFlag);
  if (flag !== undefined && world.has(flag.flag, Position)) {
    const p = world.get(flag.flag, Position);
    const n = nodeOfPosition(p.x, p.y);
    return { anchorCell: terrain.nodeAtClamped(n.hx, n.hy), radius: flag.radius };
  }
  const workplace = world.tryGet(e, JobAssignment)?.workplace;
  if (workplace !== undefined && world.has(workplace, Position)) {
    const p = world.get(workplace, Position);
    const n = nodeOfPosition(p.x, p.y);
    return { anchorCell: terrain.nodeAtClamped(n.hx, n.hy), radius: HUNTER_WORK_FLAG_RADIUS };
  }
  return null;
}
