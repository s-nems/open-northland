import { Position, Stockpile } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { nodeOfPosition } from '../../../../nav/halfcell.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { type FarmingSpec, sowNodeOccupied } from '../../../economy/fields.js';
import { dynamicBlockOverlay } from '../../../footprint/index.js';
import { manhattan, ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../../../spatial/metric.js';
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

/** Free nodes nearest the anchor a sow draws among, uniformly. Original behavior:
 *  a sow stops at the first five plantable points out from the work centre and rolls one of them.
 *  Approximation: its search order and the packing onto every lattice node are unknown; a plot here
 *  grows as a compact patch with a ragged edge, its plants a node apart, which is what puts them in one
 *  another's watering ring. */
const SOW_CANDIDATES = 5;

/**
 * The node the farm should sow next: the spot this farmer already set out for while it stays sowable, else
 * one of the {@link SOW_CANDIDATES} free nodes nearest the farm's anchor, so fields pack outward from the
 * farm; null when the whole radius is taken. A sowable node is on the map, walkable (the farmer stands on
 * the field to work it), plantable ground (the original demands the `biocanplanton`
 * flag on all six triangles around the point, which `trianglepatterntypes.cif` gives to `land` alone; the
 * cell-resolution class carries it here), clear of the walk-block overlays, unoccupied, and unclaimed by
 * another farmer's in-flight action.
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
  const { world, ctx, terrain, here, entity } = plan;
  const { anchor, spec, claims, gates } = opts;
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const radius = spec.farming.fieldRadius;

  const sowable = (node: NodeId, hx: number, hy: number): boolean =>
    terrain.isWalkable(node) &&
    !blocked.has(node) && // water, walls, standing bodies
    terrain.isPlantable(node) &&
    !claims.nodes.has(node) &&
    !sowNodeOccupied(world, hx, hy) &&
    // The sow node is the walk goal, so without this the farmer re-picks the same unreachable spot every
    // replan and its whole plot goes untended behind it.
    !unreachableWorkCell(gates, here, node);

  const intent = claims.sowIntent.get(entity);
  if (intent !== undefined && manhattan(terrain, anchor, intent) <= radius) {
    const at = terrain.coordsOf(intent);
    if (sowable(intent, at.x, at.y)) return intent;
  }

  const at = terrain.coordsOf(anchor);
  const candidates: NodeId[] = [];
  // Ring by ring outward, stopping at the first ring that completes the set: offsets ascend by node id
  // within a ring, so the first entries are the canonical (distance, id) nearest.
  for (let r = 0; r <= radius && candidates.length < SOW_CANDIDATES; r++) {
    const count = ringOffsetCount(r);
    for (let i = 0; i < count && candidates.length < SOW_CANDIDATES; i++) {
      const hx = at.x + ringOffsetDx(r, i);
      const hy = at.y + ringOffsetDy(r, i);
      if (!terrain.inBounds(hx, hy)) continue;
      const node = terrain.nodeAt(hx, hy);
      if (sowable(node, hx, hy)) candidates.push(node);
    }
  }
  if (candidates.length === 0) return null;
  return candidates[ctx.rng.int(candidates.length)] ?? null;
}
