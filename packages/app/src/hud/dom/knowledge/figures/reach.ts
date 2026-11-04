import {
  CARRIER_WALK_RANGE_NODES,
  SIGNPOST_LINK_RANGE_NODES,
  systems,
  WALK_RANGE_NODES,
} from '@open-northland/sim';
import { formatMessage, messages } from '../../../../i18n/index.js';
import { fitScale, hexRing, NODE_PX, NODE_ROW_PX, nodePoint, type Point, sightRows } from './geometry.js';
import { groundMesh } from './ground.js';
import { arrow, dot, drawing, FIGURE_WIDTH, line, number, outline, shape, text } from './svg.js';

const LABEL_GAP = 6;

/** A unit kind's sight radius with the name it is listed under. */
interface SightRow {
  readonly radius: number;
  readonly name: string;
}

function sightRowsByRadius(): readonly SightRow[] {
  const t = messages().knowledge.figures.vision;
  const kinds: readonly (readonly [number, string])[] = [
    [systems.SCOUT_VISION_NODES, t.scout],
    [systems.HERO_VISION_NODES, t.hero],
    [systems.SOLDIER_VISION_NODES, t.soldier],
    [systems.CART_VISION_NODES, t.cart],
    [systems.CIVILIAN_VISION_NODES, t.adult],
    [systems.CHILD_VISION_NODES, t.child],
  ];
  const names = new Map<number, string[]>();
  for (const [radius, name] of kinds) names.set(radius, [...(names.get(radius) ?? []), name]);
  return [...names].sort(([a], [b]) => b - a).map(([radius, list]) => ({ radius, name: list.join(', ') }));
}

const VISION_HEIGHT = 320;
const VISION_CENTRE: Point = { x: 166, y: 160 };
/** The widest sight's radius on the figure. */
const VISION_ROOM = 150;
const VISION_GROUND_MARGIN = 14;
const VISION_ROWS_TOP = 54;
const VISION_ROW_STEP = 31;
const VISION_NAME_X = 334;
const VISION_ACROSS_X = 486;
const VISION_ALONG_X = 552;
const VISION_HEAD_Y = 26;
const UNIT_DOT = 4;

/** Sight is a circle on screen: its radius in nodes, a node as wide as {@link NODE_PX}. */
export function visionFigure(): SVGElement {
  const t = messages().knowledge.figures.vision;
  const rows = sightRowsByRadius();
  const widest = Math.max(...rows.map((row) => row.radius));
  const scale = fitScale(widest * NODE_PX, VISION_ROOM);
  const { x: cx, y: cy } = VISION_CENTRE;
  const ground = VISION_ROOM + VISION_GROUND_MARGIN;
  const rings = rows.map(({ radius }) =>
    shape('circle', { cx, cy, r: radius * NODE_PX * scale, class: 'kn-fig__zone' }),
  );
  const listed = rows.flatMap(({ radius, name }, i) => {
    const y = VISION_ROWS_TOP + i * VISION_ROW_STEP;
    const r = radius * NODE_PX * scale;
    const x = cx + Math.sqrt(Math.max(0, r ** 2 - (y - cy) ** 2));
    const baseline = y + LABEL_GAP - 1;
    return [
      line({ x, y }, { x: VISION_NAME_X - LABEL_GAP, y }, 'kn-fig__guide'),
      dot({ x, y }, 2, 'kn-fig__mark'),
      text({ x: VISION_NAME_X, y: baseline }, name),
      text({ x: VISION_ACROSS_X, y: baseline }, number(radius), 'kn-fig__t--strong', 'end'),
      text({ x: VISION_ALONG_X, y: baseline }, number(Math.round(sightRows(radius))), '', 'end'),
    ];
  });
  return drawing(
    VISION_HEIGHT,
    groundMesh(VISION_CENTRE, ground, ground, scale),
    ...rings,
    dot(VISION_CENTRE, UNIT_DOT, 'kn-fig__mark'),
    text({ x: VISION_ACROSS_X, y: VISION_HEAD_Y }, t.across, 'kn-fig__t--small', 'end'),
    text({ x: VISION_ALONG_X, y: VISION_HEAD_Y }, t.along, 'kn-fig__t--small', 'end'),
    ...listed,
  );
}

const REACH_HEIGHT = 300;
const REACH_CENTRE: Point = { x: FIGURE_WIDTH / 2, y: 160 };
const REACH_ROOM = 548;
const LINK_LABEL_RISE = 26;
/** Where the two example settlers stand, in nodes from the first signpost's mirror point. */
const SETTLER_INSIDE = { hx: -46, hy: 20 };
const SETTLER_LOST = { hx: 76, hy: -50 };

