import { GLYPH } from '../icons.js';
import { button, element, isDisabled, onPress, setAttribute, setDisabled, setTip, write } from './dom.js';

/** A counter's finite range and, optionally, the sentinel above it that means "never stop" (shown
 *  as ∞). Without the sentinel the arrows stop at the range's ends. */
export interface CounterRange {
  /** The lowest finite value; 0 when absent. */
  readonly min?: number;
  readonly max: number;
  readonly unlimited?: number;
}

/** The keys held with an arrow press: Shift jumps to that arrow's end, Ctrl steps by tens. */
export interface CounterModifiers {
  readonly jump: boolean;
  readonly tens: boolean;
}

/** What a Ctrl press moves the counter by. */
export const COUNTER_TENS_STEP = 10;

/**
 * One press of a counter arrow. Original behavior (the human window's production counter): − at the
 * bottom wraps to unlimited, + past the finite top reaches unlimited and + at unlimited wraps to the
 * bottom, Shift jumps to that arrow's end. Ctrl moves by tens inside the finite range, wrapping at its
 * ends as a single step does. A range without the unlimited sentinel clamps at both ends instead.
 */
export function counterStep(
  range: CounterRange,
  current: number,
  delta: 1 | -1,
  modifiers: CounterModifiers,
): number {
  const min = range.min ?? 0;
  const { max, unlimited } = range;
  const step = modifiers.tens ? COUNTER_TENS_STEP : 1;
  if (unlimited === undefined) {
    if (modifiers.jump) return delta > 0 ? max : min;
    return Math.min(max, Math.max(min, current + delta * step));
  }
  if (modifiers.jump) return delta > 0 ? unlimited : min;
  if (delta < 0) {
    if (current <= min) return unlimited;
    return current >= unlimited ? max : Math.max(min, current - step);
  }
  if (current >= unlimited) return min;
  return current >= max ? unlimited : Math.min(max, current + step);
}

export function counterText(range: CounterRange, value: number): string {
  return range.unlimited !== undefined && value >= range.unlimited ? '∞' : String(value);
}

export function counterModifiers(event: MouseEvent): CounterModifiers {
  return { jump: event.shiftKey, tens: event.ctrlKey || event.metaKey };
}

export interface CounterModel {
  readonly value: number;
  readonly lessLabel: string;
  readonly moreLabel: string;
  readonly lessTooltip: string;
  readonly moreTooltip: string;
  /** False fades the arrow and ignores its press; its tooltip then says why. Absent is true. */
  readonly lessEnabled?: boolean;
  readonly moreEnabled?: boolean;
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
    if (isDisabled(delta > 0 ? more : less)) return;
    const next = counterStep(range, current, delta, counterModifiers(event));
    if (next !== current) onChange(next);
  };
  onPress(less, (event) => press(-1, event));
  onPress(more, (event) => press(1, event));
  return {
    element: root,
    update(model): void {
      current = model.value;
      write(value, counterText(range, model.value));
      setAttribute(less, 'aria-label', model.lessLabel);
      setAttribute(more, 'aria-label', model.moreLabel);
      setTip(less, model.lessTooltip);
      setTip(more, model.moreTooltip);
      setDisabled(less, model.lessEnabled === false);
      setDisabled(more, model.moreEnabled === false);
    },
  };
}
