import {
  DAY_NIGHT_MODES,
  type DayNightMode,
  DEFAULT_DAY_NIGHT_MODE,
  DEFAULT_WEATHER_MODE,
  PEACE_MINUTES,
  type PeaceMinutes,
  STORAGE_CAPACITY_FACTORS,
  type StorageCapacityFactor,
  WEATHER_MODES,
  type WeatherMode,
} from '@open-northland/lockstep';
import { FOG_MODE, type FogSettings } from '@open-northland/sim';
import { formatMessage } from '../../../i18n/index.js';
import { segControl } from '../../../view/settings/controls.js';
import { type AdvancedText, advancedSettings } from './advanced.js';
import { fogRuleComposer, isMapMode, MAP_MODES, type MapModeName, ruleChoiceState } from './rules-state.js';
import { selectControl } from './select.js';
import { switchRow } from './switch-row.js';

export interface GameRules {
  /** A `FOG_MODE` id, as the session and room descriptors carry it. */
  readonly fog: number | null;
  readonly progression: boolean | null;
  readonly needs: boolean | null;
  /** Null plays the default weather mode. */
  readonly weather: WeatherMode | null;
  /** Null plays the default day and night mode. */
  readonly dayNight: DayNightMode | null;
  readonly alliedVision: boolean | null;
  /** Null plays without a peace. */
  readonly peace: PeaceMinutes | null;
  /** Null keeps the storage buildings' own sizes. */
  readonly storageCapacity: StorageCapacityFactor | null;
}
interface RuleText {
  readonly label: string;
  readonly detail?: string;
}
interface BooleanRuleText extends RuleText {
  readonly on: string;
  readonly off: string;
}
export interface GameRuleControlOptions {
  /** Offers progression and needs a "keep the world's own" choice; the fog pair is always explicit. */
  readonly inheritedLabel?: string;
  /** A dropdown rule's field on the card; absent stands it in the lobby's label-and-control row. */
  readonly fieldClassName?: string;
  /** The map setting; absent offers none, so the game plays the map the rules already hold. */
  readonly map?: {
    readonly label: string;
    readonly modes: Readonly<Record<MapModeName, RuleText>>;
    /** What a saved rule with no fog at all reads as; absent leaves the map unselected. */
    readonly revealed?: string;
  };
  readonly fogOfWar: BooleanRuleText;
  readonly progression: BooleanRuleText;
  readonly needs: BooleanRuleText;
  readonly alliedVision: BooleanRuleText;
  readonly weather: {
    readonly label: string;
    readonly modes: Readonly<Record<WeatherMode, RuleText>>;
  };
  readonly dayNight: {
    readonly label: string;
    readonly modes: Readonly<Record<DayNightMode, RuleText>>;
  };
  readonly storage: StorageRuleText;
  /** Offers the peace choice; absent for a map that plays without one. */
  readonly peace?: PeaceRuleText;
  readonly advanced: AdvancedText;
  readonly onChange: (change: Partial<GameRules>) => void;
}
interface PeaceRuleText {
  readonly label: string;
  /** Every choice's hover detail. */
  readonly detail: string;
  readonly off: string;
  /** A length's label, with `{minutes}`. */
  readonly minutes: string;
}
interface StorageRuleText {
  readonly label: string;
  readonly detail: string;
  /** A factor's label, with `{factor}`. */
  readonly factor: string;
}
let ruleIds = 0;

/** The peace choice's id for no peace; a length's id is its minutes. */
const NO_PEACE = 'off';

const peaceChoiceId = (peace: PeaceMinutes | null): string => (peace === null ? NO_PEACE : String(peace));

/** The factor the standard game stores at, which the storage rule's null plays. */
const STANDARD_STORAGE_FACTOR = 1;

const storageChoiceId = (factor: StorageCapacityFactor | null): string =>
  String(factor ?? STANDARD_STORAGE_FACTOR);

/** The lobby's label-and-control row, which every rule in the advanced window stands in. */
const OPTION_ROW_CLASS = 'main-menu__lobby-option-row';

/** The advanced rules as the standard game plays them, which the window's reset restores. */
const STANDARD_ADVANCED = {
  progression: true,
  needs: true,
  storageCapacity: null,
  weather: DEFAULT_WEATHER_MODE,
  dayNight: DEFAULT_DAY_NIGHT_MODE,
} as const satisfies Partial<GameRules>;

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

/** A rule's written-out detail under its label, for the rows with room to show it. */
function ruleDetail(label: HTMLElement, text: string | undefined): HTMLElement {
  const detail = document.createElement('small');
  detail.id = `lobby-rule-${++ruleIds}`;
  detail.className = 'main-menu__rule-detail';
  detail.textContent = text ?? '';
  label.append(detail);
  return detail;
}

