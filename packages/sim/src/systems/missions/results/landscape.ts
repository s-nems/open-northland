import { landscapeTopologyRevision } from '../../../components/landscape.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { LandscapeRemovalGroup, NodeId } from '../../../nav/terrain/index.js';
import { dynamicBlockOverlay } from '../../footprint/index.js';
import { translatedCells } from '../../footprint/geometry.js';
import {
  placementWalkCells,
  removeLandscapes,
  setBuildForbidden,
  setLandscape,
  setVertexColors,
} from '../../landscape/edits.js';
import { invalidateLandscapeRoutes } from '../../landscape/routes.js';
import { landscapeTypes } from '../../landscape/view.js';
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
  // Only the placement being laid can close a node; a removal only opens them. Which of its cells
  // were open is read before the edit, so replacing an object with one of the same shape closes none,
  // whether the script replaces it in one result or removes it and lays it again in the same pass.
  const freed = (pass.landscapeFreed ??= new Set());
  const openBefore =
    op.opcode === 'SetLandscape'
      ? openCellsOf(pass, op.point, op.landscape).filter((node) => !freed.has(node))
      : [];
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
    const opened = removeLandscapes(pass.world, terrain, op.point, removalRange(op), group, (entity) =>
      pass.ctx.events.emit({ kind: 'missionLandscapeResourceRemoved', entity }),
    );
    for (const node of opened) freed.add(node);
  }
  if (revision !== landscapeTopologyRevision(pass.world)) {
    // Freed nodes do not invalidate an existing route. A newly blocked node can cross one, whether
    // it came from the landscape layer or a resource-backed chest/deposit.
    const blocked = dynamicBlockOverlay(pass.world, pass.ctx, terrain);
    if (openBefore.some((node) => blocked.has(node))) {
      invalidateLandscapeRoutes(pass.world, terrain);
    }
    pass.ctx.events.emit({ kind: 'missionLandscapeChanged' });
  }
}

/** The walk cells a placement of `typeId` at `point` would stamp that nothing blocks yet. */
function openCellsOf(pass: MissionPass, point: HalfCellNode, typeId: number): NodeId[] {
  const terrain = pass.ctx.terrain;
  const type = terrain === undefined ? undefined : landscapeTypes(terrain).get(typeId);
  if (terrain === undefined || type === undefined) return [];
  const blocked = dynamicBlockOverlay(pass.world, pass.ctx, terrain);
  return translatedCells(terrain, placementWalkCells(pass.ctx.content, type), point.hx, point.hy).filter(
    (node) => !blocked.has(node),
  );
}

/** The hexagon radius a removal clears: `RemoveLandscapesInArea` stops one ring short of its `range`
 *  while the group removals include the ring at `range` (reading). */
function removalRange(op: LandscapeOp): number {
  if (!('range' in op)) return 0;
  return op.opcode === 'RemoveLandscapesInArea' ? Math.max(0, op.range - 1) : op.range;
}
