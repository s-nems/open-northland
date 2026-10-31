import { TILE_HALF_H, TILE_HALF_W } from '@open-northland/render';

/** A point in px of the game's projection, or in a figure's viewBox units. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** One node's sideways and one node row's downward pitch on screen. */
export const NODE_PX = TILE_HALF_W;
export const NODE_ROW_PX = TILE_HALF_H / 2;

const FULL_TURN_DEG = 360;
const HALF_TURN_DEG = 180;

const toRadians = (degrees: number): number => (degrees * Math.PI) / HALF_TURN_DEG;

/** Where node `(hx, hy)` draws relative to node `(0, 0)`: odd rows sit a quarter column east. */
export function nodePoint(hx: number, hy: number): Point {
  return { x: hx * NODE_PX + (hy & 1) * (NODE_PX / 2), y: hy * NODE_ROW_PX };
}

/** The outline of everything within `radius` map points: a flat-topped hexagon as wide as the radius in
 *  nodes and half as wide along its top row. */
export function hexRing(radius: number): readonly Point[] {
  const x = radius * NODE_PX;
  const y = radius * NODE_ROW_PX;
  return [
    { x, y: 0 },
    { x: x / 2, y },
    { x: -x / 2, y },
    { x: -x, y: 0 },
    { x: -x / 2, y: -y },
    { x: x / 2, y: -y },
  ];
}

/** The outline of a Manhattan radius over half-cell nodes. */
export function diamondRing(radius: number): readonly Point[] {
  const x = radius * NODE_PX;
  const y = radius * NODE_ROW_PX;
  return [
    { x, y: 0 },
    { x: 0, y },
    { x: -x, y: 0 },
    { x: 0, y: -y },
  ];
}

/** Whether a node `hx`/`hy` away lies within a Manhattan radius. */
export function withinDiamond(hx: number, hy: number, radius: number): boolean {
  return Math.abs(hx) + Math.abs(hy) <= radius;
}

/** The node after `steps` slanted walking steps from `(0, 0)`: each crosses one row and half a column. */
export function slantNode(steps: number): { readonly hx: number; readonly hy: number } {
  return { hx: steps >> 1, hy: steps };
}

/** How many slanted walking steps stay inside a Manhattan radius. */
export function slantStepsWithin(radius: number): number {
  let steps = 0;
  for (;;) {
    const next = slantNode(steps + 1);
    if (!withinDiamond(next.hx, next.hy, radius)) return steps;
    steps += 1;
  }
}

/** How many node rows a sight of `radius` nodes spans: its ellipse is a circle on screen, and a row is
 *  shorter than a node is wide. */
export function sightRows(radius: number): number {
  return (radius * NODE_PX) / NODE_ROW_PX;
}

/** The viewBox units per unit that fit `extent` into `room`. */
export function fitScale(extent: number, room: number): number {
  return room / extent;
}

export function polar(centre: Point, radius: number, degrees: number): Point {
  const angle = toRadians(degrees);
  return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
}

/** Path data of a ring sector centred on `degrees`, clockwise from east. */
export function wedgePath(
  centre: Point,
  inner: number,
  outer: number,
  degrees: number,
  span: number,
): string {
  const from = degrees - span / 2;
  const to = degrees + span / 2;
  const a = polar(centre, outer, from);
  const b = polar(centre, outer, to);
  const c = polar(centre, inner, to);
  const d = polar(centre, inner, from);
  const sweep = span < FULL_TURN_DEG / 2 ? 0 : 1;
  return `M${a.x} ${a.y}A${outer} ${outer} 0 ${sweep} 1 ${b.x} ${b.y}L${c.x} ${c.y}A${inner} ${inner} 0 ${sweep} 0 ${d.x} ${d.y}Z`;
}
