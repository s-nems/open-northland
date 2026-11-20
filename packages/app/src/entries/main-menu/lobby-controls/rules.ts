import {
  DAY_NIGHT_MODES,
  type DayNightMode,
  DEFAULT_DAY_NIGHT_MODE,
  DEFAULT_WEATHER_MODE,
  PEACE_MINUTES,
  type PeaceMinutes,
  RESOURCE_YIELD_FACTORS,
  type ResourceYieldFactor,
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
  /** Null keeps the authored stock of the map's wood, mushrooms, clay and stone. */
  readonly basicYield: ResourceYieldFactor | null;
  /** Null keeps the authored stock of the map's iron and gold. */
  readonly oreYield: ResourceYieldFactor | null;
  /** Null keeps papers, as every world allows them. */
  readonly papers: boolean | null;
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
  readonly storage: FactorRuleText;
  readonly basicYield: FactorRuleText;
  readonly oreYield: FactorRuleText;
  readonly papers: BooleanRuleText;
  /** The ore richness the window's reset restores, read at each change; absent restores the authored
   *  stock. */
  readonly standardOreYield?: () => ResourceYieldFactor | null;
  /** Holds the card's rules in the window too, first under the game rules, for a screen that shows only
   *  the entry. Its summary and reset then cover them, with fog of war and the allies' shared map off as
   *  the standard. */
  readonly everyRuleInWindow?: boolean;
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
/** A multiplier rule's text. */
interface FactorRuleText {
  readonly label: string;
  readonly detail: string;
  /** A factor's label, with `{factor}`. */
  readonly factor: string;
}
let ruleIds = 0;

/** The peace choice's id for no peace; a length's id is its minutes. */
const NO_PEACE = 'off';

const peaceChoiceId = (peace: PeaceMinutes | null): string => (peace === null ? NO_PEACE : String(peace));

/** The factor a multiplier rule's null plays: the content's own amounts. */
const STANDARD_FACTOR = 1;

const factorChoiceId = (factor: number | null): string => String(factor ?? STANDARD_FACTOR);

/** The lobby's label-and-control row, which every rule in the advanced window stands in. */
const OPTION_ROW_CLASS = 'main-menu__lobby-option-row';

/** The advanced rules as the standard game plays them, which the window's reset restores. */
const STANDARD_ADVANCED = {
  progression: true,
  needs: true,
  papers: true,
  storageCapacity: null,
  basicYield: null,
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
    if (written !== null) control.button.setAttribute('aria-describedby', written.id);
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
      /** `unlisted` is read in place of a value no segment stands for. */
      update(value: T | null, disabled: boolean, changed = false, unlisted = ''): void {
        state.update(value, disabled);
        show(choices.find((choice) => choice.value === value)?.label ?? unlisted, changed);
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
        // Neither segment stands for the map's own rule or no fog: the note says which, and a
        // read-only viewer reads it as the row's value.
        const note = shown === 'revealed' ? (text.revealed ?? '') : (inherited ?? '');
        control.update(shown === 'revealed' ? null : shown, disabled, false, note);
        inheritedMap.textContent = note;
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
  // No world sets a paper rule of its own, so the window offers no "map's own" choice.
  const papers = booleanRule(
    options.papers,
    false,
    (value) => options.onChange({ papers: value }),
    'advanced',
  );
  /** A multiplier rule: one segment per factor, the first for null, the content's own amounts. */
  function factorRule<F extends number>(
    text: FactorRuleText,
    factors: readonly F[],
    change: (factor: F | null) => void,
  ) {
    const label = (factor: F | null): string =>
      formatMessage(text.factor, { factor: factor ?? STANDARD_FACTOR });
    const choices: Choice<string>[] = [null, ...factors].map((factor) => ({
      value: factorChoiceId(factor),
      label: label(factor),
    }));
    const control = segmentedRule(
      text.label,
      choices,
      (id) => change(factors.find((factor) => factorChoiceId(factor) === id) ?? null),
      text.detail,
    );
    return { ...control, label };
  }
  const storage = factorRule(options.storage, STORAGE_CAPACITY_FACTORS, (storageCapacity) =>
    options.onChange({ storageCapacity }),
  );
  const basicYield = factorRule(options.basicYield, RESOURCE_YIELD_FACTORS, (basicYield) =>
    options.onChange({ basicYield }),
  );
  const oreYield = factorRule(options.oreYield, RESOURCE_YIELD_FACTORS, (oreYield) =>
    options.onChange({ oreYield }),
  );
  const standardOreYield = (): ResourceYieldFactor | null => options.standardOreYield?.() ?? null;
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

  const inWindow = options.everyRuleInWindow === true;
  const basicElements = [...mapElements, ...fogOfWar.elements, ...alliedVision.elements, ...peaceElements];

  /** The advanced rules as `rules` holds them, each flagged when the standard game plays it otherwise; a
   *  rule kept at the world's own reads standard. */
  function advancedRead(rules: GameRules, settings: FogSettings | null) {
    const weatherMode = rules.weather ?? STANDARD_ADVANCED.weather;
    const dayNightMode = rules.dayNight ?? STANDARD_ADVANCED.dayNight;
    return {
      weatherMode,
      dayNightMode,
      // A switched-on rule reads as its name alone.
      fogOfWar: { changed: inWindow && settings?.fogOfWar === true, label: options.fogOfWar.label },
      alliedVision: { changed: inWindow && rules.alliedVision === true, label: options.alliedVision.label },
      progression: {
        changed: rules.progression === false,
        label: options.progression.label,
        choice: options.progression.off,
      },
      needs: { changed: rules.needs === false, label: options.needs.label, choice: options.needs.off },
      papers: { changed: rules.papers === false, label: options.papers.label, choice: options.papers.off },
      storage: {
        changed: rules.storageCapacity !== null,
        label: options.storage.label,
        choice: storage.label(rules.storageCapacity),
      },
      basicYield: {
        changed: rules.basicYield !== null,
        label: options.basicYield.label,
        choice: basicYield.label(rules.basicYield),
      },
      oreYield: {
        changed: rules.oreYield !== standardOreYield(),
        label: options.oreYield.label,
        choice: oreYield.label(rules.oreYield),
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
        rows: [
          ...(inWindow ? basicElements : []),
          ...progression.elements,
          ...needs.elements,
          ...storage.elements,
          ...papers.elements,
        ],
      },
      { title: options.advanced.resourcesGroup, rows: [...basicYield.elements, ...oreYield.elements] },
      { title: options.advanced.worldGroup, rows: [...weather.elements, ...dayNight.elements] },
    ],
    reset(): void {
      const standard = STANDARD_ADVANCED;
      // A rule kept at the map's own already plays as the map meant; only one switched off, or
      // being switched off, goes back.
      const restores = (rule: typeof progression): boolean =>
        rule.state.pending() === false && rule.state.claim(true);
      const change: Partial<GameRules> = {
        ...(inWindow && fogOfWar.state.claim(false) ? { fog: fog.request({ fogOfWar: false }) } : {}),
        ...(inWindow && alliedVision.state.claim(false) ? { alliedVision: false } : {}),
        ...(restores(progression) ? { progression: standard.progression } : {}),
        ...(restores(needs) ? { needs: standard.needs } : {}),
        ...(papers.state.claim(standard.papers) ? { papers: standard.papers } : {}),
        ...(storage.state.claim(factorChoiceId(standard.storageCapacity))
          ? { storageCapacity: standard.storageCapacity }
          : {}),
        ...(basicYield.state.claim(factorChoiceId(standard.basicYield))
          ? { basicYield: standard.basicYield }
          : {}),
        ...(oreYield.state.claim(factorChoiceId(standardOreYield())) ? { oreYield: standardOreYield() } : {}),
        ...(weather.state.claim(standard.weather) ? { weather: standard.weather } : {}),
        ...(dayNight.state.claim(standard.dayNight) ? { dayNight: standard.dayNight } : {}),
      };
      if (Object.keys(change).length > 0) options.onChange(change);
    },
  });

  return {
    /** The card's rows: the map, fog of war, the allies' shared map and the peace; none while the window
     *  holds them. */
    basicElements: inWindow ? [] : basicElements,
    /** The advanced entry: its button and the line naming what differs from the standard game. */
    advancedElements: advanced.elements,
    /** `note` says, while `disabled`, why nothing here can be changed. */
    update(rules: GameRules, disabled: boolean, note = ''): void {
      const settings = fog.show(rules.fog);
      map?.update(shownMapOf(rules.fog, settings), disabled);
      fogOfWar.update(settings?.fogOfWar ?? null, disabled);
      alliedVision.update(rules.alliedVision, disabled);
      peace?.update(peaceChoiceId(rules.peace), disabled);
      const read = advancedRead(rules, settings);
      progression.update(rules.progression, disabled, read.progression.changed);
      needs.update(rules.needs, disabled, read.needs.changed);
      papers.update(rules.papers !== false, disabled, read.papers.changed);
      storage.update(factorChoiceId(rules.storageCapacity), disabled, read.storage.changed);
      basicYield.update(factorChoiceId(rules.basicYield), disabled, read.basicYield.changed);
      oreYield.update(factorChoiceId(rules.oreYield), disabled, read.oreYield.changed);
      weather.update(read.weatherMode, disabled, undefined, read.weather.changed);
      dayNight.update(read.dayNightMode, disabled, undefined, read.dayNight.changed);
      const changes = [
        read.fogOfWar,
        read.alliedVision,
        read.progression,
        read.needs,
        read.storage,
        read.papers,
        read.basicYield,
        read.oreYield,
        read.weather,
        read.dayNight,
      ]
        .filter((rule) => rule.changed)
        .map((rule) => ('choice' in rule ? `${rule.label}: ${rule.choice}` : rule.label));
      advanced.update(changes, disabled, note, changes.length > 0);
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
