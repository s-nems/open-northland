import type { World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { ClearanceField } from '../../nav/clearance.js';
import {
  NO_READMITTED,
  type NodeId,
  StepBuffer,
  StepGate,
  type TerrainGraph,
} from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { vehicleClearance } from '../footprint/vehicle-clearance.js';

// The parts of the sea a hull of one size can sail between: the water nodes whose free-size class
// admits it, split where a strait narrows below it, over the pathfinder's own edges. Other vehicles are
// left out, since they close a route for a moment and never a sea. The labels change only with a water
// class crossing the hull's size (`ClearanceField.waterRevision`), so a ship's reach over a whole sea
// is a lookup, not a flood. Derived state, never hashed.

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
    held.waterRevision === field.waterRevision(logicSize)
  ) {
    return held.regions;
  }
  memo.labellings += 1;
  const labels = labelSea(terrain, field, logicSize);
  const regions = regionsOver(terrain, field, logicSize, labels, `${memo.labellings}`);
  memo.bySize.set(logicSize, {
    field,
    terrain,
    waterRevision: field.waterRevision(logicSize),
    labels,
    regions,
  });
  return regions;
}

/** The coherence tripwire: a labelling that claims its field's current water classes must match a fresh
 *  one. A field behind the world is the clearance verifier's report. */
function verifyLabels(memo: WorldLabels): string[] {
  const errors: string[] = [];
  for (const [logicSize, held] of memo.bySize) {
    const below = held.field.belowLane(logicSize);
    for (let node = 0; node < held.terrain.nodeCount; node++) {
      if ((below[node] === 1) !== held.field.classOf(node as NodeId) < logicSize) {
        errors.push(`the below-${logicSize} class lane disagrees with node ${node}'s class`);
        break;
      }
    }
    if (held.field.waterRevision(logicSize) !== held.waterRevision) continue; // relabelled on the next read
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
  const below = field.belowLane(logicSize);
  return { has: (node) => below[node] === 1, size: 1 };
}

/** Region labels in ascending node order of each region's first node, so a labelling is a pure function
 *  of the classes. A region is the set its first node reaches, so the flood's visiting order is free. */
function labelSea(terrain: TerrainGraph, field: ClearanceField, logicSize: number): Int32Array {
  const closed = field.belowLane(logicSize);
  const gate = new StepGate();
  terrain.resetGate(gate, 'water', undefined, NO_READMITTED);
  const lane = gate.lane;
  const { nodeCount, width } = terrain;
  const labels = new Int32Array(nodeCount).fill(NO_REGION);
  // Each node is labelled, and so pushed, once.
  const stack = new Int32Array(nodeCount);
  let next = 0;
  for (let seed = 0; seed < nodeCount; seed++) {
    if (labels[seed] !== NO_REGION || closed[seed] === 1 || !terrain.isWater(seed as NodeId)) continue;
    labels[seed] = next;
    let top = 0;
    stack[top++] = seed;
    while (top > 0) {
      const current = stack[--top] ?? 0;
      const open = lane[current] ?? 0;
      if (open === 0) continue;
      const offsets = terrain.stepOffsets(Math.floor(current / width));
      for (let edge = 0; edge < offsets.length; edge++) {
        if ((open & (1 << edge)) === 0) continue;
        const neighbour = current + (offsets[edge] ?? 0);
        if (closed[neighbour] === 1 || labels[neighbour] !== NO_REGION) continue;
        labels[neighbour] = next;
        stack[top++] = neighbour;
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
