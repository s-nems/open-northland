import { messages } from '../../../../../i18n/index.js';
import { FIELD_KEYS_ATTRIBUTE } from '../../../../hotkeys.js';
import {
  type CalculatorState,
  initialCalculator,
  withHomeTribe,
  withWeapon,
} from '../../../../knowledge/calculator.js';
import { element, write } from '../../../parts/dom.js';
import { createSegmented } from '../../../parts/segmented.js';
import type { KnowledgeContext } from '../../context.js';
import './calculator.css';
import { blowPane } from './blow.js';
import type { Update } from './controls.js';
import { duelPane } from './duel.js';

const MODES = ['blow', 'duel'] as const;

/** One per window: reopening the article or stepping back finds the fight as it was left. */
const states = new WeakMap<KnowledgeContext, CalculatorState>();

function stateOf(context: KnowledgeContext): CalculatorState {
  const held = states.get(context);
  const state =
    held === undefined
      ? initialCalculator(context.base, context.tribe())
      : withHomeTribe(held, context.tribe());
  states.set(context, state);
  return state;
}

export function selectCalculatorWeapon(context: KnowledgeContext, weaponId: string): void {
  states.set(context, withWeapon(stateOf(context), weaponId));
}

export function focusCalculator(page: HTMLElement): void {
  page.querySelector('.kn-calc')?.scrollIntoView({ block: 'start' });
  page.querySelector<HTMLElement>('.kn-calc__weapon button')?.focus({ preventScroll: true });
}

/** The damage calculator; state lives per window, so a rebuilt article shows the same fight. */
export function createCalculator(context: KnowledgeContext): HTMLElement {
  const copy = messages().knowledge.mechanics;
  const root = element('section', 'kn-calc');
  root.setAttribute(FIELD_KEYS_ATTRIBUTE, '');
  root.setAttribute('aria-label', copy.calculatorTitle);
  const head = element('div', 'kn-calc__head');
  const slot = element('div', '');
  let refreshBlow: (() => void) | undefined;
  const read = (): CalculatorState => stateOf(context);
  const update: Update = (state) => {
    states.set(context, state);
    refreshBlow?.();
  };
  const hint = element('p', 'kn-calc__hint');
  const mode = createSegmented(MODES, copy.modeLabel, (key) => {
    states.set(context, { ...read(), mode: key });
    show();
  });
  function show(): void {
    const current = read().mode;
    mode.update({ blow: { label: copy.modes.blow }, duel: { label: copy.modes.duel } }, current);
    write(hint, copy.modeHints[current]);
    refreshBlow = undefined;
    if (current === 'duel') {
      slot.replaceChildren(duelPane(context, read, update));
      return;
    }
    const pane = blowPane(context, read, update);
    refreshBlow = pane.refresh;
    slot.replaceChildren(pane.element);
  }
  show();
  head.append(mode.element, hint);
  root.append(head, slot);
  return root;
}
