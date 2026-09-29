import type { HalfCellNode } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';

// Node arithmetic for a marching wave's places: integer-only, so every seat computes them alike.

/** The file of the `i`-th place in a rank: 0, then 1, -1, 2, -2 outward. */
export function fileOffset(i: number): number {
  const out = Math.floor((i + 1) / 2);
  return i % 2 === 1 ? out : -out;
}

export interface Heading {
  readonly dx: number;
  readonly dy: number;
  readonly length: number;
}

/** The leg's direction; a leg that goes nowhere faces east. */
export function headingOf(from: HalfCellNode, to: HalfCellNode): Heading {
  const dx = to.hx - from.hx;
  const dy = to.hy - from.hy;
  const length = Math.abs(dx) + Math.abs(dy);
  return length === 0 ? { dx: 1, dy: 0, length: 1 } : { dx, dy, length };
}

/** `at` moved `back` nodes against the heading and `side` nodes across it, each step rounded to a node. */
export function offset(
  at: HalfCellNode,
  { dx, dy, length }: Heading,
  back: number,
  side: number,
): HalfCellNode {
  return {
    hx: at.hx - divRound(dx * back, length) - divRound(dy * side, length),
    hy: at.hy - divRound(dy * back, length) + divRound(dx * side, length),
  };
}

/** How many {@link offset} steps behind `end` the node `at` stands, rounded up; 0 for one at or ahead. */
export function backOf(end: HalfCellNode, { dx, dy, length }: Heading, at: HalfCellNode): number {
  const behind = (end.hx - at.hx) * dx + (end.hy - at.hy) * dy;
  return behind <= 0 ? 0 : Math.ceil((behind * length) / (dx * dx + dy * dy));
}

/** `a / b` rounded half away from zero, over integers, for `b > 0`. */
function divRound(a: number, b: number): number {
  return Math.sign(a) * Math.floor((2 * Math.abs(a) + b) / (2 * b));
}

export function clampNode(terrain: TerrainGraph, at: HalfCellNode): HalfCellNode {
  return nodeOf(terrain, terrain.nodeAtClamped(at.hx, at.hy));
}

export function nodeOf(terrain: TerrainGraph, node: NodeId): HalfCellNode {
  const { x, y } = terrain.coordsOf(node);
  return { hx: x, hy: y };
}

export function manhattanOf(a: HalfCellNode, b: HalfCellNode): number {
  return Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy);
}
