import type { WaveMarchState } from '../../../../components/index.js';
import type { DeepReadonly, Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { dynamicBlockOverlay } from '../../../footprint/index.js';
import { snapVehicleTarget } from '../../../vehicles/movement.js';
import { firstRingNode } from '../../node-geometry.js';
import { isRangedFighter } from '../census.js';
import { PARK_SPACING_NODES } from '../siege-crew.js';
import { backOf, clampNode, fileOffset, headingOf, nodeOf, offset } from './geometry.js';

// Where a marching wave's men and catapults stand at a leg end. Approximation, like every shape of the
// march: the original's army formation is unobserved.

/** How far behind the catapult line the first rank stands: three cells. */
export const RANKS_BEHIND_CATAPULTS_NODES = 6;

/** One cell between two men of a rank, and between two ranks. */
const FILE_SPACING_NODES = 2;
const RANK_STEP_NODES = 2;

/** Men to a rank before the next one starts behind it. */
const RANK_WIDTH_MEN = 8;

/** How far a man's place may slide to open ground before the raw place is kept for the order to snap. */
const PLACE_SNAP_NODES = 4;

export type WaveMarchView = DeepReadonly<WaveMarchState>;

/** Where each man and catapult stands at the current leg end. */
export function formation(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  state: WaveMarchView,
  members: readonly Entity[],
  catapults: readonly Entity[],
): Map<Entity, HalfCellNode> {
  const end = state.waypoints[Math.min(state.leg, state.waypoints.length - 1)] ?? state.origin;
  const from = state.leg === 0 ? state.origin : (state.waypoints[state.leg - 1] ?? state.origin);
  return formationAt(world, ctx, terrain, from, end, members, catapults);
}

/**
 * The places at leg end `end`, facing away from `from`: with catapults, their line on the leg end and the
 * men's ranks behind it, melee first and the archers behind them, so nobody stands ahead of the catapults;
 * without, the melee ranks on the leg end and the archers behind. A rank is {@link RANK_WIDTH_MEN} wide and
 * a man's place slides to the nearest open node ({@link PLACE_SNAP_NODES}).
 */
function formationAt(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: HalfCellNode,
  end: HalfCellNode,
  men: readonly Entity[],
  catapults: readonly Entity[],
): Map<Entity, HalfCellNode> {
  const places = new Map<Entity, HalfCellNode>();
  const heading = headingOf(from, end);
  // The ranks start behind the rearmost catapult, wherever the snap to open ground has put it.
  let lineBack = 0;
  catapults.forEach((vehicle, i) => {
    const raw = clampNode(terrain, offset(end, heading, 0, fileOffset(i) * PARK_SPACING_NODES));
    const snapped = snapVehicleTarget(world, ctx, terrain, vehicle, raw);
    const place = snapped === null ? raw : nodeOf(terrain, snapped);
    places.set(vehicle, place);
    lineBack = Math.max(lineBack, backOf(end, heading, place));
  });
  const melee = men.filter((e) => !isRangedFighter(world, ctx, e));
  const ranged = men.filter((e) => isRangedFighter(world, ctx, e));
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const reachable = terrain.componentOf(terrain.nodeAtClamped(end.hx, end.hy));
  const open = (x: number, y: number): boolean => {
    if (!terrain.inBounds(x, y)) return false;
    const node = terrain.nodeAt(x, y);
    return terrain.isWalkable(node) && terrain.componentOf(node) === reachable && !blocked.has(node);
  };
  const firstRankBack = catapults.length > 0 ? lineBack + RANKS_BEHIND_CATAPULTS_NODES : 0;
  const rank = (band: readonly Entity[], firstBack: number): void => {
    band.forEach((e, i) => {
      const back = firstBack + Math.floor(i / RANK_WIDTH_MEN) * RANK_STEP_NODES;
      const side = fileOffset(i % RANK_WIDTH_MEN) * FILE_SPACING_NODES;
      const raw = clampNode(terrain, offset(end, heading, back, side));
      places.set(e, firstRingNode(raw.hx, raw.hy, PLACE_SNAP_NODES, open) ?? raw);
    });
  };
  rank(melee, firstRankBack);
  rank(ranged, firstRankBack + Math.ceil(melee.length / RANK_WIDTH_MEN) * RANK_STEP_NODES);
  return places;
}
