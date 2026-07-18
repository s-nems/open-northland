import { Building } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { interactionNode } from '../footprint/index.js';
import { entityNode } from '../spatial.js';

// The node combat measures a target's distance to (and paths a chaser toward). Split out of targeting.ts
// so the ring-search index, the chase drive, and the mid-swing whiff check all resolve a building target's
// approach node the same way.

/**
 * The half-cell node a warrior fights `target` from — its own node for a settler/animal
 * ({@link entityNode}), the building's DOOR (interaction) node for a building. A building's walls block
 * its anchor, so a settler reaches it at the door — the same walkable cell the JobSystem's workers stand
 * on — and combat measures reach from there: a melee blow lands one cell outside the wall and a bow fires
 * on the door. Falls back to the anchor node for a footprint-less/synthetic building.
 *
 * Named approximation (source basis: reuses the door-aware interaction seam): a building is besieged from
 * its single door node, not its whole perimeter, so a large footprint fields at most a door-sized rank of
 * attackers rather than one per wall face.
 */
export function combatTargetNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  target: Entity,
): NodeId {
  if (world.has(target, Building)) {
    const at = interactionNode(world, ctx, target);
    if (at !== null) return terrain.nodeAtClamped(at.x, at.y);
  }
  return entityNode(world, terrain, target);
}
