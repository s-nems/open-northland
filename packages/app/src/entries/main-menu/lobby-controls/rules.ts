import { FOG_MODE_BY_NAME, type FogModeName } from '../../../game/fog.js';
import { segControl } from '../../../view/settings-controls.js';
import { RULE_FOG_MODES, ruleChoiceState } from './rules-state.js';
import { selectControl } from './select.js';

export interface GameRules {
  readonly fog: number | null;
  readonly progression: boolean | null;
  readonly needs: boolean | null;
}
interface RuleText {
  readonly label: string;
  readonly detail?: string;
}
interface BooleanRuleText {
  readonly label: string;
  readonly on: string;
  readonly off: string;
}
export interface GameRuleControlOptions {
  readonly presentation: 'compact' | 'select';
  readonly inheritedLabel?: string;
  readonly fieldClassName?: string;
  readonly fog: {
    readonly label: string;
    readonly modes: Readonly<Record<FogModeName, RuleText>>;
  };
  readonly progression: BooleanRuleText;
  readonly needs: BooleanRuleText;
  readonly onChange: (change: Partial<GameRules>) => void;
}
interface Choice<T> extends RuleText {
  readonly value: T;
}

export function gameRuleControls(options: GameRuleControlOptions) {
  const inherited = options.inheritedLabel;
  function select<T extends number | boolean | null>(
    label: string,
    choices: readonly Choice<T>[],
    change: (value: T) => void,
  ) {
    const state = ruleChoiceState(
      choices.map((choice) => choice.value),
      change,
    );
    const control = selectControl(
      label,
      choices.map((choice) => [String(choice.value ?? ''), choice.label] as const),
      (id) => {
        const choice = choices.find((choice) => String(choice.value ?? '') === id);
        if (choice !== undefined) state.request(choice.value);
      },
      options.fieldClassName,
    );
    return {
      elements: [control.root],
      update(value: T, disabled: boolean): void {
        state.update(value, disabled);
        control.update(String(value ?? ''), disabled);
      },
    };
  }
  const fogChoices: Choice<number | null>[] = RULE_FOG_MODES.map((name) => ({
    value: FOG_MODE_BY_NAME[name],
    ...options.fog.modes[name],
  }));
  if (inherited !== undefined) fogChoices.unshift({ value: null, label: inherited });
  const fog = (() => {
    const change = (value: number | null) => options.onChange({ fog: value });
    if (options.presentation === 'select') return select(options.fog.label, fogChoices, change);
    const state = ruleChoiceState(
      fogChoices.map((choice) => choice.value),
      change,
    );
    const label = document.createElement('div');
    label.className = 'main-menu__lobby-option-label';
    label.textContent = options.fog.label;
    const segments = segControl(
      fogChoices.map((choice, index) => ({
        id: String(index),
        label: choice.label,
        ...(choice.detail !== undefined ? { title: choice.detail } : {}),
      })),
      '',
      (id) => {
        const choice = fogChoices[Number(id)];
        if (choice !== undefined) state.request(choice.value);
      },
    );
    segments.root.classList.add('main-menu__lobby-fog');
    return {
      elements: [label, segments.root],
      update(value: number | null, disabled: boolean): void {
        state.update(value, disabled);
        segments.setActive(String(fogChoices.findIndex((choice) => choice.value === value)));
        for (const button of segments.root.querySelectorAll('button')) button.disabled = disabled;
      },
    };
  })();
  function booleanRule(key: 'progression' | 'needs', text: BooleanRuleText) {
    const choices: Choice<boolean | null>[] = [
      { value: true, label: text.on },
      { value: false, label: text.off },
    ];
    if (inherited !== undefined) choices.unshift({ value: null, label: inherited });
    const change = (value: boolean | null) => options.onChange({ [key]: value });
    if (options.presentation === 'select') return select(text.label, choices, change);
    const state = ruleChoiceState(
      choices.map((choice) => choice.value),
      change,
    );
    const row = document.createElement('div');
    row.className = 'main-menu__lobby-option-row';
    const label = document.createElement('span');
    label.textContent = text.label;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'main-menu__toggle';
    pill.setAttribute('role', 'switch');
    pill.setAttribute('aria-label', text.label);
    pill.addEventListener('click', () => state.request(!state.value()));
    row.append(label, pill);
    return {
      elements: [row],
      update(value: boolean | null, disabled: boolean): void {
        state.update(value, disabled);
        pill.disabled = disabled;
        pill.classList.toggle('is-on', value === true);
        pill.setAttribute('aria-checked', String(value === true));
        pill.title = value === true ? text.on : text.off;
      },
    };
  }
  const progression = booleanRule('progression', options.progression);
  const needs = booleanRule('needs', options.needs);
  return {
    elements: [...fog.elements, ...progression.elements, ...needs.elements],
    update(rules: GameRules, disabled: boolean): void {
      fog.update(rules.fog, disabled);
      progression.update(rules.progression, disabled);
      needs.update(rules.needs, disabled);
    },
  };
}
