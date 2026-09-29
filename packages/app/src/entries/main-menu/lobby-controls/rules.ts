import { DEFAULT_WEATHER_MODE, WEATHER_MODES, type WeatherMode } from '@open-northland/lockstep';
import { FOG_MODE, type FogSettings } from '@open-northland/sim';
import { segControl } from '../../../view/settings-controls.js';
import { fogRuleComposer, isMapMode, MAP_MODES, type MapModeName, ruleChoiceState } from './rules-state.js';
import { selectControl } from './select.js';

export interface GameRules {
  /** A `FOG_MODE` id, as the session and room descriptors carry it. */
  readonly fog: number | null;
  readonly progression: boolean | null;
  readonly needs: boolean | null;
  /** Null plays the default weather mode. */
  readonly weather: WeatherMode | null;
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
  /** Offers progression and needs a "keep the world's own" choice; the fog pair is always explicit. */
  readonly inheritedLabel?: string;
  readonly fieldClassName?: string;
  readonly map: {
    readonly label: string;
    readonly modes: Readonly<Record<MapModeName, RuleText>>;
    /** What a saved rule with no fog at all reads as; absent leaves the map unselected. */
    readonly revealed?: string;
  };
  readonly fogOfWar: BooleanRuleText;
  readonly progression: BooleanRuleText;
  readonly needs: BooleanRuleText;
  readonly weather: {
    readonly label: string;
    readonly modes: Readonly<Record<WeatherMode, RuleText>>;
  };
  readonly onChange: (change: Partial<GameRules>) => void;
}
interface Choice<T> extends RuleText {
  readonly value: T;
}

/** The map a fog rule shows: a lobby pair's map, `revealed` for no fog at all, null for the world's
 *  own rule. */
type ShownMap = MapModeName | 'revealed' | null;

function shownMapOf(fog: number | null, settings: FogSettings | null): ShownMap {
  if (settings !== null) return settings.terrainKnown ? 'recon' : 'classic';
  return fog === FOG_MODE.OFF ? 'revealed' : null;
}

export function gameRuleControls(options: GameRuleControlOptions) {
  const inherited = options.inheritedLabel;
  function select<T extends string | boolean | null>(
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
      update(value: T, disabled: boolean, label?: string): void {
        state.update(value, disabled);
        control.update(String(value ?? ''), disabled, label);
      },
    };
  }
  function booleanRule(text: BooleanRuleText, inheritable: boolean, change: (value: boolean | null) => void) {
    const choices: Choice<boolean | null>[] = [
      { value: true, label: text.on },
      { value: false, label: text.off },
    ];
    if (inheritable && inherited !== undefined) choices.unshift({ value: null, label: inherited });
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

  /** A compact multi-value rule: a labelled segment strip with each choice's detail on hover. */
  function segmentedRule<T extends string>(
    label: string,
    choices: readonly Choice<T>[],
    change: (value: T) => void,
  ) {
    const state = ruleChoiceState<T | null>(
      choices.map((choice) => choice.value),
      (value) => {
        if (value !== null) change(value);
      },
    );
    const title = document.createElement('div');
    title.className = 'main-menu__lobby-option-label';
    title.textContent = label;
    const segments = segControl<string>(
      choices.map((choice) => ({ id: choice.value, label: choice.label })),
      '',
      (id) => {
        const choice = choices.find((choice) => choice.value === id);
        if (choice !== undefined) state.request(choice.value);
      },
    );
    segments.root.classList.add('main-menu__lobby-map');
    const field = detailTipHost(segments.root, choices);
    return {
      elements: [title, field],
      update(value: T | null, disabled: boolean): void {
        state.update(value, disabled);
        segments.setActive(value ?? '');
        for (const button of segments.root.querySelectorAll('button')) button.disabled = disabled;
      },
    };
  }

  const fog = fogRuleComposer();
  const mapChoices: Choice<ShownMap>[] = MAP_MODES.map((mode) => ({
    value: mode,
    ...options.map.modes[mode],
  }));
  const map = (() => {
    const change = (mode: ShownMap) => {
      if (mode !== null && isMapMode(mode))
        options.onChange({ fog: fog.request({ terrainKnown: mode === 'recon' }) });
    };
    if (options.presentation === 'select') {
      const control = select(options.map.label, mapChoices, change);
      return {
        elements: control.elements,
        update(shown: ShownMap, disabled: boolean): void {
          control.update(shown, disabled, shown === 'revealed' ? options.map.revealed : undefined);
        },
      };
    }
    const control = segmentedRule<MapModeName>(
      options.map.label,
      MAP_MODES.map((mode) => ({ value: mode, ...options.map.modes[mode] })),
      change,
    );
    return {
      elements: control.elements,
      update(shown: ShownMap, disabled: boolean): void {
        control.update(shown === 'revealed' ? null : shown, disabled);
      },
    };
  })();
  const fogOfWar = booleanRule(options.fogOfWar, false, (value) => {
    options.onChange({ fog: fog.request({ fogOfWar: value === true }) });
  });
  const progression = booleanRule(options.progression, true, (value) =>
    options.onChange({ progression: value }),
  );
  const needs = booleanRule(options.needs, true, (value) => options.onChange({ needs: value }));
  const weatherChoices: Choice<WeatherMode>[] = WEATHER_MODES.map((mode) => ({
    value: mode,
    ...options.weather.modes[mode],
  }));
  const changeWeather = (weather: WeatherMode) => options.onChange({ weather });
  const weather =
    options.presentation === 'select'
      ? select(options.weather.label, weatherChoices, changeWeather)
      : segmentedRule(options.weather.label, weatherChoices, changeWeather);
  return {
    elements: [
      ...map.elements,
      ...fogOfWar.elements,
      ...progression.elements,
      ...needs.elements,
      ...weather.elements,
    ],
    update(rules: GameRules, disabled: boolean): void {
      const settings = fog.show(rules.fog);
      map.update(shownMapOf(rules.fog, settings), disabled);
      fogOfWar.update(settings?.fogOfWar ?? null, disabled);
      progression.update(rules.progression, disabled);
      needs.update(rules.needs, disabled);
      weather.update(rules.weather ?? DEFAULT_WEATHER_MODE, disabled);
    },
    /** The room refused the last settings change; drop what the fog pair composed on top of it. */
    rejected: fog.reject,
  };
}

/** The hovered or focused segment's detail in the shared menu bubble: the segment strip clips its own
 *  overflow, so the host wraps it. */
function detailTipHost(segments: HTMLElement, choices: readonly RuleText[]): HTMLDivElement {
  const host = document.createElement('div');
  host.className = 'main-menu__lobby-map-field main-menu__tip-host';
  host.append(segments);
  const buttons = [...segments.querySelectorAll('button')];
  const show = (event: Event): void => {
    const index = event.target instanceof HTMLButtonElement ? buttons.indexOf(event.target) : -1;
    const detail = index === -1 ? undefined : choices[index]?.detail;
    if (detail === undefined) delete host.dataset.tip;
    else host.dataset.tip = detail;
  };
  const hide = (): void => {
    delete host.dataset.tip;
  };
  host.addEventListener('mouseover', show);
  host.addEventListener('focusin', show);
  host.addEventListener('mouseleave', hide);
  host.addEventListener('focusout', hide);
  return host;
}
