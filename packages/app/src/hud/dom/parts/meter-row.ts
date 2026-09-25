import { button, element, setAttribute, setClass, setTitle, write } from './dom.js';

/** A fill under a third reads amber and under a sixth red (FOUNDATION.md), so trouble shows without
 *  words; the percent itself carries the same colour. */
export const METER_LOW_BELOW_PCT = 34;
export const METER_CRITICAL_BELOW_PCT = 17;

export type MeterTone = 'ok' | 'low' | 'critical';

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

export function createMeterRow(onPress?: () => void): MeterRow {
  const inner =
    '<span></span><span class="on-meter" role="meter" aria-valuemin="0" aria-valuemax="100"></span><b></b>';
  const root = onPress === undefined ? element('div', 'on-meter-row', inner) : button('on-meter-row', inner);
  if (onPress !== undefined) root.addEventListener('click', onPress);
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
      const width = `${model.pct}%`;
      if (meter.style.getPropertyValue('--value') !== width) meter.style.setProperty('--value', width);
      write(value, `${model.pct}%`);
      setTitle(root, model.tooltip);
      const tone = meterTone(model.pct);
      setClass(root, 'on-meter-row--low', tone === 'low');
      setClass(root, 'on-meter-row--critical', tone === 'critical');
    },
  };
}
