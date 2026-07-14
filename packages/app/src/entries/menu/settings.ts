import { currentLocale, type Locale, messages } from '../../i18n/index.js';

const CARRIED_PARAMS = ['lang', 'uiscale', 'speed', 'fog', 'debug'] as const;
export const MENU_SPEEDS = ['0.25', '0.5', '1', '2', '3', '4', '6', '8'] as const;
export const MENU_FOG_MODES = ['off', 'reveal', 'recon'] as const;

type CarriedParam = (typeof CARRIED_PARAMS)[number];

interface SettingOption {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
}

interface MenuSetting {
  readonly param: Exclude<CarriedParam, 'lang'>;
  readonly fallback: string;
  readonly options: readonly SettingOption[];
}

function settingModel(): readonly MenuSetting[] {
  const copy = messages().menu;
  return [
    {
      param: 'uiscale',
      fallback: '1.4',
      options: ['1', '1.25', '1.4', '1.75', '2'].map((value) => ({ value, label: `${value}×` })),
    },
    {
      param: 'speed',
      fallback: '1',
      options: MENU_SPEEDS.map((value) => ({
        value,
        label: `${value}×`,
      })),
    },
    {
      param: 'fog',
      fallback: 'reveal',
      options: MENU_FOG_MODES.map((value) => ({ value, ...copy.fogModes[value] })),
    },
    {
      param: 'debug',
      fallback: '',
      options: [
        { value: '', label: copy.disabled },
        { value: 'geometry', label: copy.enabled },
      ],
    },
  ];
}

function replaceParam(param: CarriedParam, value: string): void {
  const next = new URLSearchParams(window.location.search);
  if (value === '') next.delete(param);
  else next.set(param, value);
  const search = next.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${search === '' ? '' : `?${search}`}`);
}

function selectIn(root: ParentNode, param: MenuSetting['param']): HTMLSelectElement {
  const select = root.querySelector(`[data-menu-setting="${param}"]`);
  if (!(select instanceof HTMLSelectElement)) throw new Error(`missing menu setting: ${param}`);
  return select;
}

export function bindMenuSettings(root: ParentNode, params: URLSearchParams): void {
  for (const setting of settingModel()) {
    const select = selectIn(root, setting.param);
    for (const option of setting.options) {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      select.append(node);
    }
    const requested = params.get(setting.param);
    select.value = setting.options.some(({ value }) => value === requested)
      ? (requested ?? setting.fallback)
      : setting.fallback;
    const updateHelp = (): void => {
      if (setting.param !== 'fog') return;
      const detail = setting.options.find(({ value }) => value === select.value)?.detail ?? '';
      select.title = detail;
      const info = root.querySelector('[data-menu-fog-info]');
      if (info instanceof HTMLButtonElement) {
        info.title = detail;
        info.setAttribute('aria-label', `${messages().menu.fogHelpLabel}: ${detail}`);
      }
    };
    updateHelp();
    select.addEventListener('change', () => {
      replaceParam(setting.param, select.value);
      updateHelp();
    });
  }
}

export function bindLocaleFlags(root: HTMLElement): void {
  const copy = messages().menu;
  const locales: readonly { readonly locale: Locale; readonly flag: string; readonly label: string }[] = [
    { locale: 'pol', flag: '🇵🇱', label: copy.languagePolish },
    { locale: 'eng', flag: '🇬🇧', label: copy.languageEnglish },
  ];
  for (const { locale, flag, label } of locales) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'game-menu__language';
    button.textContent = flag;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(currentLocale() === locale));
    button.addEventListener('click', () => {
      if (currentLocale() === locale) return;
      replaceParam('lang', locale);
      window.location.reload();
    });
    root.append(button);
  }
}

/**
 * The search string for returning to the main menu from a running game: the carried settings
 * (`lang`/`uiscale`/`speed`/`fog`/`debug`) kept, the entry-selecting flags (`scene`/`map`/…) dropped, so
 * quit-to-menu lands on the default menu entry with the player's settings intact. The inverse of
 * {@link targetSearch}. Empty (`''`) when nothing carries — a bare navigation to the menu.
 */
export function menuSearch(current = new URLSearchParams(window.location.search)): string {
  const target = new URLSearchParams();
  for (const key of CARRIED_PARAMS) {
    const value = current.get(key);
    if (value !== null) target.set(key, value);
  }
  const search = target.toString();
  return search === '' ? '' : `?${search}`;
}

export function targetSearch(entry: string, current = new URLSearchParams(window.location.search)): string {
  const target = new URLSearchParams();
  for (const key of CARRIED_PARAMS) {
    const value = current.get(key);
    if (value !== null) target.set(key, value);
  }
  const entryParams = new URLSearchParams(entry.startsWith('?') ? entry.slice(1) : entry);
  for (const [key, value] of entryParams) target.set(key, value);
  // Maps default to classic sticky fog when the player picked no mode; scenes keep their own authored
  // fog (usually none — a static showcase must stay fully visible, not hide behind reveal fog), still
  // overridable through the dropdown, which carries an explicit choice for either entry kind.
  const selectedFog = target.get('fog');
  if (entryParams.has('map') && !MENU_FOG_MODES.some((mode) => mode === selectedFog))
    target.set('fog', 'reveal');
  return `?${target.toString()}`;
}
