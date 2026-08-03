import { Position, Stockpile } from '../../../../components/index.js';
import { coordHash } from '../../../../core/coord-hash.js';
import type { Entity } from '../../../../ecs/world.js';
import { nodeOfPosition } from '../../../../nav/halfcell.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { type FarmingSpec, sowNodeOccupied } from '../../../economy/fields.js';
import { dynamicBlockOverlay } from '../../../footprint/index.js';
import { closer, manhattan } from '../../../spatial/nodes.js';
import { lowestStockedGood } from '../../../stores/index.js';
import type { PlannerContext } from '../../planner/context.js';
import {
  interactionCell,
  nearestByCell,
  unreachableWorkCell,
  type WorkCellGates,
} from '../../targets/index.js';
import type { FarmClaims } from './claims.js';

/**
 * The nearest cut sheaf of the farmed good lying within the farm's field radius, or null. Ranked by
 * Manhattan distance from the farmer with an ascending-cell-id tie-break, while the radius is measured from
 * the farm's anchor, so a farmer never chases a sheaf across the map.
 */
export function nearestFarmSheaf(
  plan: PlannerContext,
  opts: {
    readonly anchor: NodeId;
    readonly spec: FarmingSpec;
    readonly claims: FarmClaims;
    readonly gates: WorkCellGates;
  },
): Entity | null {
  const { world, ctx, terrain, here, targets } = plan;
  const { anchor, spec, claims, gates } = opts;
  return (
    nearestByCell(terrain, targets.groundDrops, here, (e) => {
      if (lowestStockedGood(world.get(e, Stockpile)) !== spec.goodType) return null; // not this farm's crop
      // Radius prefilter on the drop's own anchor node before the interaction-cell resolve, which walks the
      // resource store per drop.
      const p = world.get(e, Position);
      const n = nodeOfPosition(p.x, p.y);
      const own = terrain.nodeAtClamped(n.hx, n.hy);
      if (manhattan(terrain, anchor, own) > spec.farming.fieldRadius + SHEAF_PREFILTER_SLACK) return null;
      const cell = interactionCell(world, ctx, terrain, e, here);
      if (claims.nodes.has(cell)) return null;
      if (unreachableWorkCell(gates, here, cell)) return null;
      if (manhattan(terrain, anchor, cell) > spec.farming.fieldRadius) return null;
      return { cell, payload: null };
    })?.entity ?? null
  );
}

/** Node slack the sheaf prefilter allows over `fieldRadius`: an interaction cell sits at most one footprint
 *  cell from its entity's anchor, so the prefilter never drops a sheaf the exact check would accept. */
const SHEAF_PREFILTER_SLACK = 2;

/** Base sow-lattice pitch in half-cell nodes, one field per cell before jitter. Observation: the original's
 *  packed but not hex-stacked wheat spread. */
const FIELD_LATTICE_STEP = 2;

/** The deterministic 0/+1-node jitter of one base lattice point, so the sowing pattern is byte-stable
 *  across runs and replays. */
function sowJitter(bx: number, by: number): { dx: number; dy: number } {
  const h = coordHash(bx, by);
  return { dx: h & 1, dy: (h >>> 1) & 1 };
}

/**
 * The node the farm should sow next: the free jittered-lattice node nearest the farm's anchor, so fields
 * grow outward from the farm, or null when the whole radius is taken. A candidate must be on the map,
 * walkable (the farmer stands on the field to work it), plantable ground (the original's `biocanplanton`
 * triangle flag, carried only by grass and land), clear of the walk-block overlays, unoccupied, and
 * unclaimed by another farmer's in-flight action.
 */
export function nextSowNode(
  plan: PlannerContext,
  opts: {
    readonly anchor: NodeId;
    readonly spec: FarmingSpec;
    readonly claims: FarmClaims;
    readonly gates: WorkCellGates;
  },
): NodeId | null {
  const { world, ctx, terrain, here } = plan;
  const { anchor, spec, claims, gates } = opts;
  const blocked = dynamicBlockOverlay(world, ctx, terrain);

  const at = terrain.coordsOf(anchor);
  const radius = spec.farming.fieldRadius;
  const first = (v: number): number => Math.floor((v - radius) / FIELD_LATTICE_STEP) * FIELD_LATTICE_STEP;
  let best: NodeId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (let by = first(at.y); by <= at.y + radius; by += FIELD_LATTICE_STEP) {
    for (let bx = first(at.x); bx <= at.x + radius; bx += FIELD_LATTICE_STEP) {
      const j = sowJitter(bx, by);
      const hx = bx + j.dx;
      const hy = by + j.dy;
      if (!terrain.inBounds(hx, hy)) continue;
      const node = terrain.nodeAt(hx, hy);
      const dist = manhattan(terrain, anchor, node);
      if (dist > radius) continue;
      if (!terrain.isWalkable(node) || blocked.has(node)) continue; // water, walls, standing bodies
      if (!terrain.isPlantable(node)) continue;
      if (claims.nodes.has(node) || sowNodeOccupied(world, hx, hy)) continue;
      // The sow node is the walk goal, so without this the farmer re-picks the same unreachable spot every
      // replan and its whole plot goes untended behind it.
      if (unreachableWorkCell(gates, here, node)) continue;
      if (closer(dist, node, bestDist, bestCell)) {
        best = node;
        bestDist = dist;
        bestCell = node;
      }
    }
  }
  return best;
}
