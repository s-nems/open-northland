import { HEX_HEADING_COUNT, systems } from '@open-northland/sim';
import { formatMessage, messages } from '../../../../i18n/index.js';
import { type Point, polar, wedgePath } from './geometry.js';
import { arrow, dot, drawing, FIGURE_WIDTH, line, number, shape, text } from './svg.js';

const PERCENT = 100;
const HEIGHT = 300;
const CENTRE: Point = { x: FIGURE_WIDTH / 2, y: HEIGHT / 2 };
const SOLDIER_CLEARANCE = 40;
const WEDGE_RADIUS = 104;
const VALUE_RADIUS = 74;
const BLOW_FROM_RADIUS = 126;
const LABEL_RADIUS = 134;
/** Below this share of the radius sideways a label centres on its wedge. */
const SIDEWAYS_LABEL = 0.2;
const LINE_HEIGHT = 16;
const VALUE_BASELINE = 6;
const SPEAR_REACH = 36;

const BIN_NAMES = ['front', 'frontSide', 'backSide', 'behind'] as const;

/** A soldier from above, facing east: shoulders, head and a spear held out. */
function soldierFromAbove(): SVGElement {
  const { x, y } = CENTRE;
  return shape(
    'g',
    {},
    line({ x: x + 3, y: y + 13 }, { x: x + SPEAR_REACH, y: y + 13 }, 'kn-fig__spear'),
    shape('ellipse', { cx: x, cy: y, rx: 9, ry: 19, class: 'kn-fig__body' }),
    dot({ x: x + 1, y }, 8, 'kn-fig__head'),
  );
}

/** One heading's wedge, what a blow from there is worth and its name. */
function headingWedge(heading: number): SVGElement[] {
  const t = messages().knowledge.figures.direction;
  const span = 360 / HEX_HEADING_COUNT;
  const degrees = heading * span;
  const bin = Math.min(heading, HEX_HEADING_COUNT - heading);
  const name = BIN_NAMES[bin];
  const pct = systems.HIT_DIRECTION_PCT[bin];
  if (name === undefined || pct === undefined) return [];
  const value = polar(CENTRE, VALUE_RADIUS, degrees);
  const at = polar(CENTRE, LABEL_RADIUS, degrees);
  const sideways = (at.x - CENTRE.x) / LABEL_RADIUS;
  const anchor = sideways > SIDEWAYS_LABEL ? 'start' : sideways < -SIDEWAYS_LABEL ? 'end' : 'middle';
  return [
    shape('path', {
      d: wedgePath(CENTRE, SOLDIER_CLEARANCE, WEDGE_RADIUS, degrees, span),
      class: `kn-fig__blow kn-fig__blow--${bin}`,
    }),
    text(
      { x: value.x, y: value.y + VALUE_BASELINE },
      formatMessage(t.times, { value: number(pct / PERCENT) }),
      'kn-fig__t--strong',
      'middle',
    ),
    arrow(polar(CENTRE, BLOW_FROM_RADIUS, degrees), polar(CENTRE, WEDGE_RADIUS + 2, degrees), 'kn-fig__ink'),
    text({ x: at.x, y: at.y + LINE_HEIGHT / 3 }, t[name], '', anchor),
  ];
}

export function directionFigure(): SVGElement {
  const wedges = Array.from({ length: HEX_HEADING_COUNT }, (_, heading) => headingWedge(heading)).flat();
  return drawing(HEIGHT, ...wedges, soldierFromAbove());
}
