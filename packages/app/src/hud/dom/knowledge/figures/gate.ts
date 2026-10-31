import { systems } from '@open-northland/sim';
import { formatMessage, messages } from '../../../../i18n/index.js';
import type { Point } from './geometry.js';
import { arrow, drawing, FIGURE_WIDTH, line, number, shape, text } from './svg.js';

const HEIGHT = 262;
const SEGMENT = 30;
const WALL_THICKNESS = 12;
const BUILD_Y = 38;
const BUILD_LEFT_X = 138;
const BUILD_RIGHT_X = 422;
const MODE_WALL_Y = 174;
const MODE_TITLE_Y = 116;
const MODE_NOTE_Y = 248;
const WALKER_REACH = 40;
const WALKER_GAP = 22;
const NAME_GAP = 8;
const BAR_INSET = 3;
const MODES = 3;
const MODE_WIDTH = FIGURE_WIDTH / MODES;

/** The two outer walls stay; the centre and its two neighbours become the passage. */
const outerOffset = Math.max(...systems.GATE_SPAN_OFFSETS);

function wallSegment(x: number, y: number, className: string): SVGElement {
  return shape('rect', {
    x: x + 1,
    y: y - WALL_THICKNESS / 2,
    width: SEGMENT - 2,
    height: WALL_THICKNESS,
    class: className,
  });
}

/** The wall run around `centreX`: outer walls, posts at the passage and, shut, a bar across it. */
function gateRun(centreX: number, y: number, shut: boolean): SVGElement[] {
  const segments = systems.GATE_SPAN_OFFSETS.filter((offset) => Math.abs(offset) === outerOffset).map(
    (offset) => wallSegment(centreX + offset * SEGMENT - SEGMENT / 2, y, 'kn-fig__wall'),
  );
  const halfPassage = (outerOffset - 1 / 2) * SEGMENT;
  const posts = [-1, 1].map((side) =>
    shape('rect', {
      x: centreX + side * halfPassage - WALL_THICKNESS / 2,
      y: y - WALL_THICKNESS,
      width: WALL_THICKNESS,
      height: 2 * WALL_THICKNESS,
      class: 'kn-fig__gate-post',
    }),
  );
  const bar = shut
    ? [
        shape('rect', {
          x: centreX - halfPassage + BAR_INSET,
          y: y - WALL_THICKNESS / 2,
          width: 2 * halfPassage - 2 * BAR_INSET,
          height: WALL_THICKNESS,
          class: 'kn-fig__gate-bar',
        }),
      ]
    : [];
  return [...segments, ...bar, ...posts];
}

function buildRow(): SVGElement[] {
  const t = messages().knowledge.figures.gate;
  const run = systems.GATE_SPAN_OFFSETS.flatMap((offset, i) => {
    const x = BUILD_LEFT_X + offset * SEGMENT - SEGMENT / 2;
    return [
      wallSegment(x, BUILD_Y, 'kn-fig__wall'),
      text({ x: x + SEGMENT / 2, y: BUILD_Y + 3 * NAME_GAP }, number(i + 1), 'kn-fig__t--small', 'middle'),
    ];
  });
  return [
    ...run,
    text(
      { x: BUILD_LEFT_X, y: BUILD_Y + 6 * NAME_GAP },
      formatMessage(t.segments, { count: number(systems.GATE_SPAN_OFFSETS.length) }),
      '',
      'middle',
    ),
    arrow(
      { x: BUILD_LEFT_X + 2.8 * SEGMENT, y: BUILD_Y },
      { x: BUILD_RIGHT_X - 2.8 * SEGMENT, y: BUILD_Y },
      'kn-fig__ink',
    ),
    ...gateRun(BUILD_RIGHT_X, BUILD_Y, false),
    text({ x: BUILD_RIGHT_X, y: BUILD_Y + 3 * NAME_GAP }, t.passage, 'kn-fig__t--small', 'middle'),
    text({ x: BUILD_RIGHT_X, y: BUILD_Y + 6 * NAME_GAP }, t.outerStay, '', 'middle'),
  ];
}

/** Walker `name` comes from `side`; let through, the arrow crosses the wall, else it stops short. */
function walker(centre: Point, side: -1 | 1, passes: boolean, name: string, className: string): SVGElement[] {
  const x = centre.x + side * WALKER_GAP;
  const fromY = centre.y + (side < 0 ? WALKER_REACH : -WALKER_REACH);
  const toY = passes
    ? centre.y + (side < 0 ? -WALKER_REACH : WALKER_REACH)
    : centre.y + (side < 0 ? WALL_THICKNESS : -WALL_THICKNESS);
  return [
    arrow({ x, y: fromY }, { x, y: toY }, className),
    text(
      { x: centre.x + side * (WALKER_GAP + NAME_GAP), y: fromY + side * NAME_GAP },
      name,
      'kn-fig__t--small',
      side < 0 ? 'end' : 'start',
    ),
  ];
}

function modePanel(
  index: number,
  name: string,
  shut: boolean,
  enemyPasses: boolean,
  note: string,
): SVGElement[] {
  const t = messages().knowledge.figures.gate;
  const centre = { x: MODE_WIDTH * (index + 1 / 2), y: MODE_WALL_Y };
  return [
    text({ x: centre.x, y: MODE_TITLE_Y }, name, 'kn-fig__t--strong', 'middle'),
    ...gateRun(centre.x, centre.y, shut),
    ...walker(centre, -1, !shut, t.own, 'kn-fig__ink kn-fig__ink--own'),
    ...walker(centre, 1, enemyPasses, t.enemy, 'kn-fig__ink kn-fig__ink--enemy'),
    text({ x: centre.x, y: MODE_NOTE_Y }, note, 'kn-fig__t--small', 'middle'),
  ];
}

export function gateFigure(): SVGElement {
  const t = messages().knowledge.figures.gate;
  return drawing(
    HEIGHT,
    ...buildRow(),
    line(
      { x: 0, y: MODE_TITLE_Y - 2 * NAME_GAP },
      { x: FIGURE_WIDTH, y: MODE_TITLE_Y - 2 * NAME_GAP },
      'kn-fig__gridline',
    ),
    ...modePanel(0, t.open, false, true, t.openNote),
    ...modePanel(1, t.closed, true, false, t.closedNote),
    ...modePanel(
      2,
      t.automatic,
      false,
      false,
      formatMessage(t.automaticNote, { nodes: number(systems.GATE_ENEMY_NEAR_POINTS) }),
    ),
  );
}
