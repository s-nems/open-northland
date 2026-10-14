import { Building, ownerOf, Position } from '../../../components/index.js';
import { ONE } from '../../../core/fixed.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/graph.js';
import type { MissionPass } from '../pass.js';
import type { MissionGoalOp } from '../script.js';
import { carriedPoint, entityPoint, missionHumans } from '../targets.js';

/** Authored `lmco` labels need not agree with navigation connectivity. Generated maps without that
 * lane use static movement components as an approximation. Out-of-map points never match. */
function continentAt(terrain: TerrainGraph, point: HalfCellNode | undefined): number | undefined {
  if (point === undefined || !terrain.inBounds(point.hx, point.hy)) return undefined;
  const node = terrain.nodeAt(point.hx, point.hy);
  const authored = terrain.waterContinents?.[node];
  if (authored !== undefined) return authored;
  const component = terrain.componentOf(node);
  return component < 0 ? undefined : component;
}

export function humanOnContinent(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'HumanIsOnContinent' }>,
): boolean | undefined {
  const terrain = pass.ctx.terrain;
  if (terrain === undefined) return undefined;
  const continent = continentAt(terrain, op.point);
  if (continent === undefined) return false;
  return missionHumans(pass.world, op.humanId).some(
    (entity) => continentAt(terrain, carriedPoint(pass.world, entity)) === continent,
  );
}

export function houseOnContinent(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'BuildHouseOnContinent' }>,
): boolean | undefined {
  const terrain = pass.ctx.terrain;
  if (terrain === undefined) return undefined;
  const continent = continentAt(terrain, op.point);
  if (continent === undefined) return false;
  for (const entity of pass.world.query(Building, Position)) {
    const building = pass.world.get(entity, Building);
    if (building.built !== ONE || building.buildingType !== op.houseType) continue;
    if (ownerOf(pass.world, entity) !== op.player) continue;
    if (continentAt(terrain, entityPoint(pass.world, entity)) === continent) return true;
  }
  return false;
}