function person(at: Point, className: string): SVGElement {
  return shape(
    'g',
    { class: className },
    dot({ x: at.x, y: at.y - 8 }, 4, 'kn-fig__head'),
    shape('path', {
      d: `M${at.x - 6} ${at.y + 7}Q${at.x} ${at.y - 12} ${at.x + 6} ${at.y + 7}Z`,
      class: 'kn-fig__body',
    }),
  );
}

function signpost(at: Point): SVGElement {
  return shape(
    'g',
    {},
    line({ x: at.x, y: at.y + 8 }, { x: at.x, y: at.y - 13 }, 'kn-fig__post'),
    shape('path', { d: `M${at.x} ${at.y - 13}h12l4 3-4 3h-12z`, class: 'kn-fig__sign' }),
  );
}

export function reachFigure(): SVGElement {
  const t = messages().knowledge.figures.reach;
  const half = SIGNPOST_LINK_RANGE_NODES / 2;
  const scale = fitScale(2 * (half + CARRIER_WALK_RANGE_NODES) * NODE_PX, REACH_ROOM);
  const { x: cx, y: cy } = REACH_CENTRE;
  const node = (hx: number, hy: number): Point => {
    const p = nodePoint(hx, hy);
    return { x: cx + p.x * scale, y: cy + p.y * scale };
  };
  const west = node(-half, 0);
  const east = node(half, 0);
  const walkTop = cy - WALK_RANGE_NODES * NODE_ROW_PX * scale;
  const carrierTop = cy - CARRIER_WALK_RANGE_NODES * NODE_ROW_PX * scale;
  const inside = node(SETTLER_INSIDE.hx, SETTLER_INSIDE.hy);
  const lost = node(SETTLER_LOST.hx, SETTLER_LOST.hy);
  return drawing(
    REACH_HEIGHT,
    groundMesh(REACH_CENTRE, FIGURE_WIDTH / 2, REACH_HEIGHT - cy, scale),
    shape(
      'g',
      { class: 'kn-fig__union' },
      outline(hexRing(WALK_RANGE_NODES), west, scale, ''),
      outline(hexRing(WALK_RANGE_NODES), east, scale, ''),
    ),
    outline(hexRing(WALK_RANGE_NODES), west, scale, 'kn-fig__ring'),
    outline(hexRing(WALK_RANGE_NODES), east, scale, 'kn-fig__ring'),
    outline(hexRing(CARRIER_WALK_RANGE_NODES), west, scale, 'kn-fig__ring kn-fig__ring--dash'),
    outline(hexRing(CARRIER_WALK_RANGE_NODES), east, scale, 'kn-fig__ring kn-fig__ring--dash'),
    arrow(west, east, 'kn-fig__ink'),
    arrow(east, west, 'kn-fig__ink'),
    signpost(west),
    signpost(east),
    text(
      { x: cx, y: cy - LINK_LABEL_RISE },
      formatMessage(t.link, { nodes: number(SIGNPOST_LINK_RANGE_NODES) }),
      'kn-fig__t--strong kn-fig__t--halo',
      'middle',
    ),
    text({ x: west.x, y: cy + 3 * LABEL_GAP + 3 }, t.signpost, 'kn-fig__t--small', 'middle'),
    text({ x: east.x, y: cy + 3 * LABEL_GAP + 3 }, t.signpost, 'kn-fig__t--small', 'middle'),
    text(
      { x: west.x - (WALK_RANGE_NODES / 2) * NODE_PX * scale + LABEL_GAP, y: walkTop + 3 * LABEL_GAP },
      formatMessage(t.settler, { nodes: number(WALK_RANGE_NODES) }),
    ),
    text(
      { x: west.x, y: carrierTop - LABEL_GAP },
      formatMessage(t.carrier, { nodes: number(CARRIER_WALK_RANGE_NODES) }),
      '',
      'middle',
    ),
    person(inside, 'kn-fig__person--ok'),
    text({ x: inside.x + 2 * LABEL_GAP, y: inside.y + LABEL_GAP }, t.inside, 'kn-fig__t--small'),
    person(lost, 'kn-fig__person--lost'),
    text({ x: lost.x + 3 * LABEL_GAP, y: lost.y - 3 * LABEL_GAP }, t.lost, 'kn-fig__t--danger', 'end'),
  );
}
