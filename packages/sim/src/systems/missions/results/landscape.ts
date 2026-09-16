import { landscapeTopologyRevision } from '../../../components/landscape.js';
import type { LandscapeRemovalGroup, NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { dynamicBlockLayers } from '../../footprint/index.js';
import { removeLandscapes, setBuildForbidden, setLandscape, setVertexColors } from '../../landscape/edits.js';
import { invalidateLandscapeRoutes } from '../../landscape/routes.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';

type LandscapeOp = Extract<
  MissionResultOp,
  {
    opcode:
      | 'SetLandscape'
      | 'RemoveLandscape'
      | 'RemoveLandscapesInArea'
      | 'RemoveFXWaveLandscapeInArea'
      | 'RemoveFXSmokeLandscapeInArea'
      | 'RemoveBlockerLandscapeInArea'
      | 'RemoveFX1LandscapeInArea'
      | 'RemoveFX2LandscapeInArea'
      | 'SetHouseBuildForbiddenArea'
      | 'SetVertexColor'
      | 'SetVertexColorOnLand';
  }
>;

export function editScriptedLandscape(pass: MissionPass, mission: number, op: LandscapeOp): void {
  const terrain = pass.ctx.terrain;
  if (terrain === undefined || !terrain.inBounds(op.point.hx, op.point.hy)) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  if (op.opcode === 'SetHouseBuildForbiddenArea') {
    setBuildForbidden(pass.world, terrain, op.point, op.range, op.flag);
    return;
  }
  if (op.opcode === 'SetVertexColor' || op.opcode === 'SetVertexColorOnLand') {
    if (
      !setVertexColors(
        pass.world,
        terrain,
        op.point,
        op.range,
        op.amount,
        op.opcode === 'SetVertexColorOnLand',
      )
    ) {
      pass.reportFailed(mission, op.opcode);
      return;
    }
    pass.ctx.events.emit({ kind: 'missionVertexColor' });
    return;
  }
  if (terrain.landscapes === undefined) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  const revision = landscapeTopologyRevision(pass.world);
  // Resource-backed placements update their footprint cache in place, so retain the old membership.
  const before = blockedNodes(pass, terrain);
  if (op.opcode === 'SetLandscape') {
    if (!setLandscape(pass.world, pass.ctx, op.point, op.landscape, op.level)) {
      pass.reportFailed(mission, op.opcode);
      return;
    }
  } else {
    const group: LandscapeRemovalGroup | undefined =
      op.opcode === 'RemoveFXWaveLandscapeInArea'
        ? 'wave'
        : op.opcode === 'RemoveFXSmokeLandscapeInArea'
          ? 'smoke'
          : op.opcode === 'RemoveBlockerLandscapeInArea'
            ? 'blocker'
            : op.opcode === 'RemoveFX1LandscapeInArea'
              ? 'fx1'
              : op.opcode === 'RemoveFX2LandscapeInArea'
                ? 'fx2'
                : undefined;
    removeLandscapes(pass.world, terrain, op.point, removalRange(op), group, (entity) =>
      pass.ctx.events.emit({ kind: 'missionLandscapeResourceRemoved', entity }),
    );
  }
  if (revision !== landscapeTopologyRevision(pass.world)) {
    // Freed nodes do not invalidate an existing route. A newly blocked node can cross one, whether
    // it came from the landscape layer or a resource-backed chest/deposit.
    const after = blockedNodes(pass, terrain);
    if ([...after].some((node) => !before.has(node))) {
      invalidateLandscapeRoutes(pass.world, terrain);
    }
    pass.ctx.events.emit({ kind: 'missionLandscapeChanged' });
  }
}

function blockedNodes(pass: MissionPass, terrain: TerrainGraph): Set<NodeId> {
  const nodes = new Set<NodeId>();
  for (const layer of dynamicBlockLayers(pass.world, pass.ctx, terrain)) {
    for (const node of layer) nodes.add(node);
  }
  return nodes;
}

/** The hexagon radius a removal clears: `RemoveLandscapesInArea` stops one ring short of its `range`
 *  while the group removals include the ring at `range` (reading). */
function removalRange(op: LandscapeOp): number {
  if (!('range' in op)) return 0;
  return op.opcode === 'RemoveLandscapesInArea' ? Math.max(0, op.range - 1) : op.range;
}
