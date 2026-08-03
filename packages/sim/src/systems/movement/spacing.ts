import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

/** The stander spacing in node Manhattan distance: a node closer than this to a held field counts as
 *  inside it. One node apart is half a visual cell, where two sprites still read as one animal, so every
 *  standing-goal pick holds this gap. */
export const ANIMAL_SPACING_NODES = 2;

/** The offsets whose nodes sit closer than {@link ANIMAL_SPACING_NODES} to a node: itself plus the four
 *  lattice neighbours. Widening the spacing must widen this table. */
export const SPACING_PROBES: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Whether any node closer than the spacing to `node` (per {@link SPACING_PROBES}) is in `held`. */
export function nearHeld(terrain: TerrainGraph, node: NodeId, held: ReadonlySet<NodeId>): boolean {
  const at = terrain.coordsOf(node);
  for (const [dx, dy] of SPACING_PROBES) {
    if (!terrain.inBounds(at.x + dx, at.y + dy)) continue;
    if (held.has(terrain.nodeAt(at.x + dx, at.y + dy))) return true;
  }
  return false;
}
