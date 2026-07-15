import { Position, Stockpile } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import type { FarmingSpec } from '../../economy/farming.js';
import { dynamicBlockedCells } from '../../footprint/index.js';
import { manhattan } from '../../spatial.js';
import { lowestStockedGood } from '../../stores/index.js';
import { interactionCell, nearestByCell, type TargetCandidates } from '../targets/index.js';
import type { FarmClaims, SowScan } from './claims.js';

/**
 * The nearest cut-sheaf {@link import('../../components/index.js').GroundDrop} of the farmed good lying
 * within the farm's field radius (measured from the FARM's anchor — a farmer never chases a sheaf
 * across the map), by Manhattan distance from the farmer, ascending-cell-id tie-break, canonical scan.
 * The pile's good is its lowest-id stocked good (an emptied, about-to-reap pile is skipped); a sheaf a
 * colleague already claimed is skipped too. Returns the pile entity or null.
 */
export function nearestFarmSheaf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  targets: TargetCandidates,
  anchor: NodeId,
  here: NodeId,
  spec: FarmingSpec,
  claims: FarmClaims,
): Entity | null {
  // Ranked from the farmer (`here`); the field-radius gate measures from the farm `anchor` instead, so a
  // farmer never chases a sheaf across the map (a separate origin the shared loop leaves inside `resolve`).
  return (
    nearestByCell(terrain, targets.groundDrops, here, (e) => {
      if (lowestStockedGood(world.get(e, Stockpile)) !== spec.goodType) return null; // not this farm's crop
      // Cheap radius prefilter on the drop's own anchor node before the interaction-cell resolve — that
      // resolve walks the resource store per drop, so paying it for every same-good drop world-wide per
      // replanning farmer was an O(drops × resources) tick cost. The slack covers the most an interaction
      // cell can sit from its anchor (one footprint cell), so no drop the exact check below would accept
      // is ever pre-dropped.
      const p = world.get(e, Position);
      const n = nodeOfPosition(p.x, p.y);
      const own = terrain.nodeAtClamped(n.hx, n.hy);
      if (manhattan(terrain, anchor, own) > spec.farming.fieldRadius + SHEAF_PREFILTER_SLACK) return null;
      const cell = interactionCell(world, ctx, terrain, e, here);
      if (claims.nodes.has(cell)) return null; // a colleague is already carrying this one off
      if (manhattan(terrain, anchor, cell) > spec.farming.fieldRadius) return null; // beyond the farm's fields
      return cell;
    })?.entity ?? null
  );
}

/** Node slack the sheaf-carry radius PREFILTER allows over `fieldRadius`: an interaction cell sits at
 *  most one footprint cell (2 nodes) from its entity's anchor, so prefiltering on the anchor with this
 *  slack never drops a sheaf the exact interaction-cell check would accept. */
const SHEAF_PREFILTER_SLACK = 2;

/** Base sow-lattice pitch in half-cell nodes: one field per CELL before jitter, so fields sit about a
 *  tile apart — the original's packed-but-not-hex-stacked wheat spread (observed). */
const FIELD_LATTICE_STEP = 2;
/** 32-bit coordinate-mix constants for the per-field jitter hash (the golden-ratio / murmur3 mixers —
 *  any fixed odd constants serve; the hash only has to be deterministic and spatially uncorrelated). */
const JITTER_HASH_X = 0x9e3779b1;
const JITTER_HASH_Y = 0x85ebca6b;

/** The deterministic 0/+1-node jitter of one base lattice point (each axis shifts by 0 or 1 node) —
 *  a pure coordinate hash (never `world.rng`: a field position must not consume the command-stream's
 *  RNG), so the same point always jitters the same way and the sowing pattern is byte-stable across
 *  runs and replays. */
function sowJitter(bx: number, by: number): { dx: number; dy: number } {
  const h = (Math.imul(bx, JITTER_HASH_X) ^ Math.imul(by, JITTER_HASH_Y)) >>> 0;
  return { dx: h & 1, dy: (h >>> 1) & 1 };
}

/**
 * The node the farm should sow NEXT: the free jittered-lattice node nearest the farm's anchor (fields
 * grow outward from the farm), or null when the whole radius is taken. The lattice is one base point
 * per {@link FIELD_LATTICE_STEP} nodes, each shifted by its own deterministic {@link sowJitter} — the
 * user-specified "minimally scattered, not hex-stacked" field spread. A candidate must be on the map,
 * walkable (the farmer stands ON the field to work it — wheat is walkable in the data), PLANTABLE
 * ground (the original's `biocanplanton` triangle flag — only grass/land carries it, so no field ever
 * lands on sand/desert/snow), clear of the walk-block overlays (building walls, standing resources),
 * not occupied by any resource/field/heap, and not claimed by another farmer's in-flight action.
 *
 * Cost: O(radius² / step²) candidates per sow attempt, plus ONE O(resources + stockpiles + footprints)
 * occupancy/blockage index per TICK — built by the first farmer to reach its sow step, reused by every
 * later one ({@link FarmClaims.sowScan}); an idle farmer replanning against an exhausted ring must not
 * rebuild the world index every tick.
 */
export function nextSowNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  targets: TargetCandidates,
  anchor: NodeId,
  spec: FarmingSpec,
  claims: FarmClaims,
): NodeId | null {
  claims.sowScan ??= buildSowScan(world, ctx, terrain, targets);
  const { blocked, occupied } = claims.sowScan;

  const at = terrain.coordsOf(anchor);
  const radius = spec.farming.fieldRadius;
  const first = (v: number): number => Math.floor((v - radius) / FIELD_LATTICE_STEP) * FIELD_LATTICE_STEP;
  let best: NodeId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let by = first(at.y); by <= at.y + radius; by += FIELD_LATTICE_STEP) {
    for (let bx = first(at.x); bx <= at.x + radius; bx += FIELD_LATTICE_STEP) {
      const j = sowJitter(bx, by);
      const hx = bx + j.dx;
      const hy = by + j.dy;
      if (!terrain.inBounds(hx, hy)) continue;
      const node = terrain.nodeAt(hx, hy);
      const dist = manhattan(terrain, anchor, node);
      if (dist > radius) continue; // outside the farm's field ring
      if (!terrain.isWalkable(node) || blocked.has(node)) continue; // water/walls/standing bodies
      if (!terrain.isPlantable(node)) continue; // barren ground (sand/desert/snow) — grain needs grass
      if (occupied.has(node) || claims.nodes.has(node)) continue; // taken, or claimed by a colleague
      if (dist < bestDist || (dist === bestDist && (best === null || node < best))) {
        best = node;
        bestDist = dist;
      }
    }
  }
  return best;
}

/** Build the tick's {@link SowScan}: the dynamic walk-block overlay plus every node a standing entity
 *  occupies (resources + fields, stores, loose heaps, dropped sheaves). Pure tick-start world state —
 *  see {@link FarmClaims.sowScan} for why it is built once per tick, not per farmer. */
function buildSowScan(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  targets: TargetCandidates,
): SowScan {
  const occupied = new Set<NodeId>();
  const occupy = (e: Entity): void => {
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    occupied.add(terrain.nodeAtClamped(n.hx, n.hy));
  };
  for (const e of targets.resources) occupy(e);
  for (const e of targets.stockpiles) occupy(e);
  return { blocked: dynamicBlockedCells(world, ctx, terrain), occupied };
}
