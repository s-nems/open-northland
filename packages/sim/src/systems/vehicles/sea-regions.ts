import type { World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { ClearanceField } from '../../nav/clearance.js';
import { type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { vehicleClearance } from '../footprint/vehicle-clearance.js';

// The parts of the sea a hull of one size can sail between: the water nodes whose free-size class
// admits it, split where a strait narrows below it, over the pathfinder's own edges. Other vehicles are
// left out, since they close a route for a moment and never a sea. The labels change only with a water
// class (`ClearanceField.waterRevision`), so a ship's reach over a whole sea is a lookup, not a flood.
// Derived state, never hashed.

const NO_REGION = -1;

export interface SeaRegions {
  /** Changes whenever a label may have. */
  readonly key: string;
  /** The region of a node the hull may lie on, {@link NO_REGION} for any other node. */
  regionOf(node: NodeId): number;
  /** The regions a hull on `node` can sail into: its own, or, for a node that closed under it, those of
   *  the open neighbours it may still leave by. Ascending. */
  regionsFrom(node: NodeId): readonly number[];
}

interface Labels {
  readonly field: ClearanceField;
  readonly terrain: TerrainGraph;
  readonly waterRevision: number;
  readonly labels: Int32Array;
  readonly regions: SeaRegions;
}

/** Per world, one labelling per hull size, and a count of labellings that keys each one apart. */
interface WorldLabels {
  readonly bySize: Map<number, Labels>;
  labellings: number;
}

const labelsByWorld = new WeakMap<World, WorldLabels>();

export function seaRegions(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  logicSize: number,
): SeaRegions {
  const field = vehicleClearance(world, ctx, terrain);
  let memo = labelsByWorld.get(world);
  if (memo === undefined) {
    const created: WorldLabels = { bySize: new Map(), labellings: 0 };
    labelsByWorld.set(world, created);
    world.registerCacheVerifier('seaRegions', () => verifyLabels(created));
    memo = created;
  }
  const held = memo.bySize.get(logicSize);
  if (
    held !== undefined &&
    held.field === field &&
    held.terrain === terrain &&
    held.waterRevision === field.waterRevision
  ) {
    return held.regions;
  }
  memo.labellings += 1;
  const labels = labelSea(terrain, field, logicSize);
  const regions = regionsOver(terrain, field, logicSize, labels, `${memo.labellings}`);
  memo.bySize.set(logicSize, { field, terrain, waterRevision: field.waterRevision, labels, regions });
  return regions;
}

/** The coherence tripwire: a labelling that claims its field's current water classes must match a fresh
 *  one. A field behind the world is the clearance verifier's report. */
function verifyLabels(memo: WorldLabels): string[] {
  const errors: string[] = [];
  for (const [logicSize, held] of memo.bySize) {
    if (held.field.waterRevision !== held.waterRevision) continue; // relabelled on the next read
    const fresh = labelSea(held.terrain, held.field, logicSize);
    if (fresh.some((region, node) => held.labels[node] !== region)) {
      errors.push(
        `seaRegions for hull size ${logicSize} disagree with the water classes - a class edit missed the revision`,
      );
    }
  }
  return errors;
}

function closedTo(field: ClearanceField, logicSize: number): BlockOverlay {
  return { has: (node) => field.classOf(node) < logicSize, size: 1 };
}

/** Region labels in ascending node order of each region's first node, so a labelling is a pure function
 *  of the classes. */
function labelSea(terrain: TerrainGraph, field: ClearanceField, logicSize: number): Int32Array {
  const closed = closedTo(field, logicSize);
  const labels = new Int32Array(terrain.nodeCount).fill(NO_REGION);
  const queue: NodeId[] = [];
  const edges = new StepBuffer();
  let next = 0;
  for (let n = 0; n < terrain.nodeCount; n++) {
    const seed = n as NodeId;
    if (labels[seed] !== NO_REGION || !terrain.isWater(seed) || closed.has(seed)) continue;
    labels[seed] = next;
    queue.length = 0;
    queue.push(seed);
    // The array iterator re-reads `length`, so `queue` is a live breadth-first queue.
    for (const current of queue) {
      terrain.stepsInto(current, closed, edges, 'water');
      for (let i = 0; i < edges.length; i++) {
        const { node } = edges.at(i);
        if (labels[node] !== NO_REGION) continue;
        labels[node] = next;
        queue.push(node);
      }
    }
    next += 1;
  }
  return labels;
}

function regionsOver(
  terrain: TerrainGraph,
  field: ClearanceField,
  logicSize: number,
  labels: Int32Array,
  key: string,
): SeaRegions {
  const closed = closedTo(field, logicSize);
  const edges = new StepBuffer();
  const regionOf = (node: NodeId): number => labels[node] ?? NO_REGION;
  return {
    key,
    regionOf,
    regionsFrom: (node) => {
      const own = regionOf(node);
      if (own !== NO_REGION) return [own];
      terrain.stepsInto(node, closed, edges, 'water');
      const out = new Set<number>();
      for (let i = 0; i < edges.length; i++) out.add(regionOf(edges.at(i).node));
      return [...out].sort((a, b) => a - b);
    },
  };
}
