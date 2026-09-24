import { landscapeTopologyRevision } from '../../../components/landscape.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { LandscapeRemovalGroup, NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { translatedCells } from '../../footprint/geometry.js';
import { dynamicBlockOverlay } from '../../footprint/index.js';
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

type RemovalOp = Extract<
  MissionResultOp,
  {
    opcode:
      | 'RemoveLandscape'
      | 'RemoveLandscapesInArea'
      | 'RemoveFXWaveLandscapeInArea'
      | 'RemoveFXSmokeLandscapeInArea'
      | 'RemoveBlockerLandscapeInArea'
      | 'RemoveFX1LandscapeInArea'
      | 'RemoveFX2LandscapeInArea';
  }
>;

/** The landscape group a removal is limited to; the two plain removals take every group. */
const REMOVAL_GROUPS: Readonly<Record<RemovalOp['opcode'], LandscapeRemovalGroup | undefined>> = {
  RemoveLandscape: undefined,
  RemoveLandscapesInArea: undefined,
  RemoveFXWaveLandscapeInArea: 'wave',
  RemoveFXSmokeLandscapeInArea: 'smoke',
  RemoveBlockerLandscapeInArea: 'blocker',
  RemoveFX1LandscapeInArea: 'fx1',
  RemoveFX2LandscapeInArea: 'fx2',
};

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
  if (op.opcode === 'SetLandscape') {
    if (!layScriptedLandscape(pass, terrain, op.point, op.landscape, op.level))
      pass.reportFailed(mission, op.opcode);
    return;
  }
  const revision = landscapeTopologyRevision(pass.world);
  const freed = freedThisPass(pass);
  const opened = removeLandscapes(
    pass.world,
    terrain,
    op.point,
    removalRange(op),
    REMOVAL_GROUPS[op.opcode],
    (entity) => pass.ctx.events.emit({ kind: 'missionLandscapeResourceRemoved', entity }),
  );
  for (const node of opened) freed.add(node);
  // A removal only opens cells, so no route has to be planned again.
  announceLandscapeChange(pass, terrain, revision, []);
}

/**
 * Lay one landscape object, a script chest included, and send routes back to the planner only when
 * it closes a cell that was open when the pass began: replacing an object with one of the same shape,
 * in one result or by removing it and laying it again in the same pass, closes none.
 */
export function layScriptedLandscape(
  pass: MissionPass,
  terrain: TerrainGraph,
  point: HalfCellNode,
  typeId: number,
  level: number,
): boolean {
  const freed = freedThisPass(pass);
  const openBefore = openCellsOf(pass, point, typeId).filter((node) => !freed.has(node));
  const revision = landscapeTopologyRevision(pass.world);
  if (!setLandscape(pass.world, pass.ctx, point, typeId, level)) return false;
  announceLandscapeChange(pass, terrain, revision, openBefore);
  return true;
}

function freedThisPass(pass: MissionPass): Set<NodeId> {
  pass.landscapeFreed ??= new Set();
  return pass.landscapeFreed;
}

/** Tell the planner and the display that the topology moved, if it did. Freed nodes do not
 *  invalidate an existing route; a newly blocked one can cross it, whether it came from the landscape
 *  layer or a resource-backed chest or deposit. */
function announceLandscapeChange(
  pass: MissionPass,
  terrain: TerrainGraph,
  revision: number,
  openBefore: readonly NodeId[],
): void {
  if (revision === landscapeTopologyRevision(pass.world)) return;
  const blocked = dynamicBlockOverlay(pass.world, pass.ctx, terrain);
  if (openBefore.some((node) => blocked.has(node))) invalidateLandscapeRoutes(pass.world, terrain);
  pass.ctx.events.emit({ kind: 'missionLandscapeChanged' });
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
function removalRange(op: RemovalOp): number {
  if (!('range' in op)) return 0;
  return op.opcode === 'RemoveLandscapesInArea' ? Math.max(0, op.range - 1) : op.range;
}