/** The value a read-only viewer reads in place of a row's control, shown under `.is-readonly`; a
 *  `changed` row is a rule the standard game plays otherwise. */
function readout(row: HTMLElement): (text: string, changed: boolean) => void {
  const value = document.createElement('span');
  value.className = 'main-menu__rule-value';
  row.append(value);
  return (text, changed) => {
    value.textContent = text;
    row.classList.toggle('is-changed', changed);
  };
}

/**
 * The match rules as the card shows them: the settings every match sets, then the advanced entry,
 * whose window holds the rules most games keep standard.
 */
export function gameRuleControls(options: GameRuleControlOptions) {
  const inherited = options.inheritedLabel;
  /** A dropdown rule. On the card the held choice's detail is a hover tip; in the advanced window it is
   *  written under the label. */
  function select<T extends string | boolean | null>(
    label: string,
    choices: readonly Choice<T>[],
    change: (value: T) => void,
    placement: 'card' | 'advanced' = 'card',
  ) {
    const state = ruleChoiceState(
      choices.map((choice) => choice.value),
      change,
    );
    const control = selectControl(
      label,
      choices.map((choice) => ({ id: String(choice.value ?? ''), label: choice.label })),
      (id) => {
        const choice = choices.find((choice) => String(choice.value ?? '') === id);
        if (choice !== undefined) state.request(choice.value);
      },
      placement === 'advanced' ? OPTION_ROW_CLASS : (options.fieldClassName ?? OPTION_ROW_CLASS),
    );
    const written = placement === 'advanced' ? ruleDetail(control.caption, undefined) : null;
    const show = readout(control.root);
    return {
      elements: [control.root],
      state,
      update(value: T, disabled: boolean, label?: string, changed = false): void {
        state.update(value, disabled);
        control.update(String(value ?? ''), disabled, label);
        const held = choices.find((choice) => choice.value === value);
        if (written !== null) written.textContent = held?.detail ?? '';
        else showDetail(control.root, held?.detail);
        show(held?.label ?? label ?? '', changed);
      },
    };
  }
  function booleanRule(
    text: BooleanRuleText,
    inheritable: boolean,
    change: (value: boolean | null) => void,
    placement: 'card' | 'advanced' = 'card',
  ) {
    const { detail } = text;
    const choices: Choice<boolean | null>[] = [
      { value: true, label: text.on, ...(detail === undefined ? {} : { detail }) },
      { value: false, label: text.off, ...(detail === undefined ? {} : { detail }) },
    ];
    if (inheritable && inherited !== undefined)
      choices.unshift({ value: null, label: inherited, ...(detail === undefined ? {} : { detail }) });
    const state = ruleChoiceState(
      choices.map((choice) => choice.value),
      change,
    );
    const { row, label, pill, paint } = switchRow(text.label, () => state.request(!state.value()));
    if (detail !== undefined) pill.setAttribute('aria-describedby', ruleDetail(label, detail).id);
    // Any rule can arrive as the world's own; the room shows it in a dropdown naming the map default.
    const fallback = inherited !== undefined ? select(text.label, choices, change, placement) : null;
    const show = readout(row);
    return {
      elements: [row, ...(fallback?.elements ?? [])],
      state,
      update(value: boolean | null, disabled: boolean, changed = false): void {
        state.update(value, disabled);
        paint(value === true, disabled);
        pill.title = value === true ? text.on : text.off;
        show(value === true ? text.on : text.off, changed);
        if (fallback !== null) {
          row.hidden = value === null;
          fallback.update(value, disabled, value === null ? inherited : undefined);
          for (const element of fallback.elements) element.hidden = value !== null;
        }
      },
    };
  }

  /** A compact multi-value rule: one row of label and segment strip. Each choice's detail shows on
   *  hover, or the rule's own `detail` is written under the label. */
  function segmentedRule<T extends string>(
    label: string,
    choices: readonly Choice<T>[],
    change: (value: T) => void,
    detail?: string,
  ) {
    const state = ruleChoiceState<T | null>(
      choices.map((choice) => choice.value),
      (value) => {
        if (value !== null) change(value);
      },
    );
    const title = document.createElement('span');
    const name = document.createElement('span');
    name.id = `lobby-rule-${++ruleIds}`;
    name.textContent = label;
    title.append(name);
    const segments = segControl<string>(
      choices.map((choice) => ({ id: choice.value, label: choice.label })),
      '',
      (id) => {
        const choice = choices.find((choice) => choice.value === id);
        if (choice !== undefined) state.request(choice.value);
      },
    );
    segments.root.classList.add('main-menu__lobby-map');
    segments.root.setAttribute('role', 'group');
    segments.root.setAttribute('aria-labelledby', name.id);
    if (detail !== undefined) segments.root.setAttribute('aria-describedby', ruleDetail(title, detail).id);
    const row = detailTipRow(title, segments.root, choices);
    const show = readout(row);
    return {
      elements: [row],
      state,
      update(value: T | null, disabled: boolean, changed = false): void {
        state.update(value, disabled);
        show(choices.find((choice) => choice.value === value)?.label ?? '', changed);
        segments.setActive(value ?? '');
        for (const button of segments.root.querySelectorAll('button')) button.disabled = disabled;
      },
    };
  }

  const fog = fogRuleComposer();
  const map = (() => {
    const text = options.map;
    if (text === undefined) return null;
    const mapChoices: Choice<MapModeName>[] = MAP_MODES.map((mode) => ({ value: mode, ...text.modes[mode] }));
    const change = (mode: ShownMap) => {
      if (mode !== null && isMapMode(mode))
        options.onChange({ fog: fog.request({ terrainKnown: mode === 'recon' }) });
    };
    const control = segmentedRule<MapModeName>(text.label, mapChoices, change);
    const inheritedMap = document.createElement('p');
    inheritedMap.className = 'main-menu__rule-note';
    return {
      elements: [...control.elements, inheritedMap],
      update(shown: ShownMap, disabled: boolean): void {
        control.update(shown === 'revealed' ? null : shown, disabled);
        inheritedMap.textContent = shown === 'revealed' ? (text.revealed ?? '') : (inherited ?? '');
        inheritedMap.hidden = shown !== null && shown !== 'revealed';
      },
    };
  })();
  const mapElements = map?.elements ?? [];
  const fogOfWar = booleanRule(options.fogOfWar, false, (value) => {
    options.onChange({ fog: fog.request({ fogOfWar: value === true }) });
  });
  const alliedVision = booleanRule(options.alliedVision, false, (value) =>
    options.onChange({ alliedVision: value === true }),
  );
  const peace = (() => {
    const text = options.peace;
    if (text === undefined) return null;
    const choices: Choice<string>[] = [
      { value: NO_PEACE, label: text.off, detail: text.detail },
      ...PEACE_MINUTES.map((minutes) => ({
        value: peaceChoiceId(minutes),
        label: formatMessage(text.minutes, { minutes }),
        detail: text.detail,
      })),
    ];
    const change = (id: string) =>
      options.onChange({ peace: PEACE_MINUTES.find((minutes) => peaceChoiceId(minutes) === id) ?? null });
    // The lengths overflow a segment strip.
    return select(text.label, choices, change);
  })();
  const peaceElements = peace?.elements ?? [];

  const progression = booleanRule(
    options.progression,
    true,
    (value) => options.onChange({ progression: value }),
    'advanced',
  );
  const needs = booleanRule(options.needs, true, (value) => options.onChange({ needs: value }), 'advanced');
  const storageLabel = (factor: StorageCapacityFactor | null): string =>
    formatMessage(options.storage.factor, { factor: factor ?? STANDARD_STORAGE_FACTOR });
  const storageChoices: Choice<string>[] = [null, ...STORAGE_CAPACITY_FACTORS].map((factor) => ({
    value: storageChoiceId(factor),
    label: storageLabel(factor),
  }));
  const storage = segmentedRule(
    options.storage.label,
    storageChoices,
    (id) =>
      options.onChange({
        storageCapacity: STORAGE_CAPACITY_FACTORS.find((factor) => storageChoiceId(factor) === id) ?? null,
      }),
    options.storage.detail,
  );
  const weatherModes = options.weather.modes;
  const weatherChoices: Choice<WeatherMode>[] = WEATHER_MODES.map((mode) => ({
    value: mode,
    ...weatherModes[mode],
  }));
  const weather = select(
    options.weather.label,
    weatherChoices,
    (weather) => options.onChange({ weather }),
    'advanced',
  );
  const dayNightModes = options.dayNight.modes;
  const dayNightChoices: Choice<DayNightMode>[] = DAY_NIGHT_MODES.map((mode) => ({
    value: mode,
    ...dayNightModes[mode],
  }));
  const dayNight = select(
    options.dayNight.label,
    dayNightChoices,
    (dayNight) => options.onChange({ dayNight }),
    'advanced',
  );

  /** The advanced rules as `rules` holds them, each flagged when the standard game plays it otherwise; a
   *  rule kept at the world's own reads standard. */
  function advancedRead(rules: GameRules) {
    const weatherMode = rules.weather ?? STANDARD_ADVANCED.weather;
    const dayNightMode = rules.dayNight ?? STANDARD_ADVANCED.dayNight;
    return {
      weatherMode,
      dayNightMode,
      progression: {
        changed: rules.progression === false,
        label: options.progression.label,
        choice: options.progression.off,
      },
      needs: { changed: rules.needs === false, label: options.needs.label, choice: options.needs.off },
      storage: {
        changed: rules.storageCapacity !== null,
        label: options.storage.label,
        choice: storageLabel(rules.storageCapacity),
      },
      weather: {
        changed: weatherMode !== STANDARD_ADVANCED.weather,
        label: options.weather.label,
        choice: weatherModes[weatherMode].label,
      },
      dayNight: {
        changed: dayNightMode !== STANDARD_ADVANCED.dayNight,
        label: options.dayNight.label,
        choice: dayNightModes[dayNightMode].label,
      },
    };
  }

  const advanced = advancedSettings({
    text: options.advanced,
    groups: [
      {
        title: options.advanced.rulesGroup,
        rows: [...progression.elements, ...needs.elements, ...storage.elements],
      },
      { title: options.advanced.worldGroup, rows: [...weather.elements, ...dayNight.elements] },
    ],
    reset(): void {
      const standard = STANDARD_ADVANCED;
      // A rule kept at the map's own already plays as the map meant; only one switched off goes back.
      const restores = (rule: typeof progression): boolean =>
        rule.state.value() === false && rule.state.claim(true);
      const change: Partial<GameRules> = {
        ...(restores(progression) ? { progression: standard.progression } : {}),
        ...(restores(needs) ? { needs: standard.needs } : {}),
        ...(storage.state.claim(storageChoiceId(standard.storageCapacity))
          ? { storageCapacity: standard.storageCapacity }
          : {}),
        ...(weather.state.claim(standard.weather) ? { weather: standard.weather } : {}),
        ...(dayNight.state.claim(standard.dayNight) ? { dayNight: standard.dayNight } : {}),
      };
      if (Object.keys(change).length > 0) options.onChange(change);
    },
  });

  return {
    /** The card's rows: the map, fog of war, the allies' shared map and the peace. */
    basicElements: [...mapElements, ...fogOfWar.elements, ...alliedVision.elements, ...peaceElements],
    /** The advanced entry: its button and the line naming what differs from the standard game. */
    advancedElements: advanced.elements,
    /** `note` says, while `disabled`, why nothing here can be changed. */
    update(rules: GameRules, disabled: boolean, note = ''): void {
      const settings = fog.show(rules.fog);
      map?.update(shownMapOf(rules.fog, settings), disabled);
      fogOfWar.update(settings?.fogOfWar ?? null, disabled);
      alliedVision.update(rules.alliedVision, disabled);
      peace?.update(peaceChoiceId(rules.peace), disabled);
      const read = advancedRead(rules);
      progression.update(rules.progression, disabled, read.progression.changed);
      needs.update(rules.needs, disabled, read.needs.changed);
      storage.update(storageChoiceId(rules.storageCapacity), disabled, read.storage.changed);
      weather.update(read.weatherMode, disabled, undefined, read.weather.changed);
      dayNight.update(read.dayNightMode, disabled, undefined, read.dayNight.changed);
      const changes = [read.progression, read.needs, read.storage, read.weather, read.dayNight]
        .filter((rule) => rule.changed)
        .map((rule) => `${rule.label}: ${rule.choice}`);
      advanced.update(changes, disabled, note);
    },
    /** The room refused the last settings change; drop what the fog pair composed on top of it. */
    rejected: fog.reject,
    dispose: advanced.dispose,
  };
}

/** A dropdown row's hover tip: the detail of the choice it holds. */
function showDetail(row: HTMLElement, detail: string | undefined): void {
  row.classList.toggle('main-menu__tip-host', detail !== undefined);
  if (detail === undefined) delete row.dataset.tip;
  else row.dataset.tip = detail;
}

/** The hovered or focused segment's detail in the shared menu bubble: the segment strip clips its own
 *  overflow, so the row hosts it. */
function detailTipRow(
  label: HTMLElement,
  segments: HTMLElement,
  choices: readonly RuleText[],
): HTMLDivElement {
  const host = document.createElement('div');
  host.className = 'main-menu__lobby-option-row main-menu__lobby-map-field main-menu__tip-host';
  host.append(label, segments);
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
