import { clamp } from '../math.js';
import { staggerBlur } from './minimap-grid.js';
import { MINIMAP_DEPOSIT_KINDS, type MinimapDepositKind } from './minimap-scene.js';

/**
 * The placed-object half of the minimap scene. Which placed object is forest or a deposit is content:
 * the caller resolves each `EditName` through the IR's gathering-pipeline harvest join
 * (`[GfxLandscape]` index → the good it yields) and passes {@link minimapFeatureOfGood} of that good.
 * This module only bins the classified placements into the raster's lanes, so the raster stays
 * content-free.
 */

export type MinimapFeature = 'forest' | MinimapDepositKind;

/**
 * How the minimap depicts the objects that yield each good, keyed by the IR `goodId`: a presentation
 * binding like an icon, not a game rule. A good absent here draws nothing.
 */
const FEATURE_OF_GOOD: ReadonlyMap<string, MinimapFeature> = new Map([
  ['wood', 'forest'],
  ['stone', 'stone'],
  ['mud', 'clay'],
  ['iron', 'iron'],
  ['gold', 'gold'],
]);

export function minimapFeatureOfGood(goodId: string): MinimapFeature | undefined {
  return FEATURE_OF_GOOD.get(goodId);
}

/** The placed objects as the decoded map stores them: flat `[hx, hy, typeIndex]` half-cell triples. */
export interface MinimapObjects {
  readonly types: readonly string[];
  readonly placements: readonly number[];
}

/** The `MinimapScene` lanes placed objects fill. */
export interface MinimapObjectLanes {
  readonly forest: Float32Array;
  readonly depositKind: Uint8Array;
  readonly depositDensity: Float32Array;
}

/** Objects per cell, averaged over the cell and its six neighbours, that make a full canopy or a full
 *  ore field. */
const TREES_FOR_FULL_CANOPY = 0.8;
const DEPOSITS_FOR_FULL_FIELD = 0.5;
const PLACEMENT_STRIDE = 3;
/** Half-cell lattice nodes per cell along each axis. */
const NODES_PER_CELL = 2;
/** The `depositKind` of a cell without deposits. */
const NO_DEPOSIT = 0;

/**
 * Bin classified placements into per-cell canopy density and deposit kind and density. A node counts
 * toward the cell of its row pair; when deposits of several kinds share a cell, the later kind in
 * {@link MINIMAP_DEPOSIT_KINDS} (the rarer one) names it.
 */
export function minimapObjectLanes(
  width: number,
  height: number,
  objects: MinimapObjects,
  featureOf: (editName: string) => MinimapFeature | undefined,
): MinimapObjectLanes {
  const cells = width * height;
  const trees = new Float32Array(cells);
  const deposits = new Float32Array(cells);
  const kinds = new Uint8Array(cells);
  const featureOfType = objects.types.map((name) => featureOf(name));
  for (let i = 0; i + PLACEMENT_STRIDE - 1 < objects.placements.length; i += PLACEMENT_STRIDE) {
    const feature = featureOfType[objects.placements[i + 2] ?? -1];
    if (feature === undefined) continue;
    const hx = objects.placements[i] ?? 0;
    const hy = objects.placements[i + 1] ?? 0;
    const row = clamp(Math.floor(hy / NODES_PER_CELL), 0, height - 1);
    const col = clamp(Math.floor((hx - (row & 1)) / NODES_PER_CELL), 0, width - 1);
    const cell = row * width + col;
    if (feature === 'forest') {
      trees[cell] = (trees[cell] ?? 0) + 1;
      continue;
    }
    deposits[cell] = (deposits[cell] ?? 0) + 1;
    const kind = MINIMAP_DEPOSIT_KINDS.indexOf(feature) + 1;
    if (kind > (kinds[cell] ?? NO_DEPOSIT)) kinds[cell] = kind;
  }
  return {
    forest: neighbourhoodDensity(trees, width, height, TREES_FOR_FULL_CANOPY),
    depositKind: kinds,
    depositDensity: neighbourhoodDensity(deposits, width, height, DEPOSITS_FOR_FULL_FIELD),
  };
}

function neighbourhoodDensity(
  counts: Float32Array,
  width: number,
  height: number,
  full: number,
): Float32Array {
  const out = staggerBlur(counts, width, height);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, (out[i] ?? 0) / full);
  return out;
}
