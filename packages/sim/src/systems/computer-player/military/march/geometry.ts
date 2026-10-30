import type { HalfCellNode } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';

// Node conversions for a marching wave.

export function clampNode(terrain: TerrainGraph, at: HalfCellNode): HalfCellNode {
  return nodeOf(terrain, terrain.nodeAtClamped(at.hx, at.hy));
}

export function nodeOf(terrain: TerrainGraph, node: NodeId): HalfCellNode {
  const { x, y } = terrain.coordsOf(node);
  return { hx: x, hy: y };
}

export function continentOf(terrain: TerrainGraph, at: HalfCellNode): number {
  return terrain.componentOf(terrain.nodeAtClamped(at.hx, at.hy));
}
