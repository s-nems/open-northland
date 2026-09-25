import { GLYPH } from '../icons.js';
import { button, element, setAttribute, setDisabled, setTitle, write } from './dom.js';

/** A counter's finite top and the sentinel above it that means "never stop" (shown as ∞). */
export interface CounterRange {
  readonly max: number;
  readonly unlimited: number;
}

/**
 * One press of a counter arrow. Original behavior (the human window's production counter): − at 0 wraps
 * to unlimited, + past the finite top reaches unlimited, Shift jumps to that arrow's end. + at unlimited
 * stays there, where the original wraps to 0: one more press must not stop a product.
 */
export function counterStep(range: CounterRange, current: number, delta: 1 | -1, jump: boolean): number {
  if (jump) return delta > 0 ? range.unlimited : 0;
  if (delta < 0) {
    if (current <= 0) return range.unlimited;
    return current >= range.unlimited ? range.max : current - 1;
  }
  return current >= range.max ? range.unlimited : current + 1;
}

export function counterText(range: CounterRange, value: number): string {
  return value >= range.unlimited ? '∞' : String(value);
}

export interface CounterModel {
  readonly value: number;
  readonly lessLabel: string;
  readonly moreLabel: string;
  readonly lessTooltip: string;
  readonly moreTooltip: string;
}

/** A −/n/+ counter; `onChange` receives the value the press asks for. */
export interface Counter {
  readonly element: HTMLElement;
  update(model: CounterModel): void;
}

export function createCounter(range: CounterRange, onChange: (next: number) => void): Counter {
  const root = element('span', 'on-counter');
  const less = button('on-counter__step', GLYPH.minus);
  const value = element('b', 'on-counter__value');
  value.setAttribute('aria-live', 'polite');
  const more = button('on-counter__step', GLYPH.plus);
  root.append(less, value, more);
  let current = 0;
  const press = (delta: 1 | -1, event: MouseEvent): void => {
    const next = counterStep(range, current, delta, event.shiftKey);
    if (next !== current) onChange(next);
  };
  less.addEventListener('click', (event) => press(-1, event));
  more.addEventListener('click', (event) => press(1, event));
  return {
    element: root,
    update(model): void {
      current = model.value;
      write(value, counterText(range, model.value));
      setAttribute(less, 'aria-label', model.lessLabel);
      setAttribute(more, 'aria-label', model.moreLabel);
      setTitle(less, model.lessTooltip);
      setTitle(more, model.moreTooltip);
      setDisabled(more, model.value >= range.unlimited);
    },
  };
}
