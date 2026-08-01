import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

/** The stander spacing (node Manhattan): a node CLOSER than this to a held field counts as inside it.
 *  One node apart is half a visual cell - two sprites there still read as one animal (user feedback) -
 *  so every standing-goal pick (graze, sidestep, herd recall) holds this gap; only at 2+ do sprites
 *  separate. */
export const ANIMAL_SPACING_NODES = 2;

/** The offsets whose nodes sit CLOSER than {@link ANIMAL_SPACING_NODES} to a node: itself + the four
 *  lattice neighbours. The constant and this table are one fact - widening the spacing must widen
 *  the probes. */
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
