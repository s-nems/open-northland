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
  // Resource footprints are live mutable caches: copy before the edit to retain the old union.
  const before = walkBlocks(pass, terrain);
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
    removeLandscapes(pass.world, terrain, op.point, 'range' in op ? op.range : 0, group, (entity) =>
      pass.ctx.events.emit({ kind: 'missionLandscapeResourceRemoved', entity }),
    );
  }
  if (revision !== landscapeTopologyRevision(pass.world)) {
    const after = walkBlocks(pass, terrain);
    if (before.size !== after.size || [...before].some((node) => !after.has(node))) {
      invalidateLandscapeRoutes(pass.world, terrain);
    }
    pass.ctx.events.emit({ kind: 'missionLandscapeChanged' });
  }
}

function walkBlocks(pass: MissionPass, terrain: TerrainGraph): Set<NodeId> {
  const result = new Set<NodeId>();
  for (const layer of dynamicBlockLayers(pass.world, pass.ctx, terrain)) {
    for (const node of layer) result.add(node);
  }
  return result;
}
