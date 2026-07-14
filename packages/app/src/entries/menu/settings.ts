import { currentLocale, type Locale, messages } from '../../i18n/index.js';

const CARRIED_PARAMS = ['lang', 'uiscale', 'speed', 'fog', 'debug'] as const;
export const MENU_SPEEDS = ['0.25', '0.5', '1', '2', '3', '4', '6', '8'] as const;

type CarriedParam = (typeof CARRIED_PARAMS)[number];

interface SettingOption {
  readonly value: string;
  readonly label: string;
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
      fallback: '',
      options: [
        { value: '', label: copy.worldDefault },
        { value: 'off', label: copy.disabled },
        { value: 'reveal', label: messages().admin.fogModes.reveal },
        { value: 'recon', label: messages().admin.fogModes.recon },
        { value: 'full', label: messages().admin.fogModes.full },
      ],
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
    select.value = params.get(setting.param) ?? setting.fallback;
    select.addEventListener('change', () => replaceParam(setting.param, select.value));
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

export function targetSearch(entry: string, current = new URLSearchParams(window.location.search)): string {
  const target = new URLSearchParams();
  for (const key of CARRIED_PARAMS) {
    const value = current.get(key);
    if (value !== null) target.set(key, value);
  }
  const entryParams = new URLSearchParams(entry.startsWith('?') ? entry.slice(1) : entry);
  for (const [key, value] of entryParams) target.set(key, value);
  return `?${target.toString()}`;
}
