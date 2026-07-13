import { localeParam, messages } from '../../i18n/index.js';
import { el } from '../../view/overlay.js';

const GLOBAL_PARAMS = [
  'lang',
  'uiscale',
  'speed',
  'zoom',
  'sound',
  'fog',
  'debug',
  'atlas',
  'terrain',
  'objects',
  'pitch',
  'pitchy',
] as const;

interface SelectSetting {
  readonly kind: 'select';
  readonly param: (typeof GLOBAL_PARAMS)[number];
  readonly label: string;
  readonly detail: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly fallback: string;
}

interface NumberSetting {
  readonly kind: 'number';
  readonly param: 'pitch' | 'pitchy';
  readonly label: string;
  readonly detail: string;
  readonly placeholder: string;
}

type Setting = SelectSetting | NumberSetting;

function currentGlobals(): URLSearchParams {
  const current = new URLSearchParams(window.location.search);
  const globals = new URLSearchParams();
  for (const key of GLOBAL_PARAMS) {
    const value = current.get(key);
    if (value !== null) globals.set(key, value);
  }
  return globals;
}

export function targetSearch(entry: string): string {
  const target = currentGlobals();
  const entryParams = new URLSearchParams(entry.startsWith('?') ? entry.slice(1) : entry);
  for (const [key, value] of entryParams) target.set(key, value);
  return `?${target.toString()}`;
}

function settingsModel(): readonly Setting[] {
  const copy = messages().menu;
  return [
    {
      kind: 'select',
      param: 'lang',
      label: copy.language,
      detail: copy.languageDetail,
      fallback: localeParam(new URLSearchParams(window.location.search)),
      options: [
        { value: 'pol', label: copy.languagePolish },
        { value: 'eng', label: copy.languageEnglish },
      ],
    },
    {
      kind: 'select',
      param: 'uiscale',
      label: copy.uiScale,
      detail: copy.uiScaleDetail,
      fallback: '1.4',
      options: ['1', '1.25', '1.4', '1.75', '2'].map((value) => ({ value, label: `${value}×` })),
    },
    {
      kind: 'select',
      param: 'speed',
      label: copy.speed,
      detail: copy.speedDetail,
      fallback: '1',
      options: ['0.5', '1', '2', '3'].map((value) => ({ value, label: `${value}×` })),
    },
    {
      kind: 'select',
      param: 'zoom',
      label: copy.zoom,
      detail: copy.zoomDetail,
      fallback: '',
      options: [
        { value: '', label: copy.automatic },
        ...['0.5', '0.75', '1', '1.5', '2'].map((value) => ({ value, label: `${value}×` })),
      ],
    },
    {
      kind: 'select',
      param: 'sound',
      label: copy.sound,
      detail: copy.soundDetail,
      fallback: '',
      options: [
        { value: '', label: copy.enabled },
        { value: 'off', label: copy.disabled },
      ],
    },
    {
      kind: 'select',
      param: 'fog',
      label: copy.fog,
      detail: copy.fogDetail,
      fallback: '',
      options: [
        { value: '', label: copy.automatic },
        { value: 'off', label: copy.disabled },
        { value: 'reveal', label: messages().admin.fogModes.reveal },
        { value: 'recon', label: messages().admin.fogModes.recon },
        { value: 'full', label: messages().admin.fogModes.full },
      ],
    },
    {
      kind: 'select',
      param: 'debug',
      label: copy.geometry,
      detail: copy.geometryDetail,
      fallback: '',
      options: [
        { value: '', label: copy.disabled },
        { value: 'geometry', label: copy.enabled },
      ],
    },
    {
      kind: 'select',
      param: 'atlas',
      label: copy.atlas,
      detail: copy.atlasDetail,
      fallback: '',
      options: [
        { value: '', label: copy.automatic },
        { value: 'synthetic', label: copy.synthetic },
        { value: 'none', label: copy.none },
      ],
    },
    {
      kind: 'select',
      param: 'terrain',
      label: copy.terrain,
      detail: copy.terrainDetail,
      fallback: '',
      options: [
        { value: '', label: copy.automatic },
        { value: 'off', label: copy.disabled },
      ],
    },
    {
      kind: 'select',
      param: 'objects',
      label: copy.objects,
      detail: copy.objectsDetail,
      fallback: '',
      options: [
        { value: '', label: copy.automatic },
        { value: 'off', label: copy.disabled },
      ],
    },
    { kind: 'number', param: 'pitch', label: copy.pitch, detail: copy.pitchDetail, placeholder: '68' },
    { kind: 'number', param: 'pitchy', label: copy.pitchY, detail: copy.pitchYDetail, placeholder: '76' },
  ];
}

function replaceParam(param: string, value: string): void {
  const next = new URLSearchParams(window.location.search);
  if (value === '') next.delete(param);
  else next.set(param, value);
  const search = next.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${search === '' ? '' : `?${search}`}`);
}

export function settingsPanel(): HTMLElement {
  const copy = messages().menu;
  const panel = el('section', '');
  panel.className = 'on-settings';
  const head = el('div', '');
  head.className = 'on-settings-head';
  const text = el('div', '');
  const sub = el('p', '', copy.settingsSubtitle);
  sub.className = 'on-subtitle';
  text.append(el('h2', '', copy.settingsTitle), sub);
  const reset = el('button', '', copy.reset) as HTMLButtonElement;
  reset.className = 'on-reset';
  reset.addEventListener('click', () => {
    window.location.search = '';
  });
  head.append(text, reset);
  const grid = el('div', '');
  grid.className = 'on-settings-grid';
  const current = new URLSearchParams(window.location.search);
  for (const setting of settingsModel()) {
    const wrap = el('div', '');
    wrap.className = 'on-setting';
    const label = el('label', '', setting.label) as HTMLLabelElement;
    const detail = el('small', '', setting.detail);
    const id = `setting-${setting.param}`;
    label.htmlFor = id;
    if (setting.kind === 'select') {
      const select = el('select', '') as HTMLSelectElement;
      select.id = id;
      for (const option of setting.options) {
        const node = document.createElement('option');
        node.value = option.value;
        node.textContent = option.label;
        select.append(node);
      }
      select.value = current.get(setting.param) ?? setting.fallback;
      select.addEventListener('change', () => {
        replaceParam(setting.param, select.value);
        if (setting.param === 'lang') window.location.reload();
      });
      wrap.append(label, detail, select);
    } else {
      const input = el('input', '') as HTMLInputElement;
      input.id = id;
      input.type = 'number';
      input.min = '1';
      input.step = '1';
      input.placeholder = setting.placeholder;
      input.value = current.get(setting.param) ?? '';
      input.addEventListener('change', () => replaceParam(setting.param, input.value));
      wrap.append(label, detail, input);
    }
    grid.append(wrap);
  }
  panel.append(head, grid);
  return panel;
}
