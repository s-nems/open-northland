import type { UiCue } from '@open-northland/audio';
import { messages } from '../../i18n/index.js';
import { dismissOnBackdropClick } from '../../view/backdrop-dismiss.js';
import type { CameraGestures } from '../../view/camera/index.js';
import { type GoodIconPainter, goodIconMarkup } from './good-art.js';
import { GLYPH } from './icons.js';
import { hasWords, searchWords } from './parts/name-search.js';
import { quietTextField } from './parts/text-field.js';
import { createHudPlane } from './root.js';
import { createHudWindow } from './window.js';

export interface ChoiceRow {
  readonly key: string;
  readonly label: string;
  readonly reason?: string;
  /** A good whose icon leads the row; shown only when the window has an icon painter. */
  readonly goodId?: string;
  /** Overlapping goods for a trade with several products. */
  readonly goodIds?: readonly string[];
  /** A short value at the row's right edge, such as a count. */
  readonly detail?: string;
  /** The hover text of an enabled row. */
  readonly tooltip?: string;
}
export interface ChoiceGroup {
  readonly label: string;
  readonly rows: readonly ChoiceRow[];
}

/** Design px of a row's good icon, a little under the row's height. */
const ROW_ICON_PX = 22;
const rowGoods = (row: ChoiceRow): readonly string[] =>
  row.goodIds ?? (row.goodId === undefined ? [] : [row.goodId]);

/** Shared modal choice surface for professions, school courses and equipment. The native dialog owns
 * focus and keeps clicks and hotkeys away from the world, handing only the camera's gestures on, so the
 * map still moves under it; the contents use the regular HUD plane. */
