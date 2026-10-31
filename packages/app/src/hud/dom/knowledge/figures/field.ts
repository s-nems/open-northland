import { hexNeighboursOf } from '@open-northland/sim';
import { formatMessage, messages } from '../../../../i18n/index.js';
import type { KnowledgeContext } from '../context.js';
import { dot, drawing, FIGURE_WIDTH, line, number, shape, text } from './svg.js';

const HEIGHT = 196;
const SIDE = 8;
const GROUND_Y = 112;
const PLOT_HALF_WIDTH = 34;
const PLOT_HALF_HEIGHT = 11;
const STEMS = [-20, -10, 0, 10, 20] as const;
const TALLEST_STEM = 58;
const EAR_RY = 6;
const NAME_Y = 144;
const DROP_Y = 30;
const DROP_LABEL_Y = 18;
const NOTE_Y = 182;
const FIELD_GOOD_ID = 'wheat';

/** One plot at growth `stage` of `stages`: a seed row at the first, taller stems after, ears when ripe. */
function plot(x: number, stage: number, stages: number): SVGElement {
  const ground = shape('ellipse', {
    cx: x,
    cy: GROUND_Y,
    rx: PLOT_HALF_WIDTH,
    ry: PLOT_HALF_HEIGHT,
    class: 'kn-fig__soil',
  });
  const grown = (stage - 1) / (stages - 1);
  const ripe = stage === stages;
  const stems = STEMS.flatMap((dx) => {
    if (grown === 0) return [dot({ x: x + dx, y: GROUND_Y }, 2, 'kn-fig__seed')];
    const top = GROUND_Y - TALLEST_STEM * grown;
    const stem = line(
      { x: x + dx, y: GROUND_Y },
      { x: x + dx, y: top },
      ripe ? 'kn-fig__stem--ripe' : 'kn-fig__stem',
    );
    return ripe
      ? [stem, shape('ellipse', { cx: x + dx, cy: top, rx: 3, ry: EAR_RY, class: 'kn-fig__ear' })]
      : [stem];
  });
  return shape('g', {}, ground, ...stems);
}

function waterDrop(x: number, y: number): SVGElement {
  return shape('path', {
    d: `M${x} ${y - 9}C${x + 8} ${y + 2} ${x + 6} ${y + 8} ${x} ${y + 8}C${x - 6} ${y + 8} ${x - 8} ${y + 2} ${x} ${y - 9}Z`,
    class: 'kn-fig__drop',
  });
}

/** Null where the content carries no field stages. */
export function fieldStagesFigure(context: KnowledgeContext): SVGElement | null {
  const stages = context.base.goodById.get(FIELD_GOOD_ID)?.farming?.stages;
  if (stages === undefined || stages < 2) return null;
  const t = messages().knowledge.figures.fieldStages;
  const step = (FIGURE_WIDTH - 2 * SIDE) / stages;
  const xOf = (stage: number): number => SIDE + step * (stage - 1 / 2);
  const parts: SVGElement[] = [];
  for (let stage = 1; stage <= stages; stage++) {
    const name =
      stage === 1 ? t.sown : stage === stages ? t.ripe : formatMessage(t.stage, { stage: number(stage) });
    parts.push(
      plot(xOf(stage), stage, stages),
      text({ x: xOf(stage), y: NAME_Y }, name, stage === stages ? 'kn-fig__t--strong' : '', 'middle'),
    );
    if (stage > 1) {
      parts.push(
        waterDrop(xOf(stage) - step / 2, DROP_Y),
        text({ x: xOf(stage) - step / 2, y: DROP_LABEL_Y + DROP_Y }, t.water, 'kn-fig__t--small', 'middle'),
      );
    }
  }
  return drawing(
    HEIGHT,
    ...parts,
    text(
      { x: FIGURE_WIDTH / 2, y: NOTE_Y },
      formatMessage(t.note, { neighbours: number(hexNeighboursOf(0, 0).length) }),
      'kn-fig__t--small',
      'middle',
    ),
  );
}
