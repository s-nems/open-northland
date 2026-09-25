import { hexDistanceBetween } from '@open-northland/sim';

export interface PalisadeLineNode {
  readonly col: number;
  readonly row: number;
}

/**
 * Original behavior: the placement drag accepts twenty moves after its starting marker, and the wall
 * line it routes is capped at the same count.
 */
export const PALISADE_LINE_MAX_EDGES = 20;

interface Cube {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function toCube(node: PalisadeLineNode): Cube {
  const x = node.col - (node.row - (node.row & 1)) / 2;
  const z = node.row;
  return { x, y: -x - z, z };
}

function fromCube(cube: Cube): PalisadeLineNode {
  const row = cube.z;
  return { col: cube.x + (row - (row & 1)) / 2, row };
}

function roundCube(cube: Cube): Cube {
  let x = Math.round(cube.x);
  let y = Math.round(cube.y);
  let z = Math.round(cube.z);
  const dx = Math.abs(x - cube.x);
  const dy = Math.abs(y - cube.y);
  const dz = Math.abs(z - cube.z);
  if (dx > dy && dx > dz) x = -y - z;
  else if (dy > dz) y = -x - z;
  else z = -x - y;
  return { x, y, z };
}

/**
 * A deterministic shortest hex line, capped from its pressed anchor toward the release point.
 *
 * Approximation: the original runs a pathfinder over the drag, which falls back to a directed search
 * when the straight line fails, so it routes a wall around an obstacle where this truncates the line at
 * the first node the placement probe rejects.
 */
export function palisadeLine(start: PalisadeLineNode, end: PalisadeLineNode): PalisadeLineNode[] {
  const distance = hexDistanceBetween(start.col, start.row, end.col, end.row);
  const steps = Math.min(PALISADE_LINE_MAX_EDGES, distance);
  if (distance === 0) return [{ ...start }];
  const a = toCube(start);
  const b = toCube(end);
  const nodes: PalisadeLineNode[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / distance;
    nodes.push(
      fromCube(
        roundCube({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          z: a.z + (b.z - a.z) * t,
        }),
      ),
    );
  }
  return nodes;
}
