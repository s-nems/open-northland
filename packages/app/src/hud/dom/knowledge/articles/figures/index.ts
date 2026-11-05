import './figures.css';
import { diag } from '../../../../../diag/index.js';
import { element } from '../../../parts/dom.js';
import type { KnowledgeContext } from '../../context.js';
import { expCurveFigure, needBarFigure } from './bars.js';
import { directionFigure } from './directions.js';
import { fieldStagesFigure } from './field.js';
import { flagFlowFigure, homeLevelsFigure, livestockCycleFigure } from './flows.js';
import { catapultSplashFigure, leashFigure } from './ranges.js';
import { reachFigure, visionFigure } from './reach.js';

/** Draws one figure; null when the content lacks what it shows, so an article never prints a false one. */
type FigurePainter = (context: KnowledgeContext) => Element | null;

const FIGURES: ReadonlyMap<string, FigurePainter> = new Map<string, FigurePainter>([
  ['direction', directionFigure],
  ['vision', visionFigure],
  ['reach', reachFigure],
  ['need-bar', needBarFigure],
  ['exp-curve', expCurveFigure],
  ['leash', leashFigure],
  ['catapult-splash', catapultSplashFigure],
  ['flag-flow', flagFlowFigure],
  ['livestock-cycle', livestockCycleFigure],
  ['home-levels', homeLevelsFigure],
  ['field-stages', fieldStagesFigure],
]);

export function renderFigure(context: KnowledgeContext, id: string, caption: string): HTMLElement {
  const figure = element('figure', 'kn-fig');
  const paint = FIGURES.get(id);
  if (paint === undefined) {
    diag.warn('hud', `unknown knowledge figure ${id}`);
    return figure;
  }
  const drawn = paint(context);
  if (drawn === null) return figure;
  figure.append(drawn);
  if (caption !== '') {
    const line = element('figcaption', 'kn-fig__caption');
    line.textContent = caption;
    figure.append(line);
  }
  return figure;
}
