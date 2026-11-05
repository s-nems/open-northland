import { bcp47Tag } from '../../../../../i18n/index.js';
import type { Point } from './geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The width every drawn figure lays out in; the viewBox scales it to the column or the pane. */
export const FIGURE_WIDTH = 560;

const ARROW_HEAD = 7;
const ARROW_HALF_WIDTH = 4;

type Attributes = Readonly<Record<string, string | number>>;

export function shape(
  tag: string,
  attributes: Attributes = {},
  ...children: readonly SVGElement[]
): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  node.append(...children);
  return node;
}

export function drawing(height: number, ...children: readonly SVGElement[]): SVGElement {
  return shape(
    'svg',
    { viewBox: `0 0 ${FIGURE_WIDTH} ${height}`, class: 'kn-fig__svg', 'aria-hidden': 'true' },
    ...children,
  );
}

export function text(
  at: Point,
  content: string,
  className = '',
  anchor: 'start' | 'middle' | 'end' = 'start',
): SVGElement {
  const node = shape('text', { x: at.x, y: at.y, 'text-anchor': anchor, class: className });
  node.textContent = content;
  return node;
}

export function line(from: Point, to: Point, className: string): SVGElement {
  return shape('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: className });
}

export function dot(at: Point, radius: number, className: string): SVGElement {
  return shape('circle', { cx: at.x, cy: at.y, r: radius, class: className });
}

export function outline(points: readonly Point[], at: Point, scale: number, className: string): SVGElement {
  const list = points.map((p) => `${at.x + p.x * scale},${at.y + p.y * scale}`).join(' ');
  return shape('polygon', { points: list, class: className });
}

/** A line with a solid head at `to`; the head takes the line's colour through `className`. */
export function arrow(from: Point, to: Point, className: string): SVGElement {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const base = { x: to.x - ux * ARROW_HEAD, y: to.y - uy * ARROW_HEAD };
  const head = [
    `${to.x},${to.y}`,
    `${base.x - uy * ARROW_HALF_WIDTH},${base.y + ux * ARROW_HALF_WIDTH}`,
    `${base.x + uy * ARROW_HALF_WIDTH},${base.y - ux * ARROW_HALF_WIDTH}`,
  ].join(' ');
  return shape(
    'g',
    { class: className },
    line(from, base, 'kn-fig__arrow-shaft'),
    shape('polygon', { points: head, class: 'kn-fig__arrow-head' }),
  );
}

export function number(value: number): string {
  return new Intl.NumberFormat(bcp47Tag()).format(value);
}
