import { systems } from '@open-northland/sim';
import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../../../i18n/index.js';
import type { Point } from './geometry.js';
import { drawing, FIGURE_WIDTH, line, number, shape, text } from './svg.js';

const PERCENT = 100;

const NEED_HEIGHT = 158;
const BAR_LEFT = 18;
const BAR_RIGHT = FIGURE_WIDTH - 18;
const BAR_TOP = 62;
const BAR_HEIGHT = 34;
const TICK_OVERHANG = 7;
const NAME_ROW = 16;

interface NeedMark {
  readonly units: number;
  readonly name: string;
  readonly above: boolean;
}

export function needBarFigure(): SVGElement {
  const t = messages().knowledge.figures.needBar;
  const full = systems.NEED_RESERVE_UNITS;
  const top = full + systems.NEED_OVERFILL_UNITS;
  const x = (units: number): number => BAR_LEFT + (units / top) * (BAR_RIGHT - BAR_LEFT);
  const zone = (from: number, to: number, kind: string): SVGElement =>
    shape('rect', {
      x: x(from),
      y: BAR_TOP,
      width: x(to) - x(from),
      height: BAR_HEIGHT,
      class: `kn-fig__level kn-fig__level--${kind}`,
    });
  const marks: readonly NeedMark[] = [
    { units: systems.NEED_CRITICAL_UNITS, name: t.notice, above: false },
    { units: systems.NEED_DRIVE_UNITS, name: t.dropsWork, above: true },
    { units: systems.NEED_SATED_UNITS, name: t.sated, above: false },
    { units: full, name: t.full, above: true },
    { units: top, name: t.ceiling, above: false },
  ];
  const drawn = marks.flatMap(({ units, name, above }) => {
    const at = x(units);
    const value = formatMessage(t.percent, { value: number((units * PERCENT) / full) });
    const anchor = units === top ? 'end' : 'middle';
    const valueY = above
      ? BAR_TOP - TICK_OVERHANG - NAME_ROW - 4
      : BAR_TOP + BAR_HEIGHT + TICK_OVERHANG + NAME_ROW;
    return [
      line(
        { x: at, y: above ? BAR_TOP - TICK_OVERHANG : BAR_TOP },
        { x: at, y: above ? BAR_TOP + BAR_HEIGHT : BAR_TOP + BAR_HEIGHT + TICK_OVERHANG },
        'kn-fig__tick',
      ),
      text({ x: at, y: valueY }, value, 'kn-fig__t--strong', anchor),
      text({ x: at, y: valueY + NAME_ROW }, name, 'kn-fig__t--small', anchor),
    ];
  });
  return drawing(
    NEED_HEIGHT,
    zone(0, systems.NEED_CRITICAL_UNITS, 'danger'),
    zone(systems.NEED_CRITICAL_UNITS, systems.NEED_DRIVE_UNITS, 'warn'),
    zone(systems.NEED_DRIVE_UNITS, full, 'ok'),
    zone(full, top, 'reserve'),
    shape('rect', {
      x: BAR_LEFT,
      y: BAR_TOP,
      width: BAR_RIGHT - BAR_LEFT,
      height: BAR_HEIGHT,
      class: 'kn-fig__ring',
    }),
    ...drawn,
  );
}

const CURVE_HEIGHT = 274;
const PLOT_LEFT = 46;
const PLOT_RIGHT = FIGURE_WIDTH - 40;
const PLOT_TOP = 30;
const PLOT_BOTTOM = 230;
const AXIS_LABEL_Y = 268;
const TICK_LABEL_Y = 248;
const SIDE_GAP = 8;
const LABEL_BASELINE = 5;
const CURVE_MARK = 4;
/** The early points the curve is labelled at: the steep part a new worker climbs. */
const LABELLED_POINTS = [1, 5, 10] as const;
const X_TICK_STEP = 40;

export function expCurveFigure(): SVGElement {
  const t = messages().knowledge.figures.expCurve;
  const last = systems.EXPERIENCE_MASTERY_POINTS;
  const place = (points: number): Point => ({
    x: PLOT_LEFT + (points / last) * (PLOT_RIGHT - PLOT_LEFT),
    y: PLOT_BOTTOM - (systems.experiencePercent(points) / PERCENT) * (PLOT_BOTTOM - PLOT_TOP),
  });
  const yOf = (pct: number): number => PLOT_BOTTOM - (pct / PERCENT) * (PLOT_BOTTOM - PLOT_TOP);
  const curve = Array.from({ length: last + 1 }, (_, points) => place(points));
  const grid = [];
  const perStroke = systems.EXPERIENCE_PCT_PER_SAVED_STROKE;
  for (let pct = 0; pct <= PERCENT; pct += perStroke) {
    const y = yOf(pct);
    grid.push(
      line({ x: PLOT_LEFT, y }, { x: PLOT_RIGHT, y }, pct === 0 ? 'kn-fig__axis' : 'kn-fig__gridline'),
      text(
        { x: PLOT_LEFT - SIDE_GAP, y: y + LABEL_BASELINE },
        formatMessage(t.percent, { value: number(pct) }),
        'kn-fig__t--small',
        'end',
      ),
    );
    if (pct > 0) {
      grid.push(
        text(
          { x: PLOT_RIGHT + SIDE_GAP, y: y + LABEL_BASELINE },
          formatMessage(t.savedStrokes, { strokes: number(pct / perStroke) }),
          'kn-fig__t--small',
        ),
      );
    }
  }
  const ticks = [];
  for (let points = 0; points < last - X_TICK_STEP / 2; points += X_TICK_STEP) ticks.push(points);
  ticks.push(last);
  const xTicks = ticks.map((points) =>
    text({ x: place(points).x, y: TICK_LABEL_Y }, number(points), 'kn-fig__t--small', 'middle'),
  );
  const labelled = LABELLED_POINTS.flatMap((points) => {
    const at = place(points);
    const value = systems.experiencePercent(points);
    return [
      shape('circle', { cx: at.x, cy: at.y, r: CURVE_MARK, class: 'kn-fig__curve-mark' }),
      text(
        { x: at.x + 2 * SIDE_GAP, y: at.y + 2 * LABEL_BASELINE + 2 },
        formatMessage(pluralForm(points, t.mark, bcp47Tag()), {
          points: number(points),
          percent: number(value),
        }),
        'kn-fig__t--small',
      ),
    ];
  });
  return drawing(
    CURVE_HEIGHT,
    ...grid,
    shape('polyline', { points: curve.map((p) => `${p.x},${p.y}`).join(' '), class: 'kn-fig__curve' }),
    ...labelled,
    ...xTicks,
    text({ x: FIGURE_WIDTH, y: PLOT_TOP / 2 }, t.fewerStrokes, 'kn-fig__t--small', 'end'),
    text(
      { x: (PLOT_LEFT + PLOT_RIGHT) / 2, y: AXIS_LABEL_Y },
      messages().knowledge.mechanics.expPoints,
      'kn-fig__t--small',
      'middle',
    ),
  );
}
