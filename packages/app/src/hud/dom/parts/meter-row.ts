import { button, element, setAttribute, setClass, setStyleVar, setTip, write } from './dom.js';

/** A fill under a third reads amber and under a sixth red, so trouble shows without words; the percent itself
 *  carries the same colour. */
export const METER_LOW_BELOW_PCT = 34;
export const METER_CRITICAL_BELOW_PCT = 17;

export type MeterTone = 'ok' | 'low' | 'critical';

/** A meter's fill: `part` of `whole` as a CSS percentage, capped at full and safe for an empty whole. */
export function meterFill(part: number, whole: number): string {
  return `${Math.round((Math.min(part, whole) / Math.max(1, whole)) * 100)}%`;
}

export function meterTone(pct: number): MeterTone {
  if (pct < METER_CRITICAL_BELOW_PCT) return 'critical';
  if (pct < METER_LOW_BELOW_PCT) return 'low';
  return 'ok';
}

export interface MeterRowModel {
  readonly label: string;
  /** 0..100. */
  readonly pct: number;
  readonly tooltip: string;
}

/** One 18 px stat line: label, quarter-ticked meter, percent. With `onPress` the row is a button whose
 *  label carries the panel's dotted link mark. */
export interface MeterRow {
  readonly element: HTMLElement;
  update(model: MeterRowModel): void;
}

export interface MeterRowOptions {
  readonly onPress?: () => void;
  /** The cursor entered or moved over the row (an event) or left it (null). With this the row's
   *  tooltip is the owner's chip, not the browser's, which a value ticking under the cursor hides. */
  readonly onHover?: (event: MouseEvent | null) => void;
}

export function createMeterRow(options: MeterRowOptions = {}): MeterRow {
  const { onPress, onHover } = options;
  const inner =
    '<span></span><span class="on-meter" role="meter" aria-valuemin="0" aria-valuemax="100"></span><b></b>';
  const root: HTMLElement =
    onPress === undefined ? element('div', 'on-meter-row', inner) : button('on-meter-row', inner);
  if (onPress !== undefined) root.addEventListener('click', onPress);
  if (onHover !== undefined) {
    root.addEventListener('mouseenter', (event) => onHover(event));
    root.addEventListener('mousemove', (event) => onHover(event));
    root.addEventListener('mouseleave', () => onHover(null));
  }
  const [label, meter, value] = [root.children[0], root.children[1], root.children[2]];
  if (!(meter instanceof HTMLElement) || label === undefined || value === undefined) {
    throw new Error('meter row: template');
  }
  return {
    element: root,
    update(model): void {
      write(label, model.label);
      setAttribute(meter, 'aria-label', model.label);
      setAttribute(meter, 'aria-valuenow', String(model.pct));
      setStyleVar(meter, '--value', `${model.pct}%`);
      write(value, `${model.pct}%`);
      if (onHover === undefined) setTip(root, model.tooltip);
      const tone = meterTone(model.pct);
      setClass(root, 'on-meter-row--low', tone === 'low');
      setClass(root, 'on-meter-row--critical', tone === 'critical');
    },
  };
}
