import { TILE_HALF_H, TILE_HALF_W } from '@open-northland/render';
import { HEX_HEADING_COUNT } from '@open-northland/sim';

/** A point in px of the game's projection, or in a figure's viewBox units. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** One node's sideways and one node row's downward pitch on screen. */
export const NODE_PX = TILE_HALF_W;
export const NODE_ROW_PX = TILE_HALF_H / 2;

/**
 * How much shorter a ground circle draws north-south than east-west: a node's six neighbours lie on one
 * ground circle, which passes through the east neighbour a node away and the diagonal ones a row down and
 * half a node aside.
 */
export const GROUND_SQUASH = NODE_ROW_PX / Math.sqrt(NODE_PX ** 2 - (NODE_PX / 2) ** 2);

const FULL_TURN_DEG = 360;
const HALF_TURN_DEG = 180;
const HEADING_SPAN_DEG = FULL_TURN_DEG / HEX_HEADING_COUNT;

const toRadians = (degrees: number): number => (degrees * Math.PI) / HALF_TURN_DEG;
const toDegrees = (radians: number): number => (radians * HALF_TURN_DEG) / Math.PI;

/** Where node `(hx, hy)` draws relative to node `(0, 0)`: odd rows sit half a node east. */
export function nodePoint(hx: number, hy: number): Point {
  return { x: hx * NODE_PX + (hy & 1) * (NODE_PX / 2), y: hy * NODE_ROW_PX };
}

/** The outline of every node within `radius` map points, as the screen shows it: a hexagon as wide as
 *  the radius in nodes, flattened to the ground's tilt. */
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

/** How many node rows a sight of `radius` nodes spans: sight is a circle on screen, and a row is
 *  shorter than a node is wide. */
export function sightRows(radius: number): number {
  return (radius * NODE_PX) / NODE_ROW_PX;
}

/** The viewBox units per unit that fit `extent` into `room`. */
export function fitScale(extent: number, room: number): number {
  return room / extent;
}

/** The point at ground bearing `degrees` (clockwise from east) on a ground circle `radius` wide on screen. */
export function groundPoint(centre: Point, radius: number, degrees: number): Point {
  const angle = toRadians(degrees);
  return {
    x: centre.x + radius * Math.cos(angle),
    y: centre.y + radius * GROUND_SQUASH * Math.sin(angle),
  };
}

/**
 * The ground bearing where heading `heading`'s sector starts and ends. A heading's sector spans
 * {@link HEADING_SPAN_DEG} on the map-point grid with a row counted as tall as a node is wide, the
 * grid the sim's heading reads; on the ground the east and west sectors come out narrower.
 */
export function headingSector(heading: number): { readonly from: number; readonly to: number } {
  const centre = heading * HEADING_SPAN_DEG;
  return {
    from: gridToGround(centre - HEADING_SPAN_DEG / 2),
    to: gridToGround(centre + HEADING_SPAN_DEG / 2),
  };
}

/** A bearing on the map-point grid as a bearing on the ground, kept in the same turn. */
function gridToGround(degrees: number): number {
  const angle = toRadians(degrees);
  const screenX = Math.cos(angle) * NODE_PX;
  const screenY = Math.sin(angle) * NODE_ROW_PX;
  const ground = toDegrees(Math.atan2(screenY / GROUND_SQUASH, screenX));
  return ground + Math.round((degrees - ground) / FULL_TURN_DEG) * FULL_TURN_DEG;
}

/** Path data of a ground ring's sector from bearing `from` to `to`, `inner` and `outer` wide on screen. */
export function groundWedgePath(
  centre: Point,
  inner: number,
  outer: number,
  from: number,
  to: number,
): string {
  const a = groundPoint(centre, outer, from);
  const b = groundPoint(centre, outer, to);
  const c = groundPoint(centre, inner, to);
  const d = groundPoint(centre, inner, from);
  const large = to - from > HALF_TURN_DEG ? 1 : 0;
  const outerRy = outer * GROUND_SQUASH;
  const innerRy = inner * GROUND_SQUASH;
  return `M${a.x} ${a.y}A${outer} ${outerRy} 0 ${large} 1 ${b.x} ${b.y}L${c.x} ${c.y}A${inner} ${innerRy} 0 ${large} 0 ${d.x} ${d.y}Z`;
}
