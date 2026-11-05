import { HEX_HEADING_COUNT, systems } from '@open-northland/sim';
import { formatMessage, messages } from '../../../../../i18n/index.js';
import { GROUND_SQUASH, groundPoint, groundWedgePath, headingSector, type Point } from './geometry.js';
import { groundMesh } from './ground.js';
import { arrow, dot, drawing, FIGURE_WIDTH, line, number, shape, text } from './svg.js';

const PERCENT = 100;
const HEIGHT = 262;
const CENTRE: Point = { x: FIGURE_WIDTH / 2, y: HEIGHT / 2 };
/** Ring widths on screen, east to west; the ground tilt draws them shorter north to south. */
const SOLDIER_CLEARANCE = 46;
const WEDGE_RADIUS = 150;
const VALUE_RADIUS = 104;
const BLOW_FROM_RADIUS = 186;
const LABEL_RADIUS = 196;
/** Below this share of the radius sideways a label centres on its wedge. */
const SIDEWAYS_LABEL = 0.2;
const LINE_HEIGHT = 16;
const VALUE_BASELINE = 6;
/** The ground patch drawn around the ring, past its widest label. */
const GROUND_HALF_WIDTH = 270;
/** The mesh's viewBox units per screen px; headings are angles, so any zoom is true. */
const GROUND_SCALE = 0.8;
const SPEAR_REACH = 36;
/** The body curve's control height; the drawn body is half as tall. */
const SOLDIER_HEIGHT = 64;
const SOLDIER_HALF_WIDTH = 12;
const SOLDIER_HEAD = 8;
/** How far up the body the spear is held, as a share of the soldier's height. */
const SHOULDER_SHARE = 0.3;

const BIN_NAMES = ['front', 'frontSide', 'backSide', 'behind'] as const;

/** A soldier standing on the ring's centre, facing east with a spear held out. */
function soldier(): SVGElement {
  const { x, y } = CENTRE;
  const shoulders = y - SOLDIER_HEIGHT * SHOULDER_SHARE;
  return shape(
    'g',
    {},
    shape('ellipse', {
      cx: x,
      cy: y,
      rx: SOLDIER_HALF_WIDTH,
      ry: SOLDIER_HALF_WIDTH * GROUND_SQUASH,
      class: 'kn-fig__shadow',
    }),
    shape('path', {
      d: `M${x - SOLDIER_HALF_WIDTH} ${y}Q${x} ${y - SOLDIER_HEIGHT} ${x + SOLDIER_HALF_WIDTH} ${y}Z`,
      class: 'kn-fig__body',
    }),
    dot({ x, y: y - SOLDIER_HEIGHT / 2 - SOLDIER_HEAD / 2 }, SOLDIER_HEAD, 'kn-fig__head'),
    line(
      { x: x - SOLDIER_HEAD, y: shoulders },
      { x: x + SPEAR_REACH, y: shoulders - SOLDIER_HEAD },
      'kn-fig__spear',
    ),
  );
}

/** One heading's wedge, what a blow from there is worth and its name. */
function headingWedge(heading: number): SVGElement[] {
  const t = messages().knowledge.figures.direction;
  const bin = systems.hitDirectionBin(heading);
  const name = BIN_NAMES[bin];
  const pct = systems.HIT_DIRECTION_PCT[bin];
  if (name === undefined || pct === undefined) return [];
  const { from, to } = headingSector(heading);
  const middle = (from + to) / 2;
  const value = groundPoint(CENTRE, VALUE_RADIUS, middle);
  const at = groundPoint(CENTRE, LABEL_RADIUS, middle);
  const sideways = (at.x - CENTRE.x) / LABEL_RADIUS;
  const anchor = sideways > SIDEWAYS_LABEL ? 'start' : sideways < -SIDEWAYS_LABEL ? 'end' : 'middle';
  return [
    shape('path', {
      d: groundWedgePath(CENTRE, SOLDIER_CLEARANCE, WEDGE_RADIUS, from, to),
      class: `kn-fig__blow kn-fig__blow--${bin}`,
    }),
    text(
      { x: value.x, y: value.y + VALUE_BASELINE },
      formatMessage(t.times, { value: number(pct / PERCENT) }),
      'kn-fig__t--strong',
      'middle',
    ),
    arrow(
      groundPoint(CENTRE, BLOW_FROM_RADIUS, middle),
      groundPoint(CENTRE, WEDGE_RADIUS + 2, middle),
      'kn-fig__ink',
    ),
    text({ x: at.x, y: at.y + LINE_HEIGHT / 3 }, t[name], '', anchor),
  ];
}

export function directionFigure(): SVGElement {
  const wedges = Array.from({ length: HEX_HEADING_COUNT }, (_, heading) => headingWedge(heading)).flat();
  return drawing(
    HEIGHT,
    groundMesh(CENTRE, GROUND_HALF_WIDTH, HEIGHT / 2, GROUND_SCALE),
    ...wedges,
    soldier(),
  );
}
