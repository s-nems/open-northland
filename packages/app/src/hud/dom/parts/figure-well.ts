import { type FigureSlot, NO_FIGURE_SLOTS } from '../../figures/live-figures.js';
import { button, element, setClass } from './dom.js';

/** Painted while its settler's figure is drawn: the glyph under the canvas hides (foundation.css). */
const LIVE_CLASS = 'on-seat-well--live';

/** How a well draws its person: map px per design px, and the feet's height over the well's floor
 *  (design px). */
export interface WellFigureFit {
  readonly zoom: number;
  readonly feetInset: number;
}

/** A seat or family well (foundation.css `.on-seat-well`, 28 x 36 design px). */
export const PERSON_WELL_FIT: WellFigureFit = { zoom: 0.6, feetInset: 4 };

/** A seat well that shows its person live: a canvas over the glyph that stands in until the figure is
 *  painted (no sprite sheet, or a rider the map does not draw). */
export interface FigureWell {
  readonly node: HTMLButtonElement;
  readonly glyph: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly fit: WellFigureFit;
  /** The settler shown, or null for a free seat; set through {@link showInWell}. */
  entity: number | null;
}

export function createFigureWell(className: string, fit: WellFigureFit = PERSON_WELL_FIT): FigureWell {
  const node = button(className);
  const glyph = element('span', 'on-seat-well__glyph');
  const canvas = document.createElement('canvas');
  canvas.className = 'on-seat-well__figure';
  canvas.setAttribute('aria-hidden', 'true');
  node.append(glyph, canvas);
  return { node, glyph, canvas, fit, entity: null };
}

/** Put `entity` in the well; another one leaves the canvas clear until the painter draws it, so a
 *  free seat never keeps the last person's frame. */
export function showInWell(well: FigureWell, entity: number | null): void {
  if (well.entity === entity) return;
  well.entity = entity;
  well.canvas.width = 0;
  setClass(well.node, LIVE_CLASS, false);
}

/**
 * The wells showing a person, as figure slots. The wells share the plane's scale, so one rect read a
 * frame serves them; the list is rebuilt only when a person, a well's size or the scale changed.
 */
export class FigureWellSlots {
  private slots: readonly FigureSlot[] = NO_FIGURE_SLOTS;

  of(wells: readonly FigureWell[]): readonly FigureSlot[] {
    let pixelScale = 0;
    let at = 0;
    let same = true;
    for (const well of wells) {
      if (well.entity === null) continue;
      const { canvas } = well;
      if (pixelScale === 0) {
        if (canvas.offsetWidth === 0) break;
        pixelScale = (canvas.getBoundingClientRect().width / canvas.offsetWidth) * devicePixelRatio;
      }
      const slot = this.slots[at++];
      same &&=
        slot?.entity === well.entity &&
        slot.canvas === canvas &&
        slot.box.width === canvas.clientWidth &&
        slot.box.height === canvas.clientHeight &&
        slot.box.pixelScale === pixelScale;
    }
    if (pixelScale === 0) {
      this.slots = NO_FIGURE_SLOTS;
      return this.slots;
    }
    if (same && at === this.slots.length) return this.slots;
    this.slots = wells.flatMap((well): FigureSlot[] =>
      well.entity === null
        ? []
        : [
            {
              entity: well.entity,
              canvas: well.canvas,
              box: { width: well.canvas.clientWidth, height: well.canvas.clientHeight, pixelScale },
              zoom: well.fit.zoom,
              feetInset: well.fit.feetInset,
            },
          ],
    );
    return this.slots;
  }
}

/** Hide the glyph of every well whose settler `drawn` holds. */
export function markDrawnWells(wells: readonly FigureWell[], drawn: ReadonlySet<number>): void {
  for (const well of wells) setClass(well.node, LIVE_CLASS, well.entity !== null && drawn.has(well.entity));
}
