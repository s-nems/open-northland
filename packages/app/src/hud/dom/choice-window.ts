import type { UiCue } from '@open-northland/audio';
import { bcp47Tag, messages } from '../../i18n/index.js';
import { GLYPH } from './icons.js';
import { createHudPlane } from './root.js';
import { createHudWindow } from './window.js';

export interface ChoiceRow {
  readonly key: string;
  readonly label: string;
  readonly reason?: string;
}
export interface ChoiceGroup {
  readonly label: string;
  readonly rows: readonly ChoiceRow[];
}
export const choiceMatches = (label: string, query: string): boolean => {
  const normalize = (text: string): string =>
    text
      .trim()
      .toLocaleLowerCase(bcp47Tag())
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replaceAll('ł', 'l');
  return normalize(label).startsWith(normalize(query));
};

/** Shared modal choice surface for professions and school courses. The native dialog owns focus and
 * keeps pointer and keyboard input away from the world; the contents use the regular HUD plane. */
export function createChoiceWindow(opts: {
  readonly title: string;
  readonly scale?: number;
  readonly onPick: (key: string, point?: { x: number; y: number }) => void;
  readonly onDismiss: () => void;
  readonly cue?: (cue: UiCue) => void;
}) {
  const copy = messages().hud;
  const dialog = document.createElement('dialog');
  dialog.className = 'on-choice-modal';
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', opts.title);
  const plane = createHudPlane(opts.scale ?? 1);
  dialog.append(plane.element);
  const window = createHudWindow(plane.element, {
    title: opts.title,
    closeLabel: copy.schoolClose,
    width: 296,
    compact: true,
  });
  window.element.classList.add('on-window--choices');
  const title = window.element.querySelector('h2');
  const tools = document.createElement('div');
  tools.className = 'on-choice-tools';
  const context = document.createElement('div');
  context.className = 'on-choice-context';
  const field = document.createElement('label');
  field.className = 'on-res-field on-res-field--search on-choice-search';
  field.innerHTML = `${GLYPH.search}<input type="search" autocomplete="off">`;
  const search = field.querySelector('input');
  if (search === null) throw new Error('choice search missing');
  search.placeholder = copy.choiceSearch;
  search.setAttribute('aria-label', copy.choiceSearch);
  const list = document.createElement('div');
  list.className = 'on-choice-list';
  tools.append(context, field);
  window.body.append(tools, list);
  document.body.append(dialog);
  let groups: readonly ChoiceGroup[] = [];
  let held = '';
  let searchable = true;
  let anchor: { x: number; y: number } | undefined;
  const place = (): void => {
    if (anchor === undefined) {
      window.element.style.left = '50%';
      window.element.style.top = '50%';
      return;
    }
    const scale = plane.currentScale();
    const halfWidth = window.element.offsetWidth / 2;
    const halfHeight = window.element.offsetHeight / 2;
    const clamp = (value: number, half: number, extent: number): number =>
      Math.max(half + 16, Math.min(value, extent - half - 16));
    window.place(
      clamp(anchor.x / scale, halfWidth, plane.element.clientWidth),
      clamp(anchor.y / scale, halfHeight, plane.element.clientHeight),
    );
  };
  let trigger: HTMLElement | null = null;
  const focusSearch = (): void => {
    search.focus({ preventScroll: true });
    search.select();
  };
  const render = (): void => {
    const focusKey =
      document.activeElement instanceof HTMLElement ? document.activeElement.dataset.choice : undefined;
    const scroll = list.scrollTop;
    list.replaceChildren();
    let count = 0;
    for (const group of groups) {
      const rows = group.rows.filter((row) => choiceMatches(row.label, search.value));
      if (rows.length === 0) continue;
      count += rows.length;
      const section = document.createElement('section');
      section.className = 'on-choice-group';
      const heading = document.createElement('h3');
      heading.textContent = group.label;
      const tally = document.createElement('span');
      tally.textContent = String(rows.length);
      heading.append(tally);
      const grid = document.createElement('div');
      grid.className = 'on-choice-grid';
      for (const row of rows) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'on-button on-choice-row';
        button.dataset.choice = row.key;
        button.setAttribute('aria-disabled', String(row.reason !== undefined));
        const label = document.createElement('span');
        label.textContent = row.label;
        button.append(label);
        if (row.reason !== undefined) {
          button.title = row.reason;
          button.setAttribute('aria-label', `${row.label}: ${row.reason}`);
        }
        button.addEventListener('click', (event) => {
          if (row.reason !== undefined) return;
          opts.cue?.('confirm');
          opts.onPick(row.key, event.detail === 0 ? undefined : { x: event.clientX, y: event.clientY });
        });
        grid.append(button);
      }
      section.append(heading, grid);
      list.append(section);
    }
    if (count === 0) {
      const empty = document.createElement('p');
      empty.className = 'on-choice-empty';
      empty.textContent = search.value.trim() ? copy.choiceNoMatches : copy.choiceEmpty;
      list.append(empty);
    }
    const focused = [...list.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.dataset.choice === focusKey,
    );
    if (focusKey !== undefined)
      (focused ?? (searchable ? search : list.querySelector<HTMLButtonElement>('button')))?.focus({
        preventScroll: true,
      });
    list.scrollTop = scroll;
    if (dialog.open) place();
  };
  search.addEventListener('input', () => {
    list.scrollTop = 0;
    render();
  });
  const dismiss = (): void => {
    opts.cue?.('confirm');
    opts.onDismiss();
  };
  // HudWindow's own close hides its section; the owner can instead navigate back a level.
  window.onDismiss(() => {
    window.open();
    dismiss();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (search.value) {
      search.value = '';
      render();
      focusSearch();
    } else dismiss();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target === plane.element) dismiss();
  });
  const hide = (): void => {
    if (!dialog.open) return;
    dialog.close();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  };
  globalThis.addEventListener('resize', place);
  return {
    update(next: readonly ChoiceGroup[], caption = ''): void {
      const key = JSON.stringify([next, caption]);
      if (key === held) return;
      held = key;
      groups = next;
      context.textContent = caption;
      context.hidden = caption === '';
      render();
    },
    show(label = opts.title, options: { search?: boolean; anchor?: { x: number; y: number } } = {}): void {
      searchable = options.search ?? true;
      field.hidden = !searchable;
      anchor = options.anchor;
      dialog.setAttribute('aria-label', label);
      if (title !== null) title.textContent = label;
      window.element.setAttribute('aria-label', label);
      search.value = '';
      list.scrollTop = 0;
      render();
      window.open();
      if (!dialog.open) {
        trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
      }
      place();
      if (searchable) focusSearch();
      else list.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    },
    hide,
    scrollTop: () => list.scrollTop,
    setScrollTop: (top: number) => {
      list.scrollTop = top;
    },
    async setUiScale(scale: number): Promise<void> {
      await plane.setUiScale(scale);
      if (dialog.open) place();
    },
    dispose(): void {
      hide();
      globalThis.removeEventListener('resize', place);
      dialog.remove();
    },
  };
}