export function createChoiceWindow(opts: {
  readonly title: string;
  readonly camera: CameraGestures;
  readonly scale?: number;
  /** `event` is the row's click, whose modifiers a caller may read (Shift queues an order). */
  readonly onPick: (key: string, event: MouseEvent) => void;
  readonly onDismiss: () => void;
  readonly cue?: (cue: UiCue) => void;
  readonly icons?: GoodIconPainter;
  /** The note an empty list shows; absent, the generic "nothing discovered". */
  readonly emptyLabel?: string;
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
  window.element.tabIndex = -1;
  const title = window.element.querySelector('h2');
  const tools = document.createElement('div');
  tools.className = 'on-choice-tools';
  const context = document.createElement('div');
  context.className = 'on-choice-context';
  const field = document.createElement('label');
  field.className = 'on-res-field on-res-field--search on-choice-search';
  field.innerHTML = `${GLYPH.search}<input type="search">`;
  const input = field.querySelector('input');
  if (input === null) throw new Error('choice search missing');
  const search = quietTextField(input);
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
      window.element.style.transform = 'translate(-50%, -50%)';
      if (!dialog.open) return;
      const rect = window.element.getBoundingClientRect();
      const scale = plane.currentScale();
      anchor = { x: rect.left / scale, y: rect.top / scale };
    }
    // Keep the frame still when search or a second choice page changes its height.
    const clamp = (value: number, size: number, extent: number): number =>
      Math.max(16, Math.min(value, extent - size - 16));
    window.element.style.transform = 'none';
    window.place(
      clamp(anchor.x, window.element.offsetWidth, plane.element.clientWidth),
      clamp(anchor.y, window.element.offsetHeight, plane.element.clientHeight),
    );
  };
  let trigger: HTMLElement | null = null;
  // Focus rests on the rows, never on the search field unasked, so the browser offers no AutoFill;
  // typed text still reaches the search from the dialog.
  const focusFirstRow = (): void =>
    (list.querySelector<HTMLButtonElement>('button') ?? window.element).focus({ preventScroll: true });
  const typeIntoSearch = (event: KeyboardEvent): boolean => {
    if (!searchable || event.target === search || event.ctrlKey || event.metaKey || event.altKey)
      return false;
    if (event.key === 'Backspace') search.value = search.value.slice(0, -1);
    else if ([...event.key].length === 1 && event.key !== ' ') search.value += event.key;
    else return false;
    list.scrollTop = 0;
    render();
    return true;
  };
  const render = (): void => {
    const focusKey =
      document.activeElement instanceof HTMLElement ? document.activeElement.dataset.choice : undefined;
    const resting = document.activeElement === window.element;
    const scroll = list.scrollTop;
    list.replaceChildren();
    let count = 0;
    const words = searchWords(search.value);
    // A row without a good keeps an empty icon slot beside rows that show one, so the labels line up.
    const pictured =
      opts.icons !== undefined && groups.some((group) => group.rows.some((row) => rowGoods(row).length > 0));
    const iconCount = Math.max(
      1,
      ...groups.flatMap((group) => group.rows.map((row) => rowGoods(row).length)),
    );
    for (const group of groups) {
      const rows = group.rows.filter((row) => hasWords(row.label, words));
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
        if (pictured) {
          const art = document.createElement('span');
          art.className = 'on-choice-row__goods';
          art.style.width = `${ROW_ICON_PX + (iconCount - 1) * 11}px`;
          const goods = rowGoods(row);
          art.innerHTML = Array.from({ length: Math.max(1, goods.length) }, () =>
            goodIconMarkup(ROW_ICON_PX),
          ).join('');
          button.append(art);
          for (const [index, frame] of art.querySelectorAll<HTMLElement>('.on-good__frame').entries()) {
            const good = goods[index];
            if (good !== undefined) opts.icons?.(frame, good, ROW_ICON_PX);
          }
        }
        const label = document.createElement('span');
        label.className = 'on-choice-row__label';
        label.textContent = row.label;
        button.append(label);
        if (row.detail !== undefined) {
          const detail = document.createElement('span');
          detail.className = 'on-choice-row__detail';
          detail.textContent = row.detail;
          button.append(detail);
        }
        if (row.tooltip !== undefined) button.title = row.tooltip;
        if (row.reason !== undefined) {
          button.title = row.reason;
          button.setAttribute('aria-label', `${row.label}: ${row.reason}`);
        }
        button.addEventListener('click', (event) => {
          if (row.reason !== undefined) return;
          opts.cue?.('confirm');
          opts.onPick(row.key, event);
        });
        grid.append(button);
      }
      section.append(heading, grid);
      list.append(section);
    }
    if (count === 0) {
      const empty = document.createElement('p');
      empty.className = 'on-choice-empty';
      empty.textContent = search.value.trim() ? copy.choiceNoMatches : (opts.emptyLabel ?? copy.choiceEmpty);
      list.append(empty);
    }
    const focused = [...list.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.dataset.choice === focusKey,
    );
    if (focusKey !== undefined)
      (focused ?? list.querySelector<HTMLButtonElement>('button') ?? window.element).focus({
        preventScroll: true,
      });
    else if (resting) focusFirstRow();
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
    if (typeIntoSearch(event)) {
      event.preventDefault();
      return;
    }
    if (opts.camera.key(event) || event.key !== 'Escape') return;
    event.preventDefault();
    if (search.value) {
      search.value = '';
      render();
    } else dismiss();
  });
  const backdrop: readonly HTMLElement[] = [dialog, plane.element];
  dismissOnBackdropClick(backdrop, dismiss);
  const onBackdrop = (event: Event): boolean => backdrop.some((surface) => surface === event.target);
  dialog.addEventListener('mousedown', (event) => {
    if (onBackdrop(event)) opts.camera.press(event);
  });
  dialog.addEventListener(
    'wheel',
    (event) => {
      if (onBackdrop(event)) opts.camera.wheel(event);
    },
    { passive: false },
  );
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
    show(label = opts.title, options: { search?: boolean } = {}): void {
      searchable = options.search ?? true;
      field.hidden = !searchable;
      if (!dialog.open) anchor = undefined;
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
      focusFirstRow();
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
