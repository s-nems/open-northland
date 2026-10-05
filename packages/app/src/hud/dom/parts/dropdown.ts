import { FIELD_KEYS_ATTRIBUTE } from '../../hotkeys.js';

export interface DropdownChoice<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly image?: string;
  readonly disabled?: boolean;
}

/** Choices listed under a heading, as an `<optgroup>` lists them. */
export interface DropdownGroup<T extends string> {
  readonly group: string;
  readonly choices: readonly DropdownChoice<T>[];
}

export type DropdownEntry<T extends string> = DropdownChoice<T> | DropdownGroup<T>;

export interface DropdownOptions<T extends string> {
  /** The accessible name of the button and the list. */
  readonly label: string;
  /** The skin's class: the parts take it with `-btn`, `-list`, `-option`, `-group`, `-group-label`. */
  readonly className: string;
  readonly entries: readonly DropdownEntry<T>[];
  readonly active: T;
  /** The player picked a choice; the caller shows it with `setActive` once it holds. */
  readonly onPick: (id: T) => void;
}

export interface DropdownHandle<T extends string> {
  /** The field the list opens under; a caller may put a caption in it before the button. */
  readonly root: HTMLDivElement;
  readonly button: HTMLButtonElement;
  setActive(id: T): void;
  setEntries(entries: readonly DropdownEntry<T>[]): void;
  setDisabled(disabled: boolean): void;
}

/** Viewport px between the field and its list, and the list and the window edge. */
const LIST_GAP_PX = 4;
/** A pause in typing this long starts a new type-ahead search, as a native select does. */
const TYPE_AHEAD_RESET_MS = 700;

const isGroup = <T extends string>(entry: DropdownEntry<T>): entry is DropdownGroup<T> => 'group' in entry;

function face(choice: DropdownChoice<string>, className: string): HTMLElement[] {
  const text = document.createElement('span');
  text.className = `${className}-label`;
  text.textContent = choice.label;
  if (choice.image === undefined) return [text];
  // A background, so a caller's stylesheet can frame the part of the art that tells choices apart.
  const image = document.createElement('span');
  image.className = `${className}-image`;
  image.style.backgroundImage = `url("${choice.image}")`;
  return [image, text];
}

/**
 * One button showing the current choice over a list drawn by the page, so every browser shows the
 * same list where a native `<select>` would show the platform's own. The list is a popover in the
 * top layer: no scrolling or clipping ancestor cuts it, and it takes the field's on-screen scale.
 */
export function dropdownControl<T extends string>(options: DropdownOptions<T>): DropdownHandle<T> {
  const { className } = options;
  const root = document.createElement('div');
  root.className = className;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${className}-btn`;
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', options.label);
  const list = document.createElement('div');
  list.className = `${className}-list`;
  // Opened and closed here rather than by the button's native invoker, which WebKit does not run.
  list.popover = 'manual';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', options.label);
  list.setAttribute(FIELD_KEYS_ATTRIBUTE, '');
  root.append(button, list);

  let entries = options.entries;
  let current = options.active;
  const rows = new Map<T, HTMLButtonElement>();
  const choiceOf = (id: T): DropdownChoice<T> | undefined =>
    entries.flatMap((entry) => (isGroup(entry) ? entry.choices : [entry])).find((choice) => choice.id === id);
  const enabledRows = (): HTMLButtonElement[] => [...rows.values()].filter((row) => !row.disabled);
  const focusedIndex = (all: readonly HTMLButtonElement[]): number => {
    const focused = document.activeElement;
    return focused instanceof HTMLButtonElement ? all.indexOf(focused) : -1;
  };
  const isOpen = (): boolean => list.matches(':popover-open');
  const close = (): void => {
    if (isOpen()) list.hidePopover();
  };
  const open = (): void => {
    if (!isOpen() && !button.disabled) list.showPopover();
  };
  button.addEventListener('click', () => (isOpen() ? close() : open()));
  const onPressOutside = (event: PointerEvent): void => {
    if (!(event.target instanceof Node && root.contains(event.target))) close();
  };

  const row = (choice: DropdownChoice<T>): HTMLButtonElement => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `${className}-option`;
    option.setAttribute('role', 'option');
    option.disabled = choice.disabled === true;
    option.append(...face(choice, `${className}-option`));
    option.addEventListener('click', () => {
      close();
      button.focus({ preventScroll: true });
      if (choice.id !== current) options.onPick(choice.id);
    });
    rows.set(choice.id, option);
    return option;
  };
  // The choices and headings in order; entries with the same shape only relabel the rows they have.
  const shapeOf = (of: readonly DropdownEntry<T>[]): string =>
    JSON.stringify(
      of.map((entry) => (isGroup(entry) ? [entry.group, entry.choices.map((c) => c.id)] : entry.id)),
    );
  let shape = '';
  const relabel = (): void => {
    for (const entry of entries) {
      for (const choice of isGroup(entry) ? entry.choices : [entry]) {
        const option = rows.get(choice.id);
        if (option === undefined) continue;
        option.disabled = choice.disabled === true;
        const text = option.querySelector(`.${className}-option-label`);
        if (text !== null && text.textContent !== choice.label) text.textContent = choice.label;
      }
    }
  };
  // A count that changes while the player browses relabels the rows in place, so a press on one is
  // not lost to a rebuild. A rebuild under the open list keeps the focused choice and the scroll.
  const setEntries = (next: readonly DropdownEntry<T>[]): void => {
    entries = next;
    const nextShape = shapeOf(next);
    if (nextShape === shape) {
      relabel();
      setActive(current);
      return;
    }
    shape = nextShape;
    const focused = [...rows].find(([, option]) => option === document.activeElement)?.[0];
    const scrolled = list.scrollTop;
    rows.clear();
    list.replaceChildren(
      ...next.map((entry) => {
        if (!isGroup(entry)) return row(entry);
        const group = document.createElement('div');
        group.className = `${className}-group`;
        group.setAttribute('role', 'group');
        const heading = document.createElement('div');
        heading.className = `${className}-group-label`;
        heading.textContent = entry.group;
        group.setAttribute('aria-label', entry.group);
        group.append(heading, ...entry.choices.map(row));
        return group;
      }),
    );
    setActive(current);
    if (!isOpen()) return;
    place();
    list.scrollTop = scrolled;
    if (focused !== undefined) (rows.get(focused) ?? rows.get(current))?.focus({ preventScroll: true });
  };
  // Callers re-assert the value every tick, so the button's face changes only with what it shows: a
  // replaced node under a held press would cost the player that click.
  let shownFace: DropdownChoice<T> | undefined;
  const setActive = (id: T): void => {
    current = id;
    const choice = choiceOf(id);
    const text = button.querySelector(`.${className}-btn-label`);
    if (
      choice !== undefined &&
      shownFace !== undefined &&
      choice.image === shownFace.image &&
      text !== null
    ) {
      if (text.textContent !== choice.label) text.textContent = choice.label;
    } else if (choice !== shownFace) {
      button.replaceChildren(...(choice === undefined ? [] : face(choice, `${className}-btn`)));
    }
    shownFace = choice;
    for (const [key, option] of rows) {
      const selected = String(key === id);
      if (option.getAttribute('aria-selected') !== selected) option.setAttribute('aria-selected', selected);
    }
  };

  // Placed in viewport px under the field, or above it when more room is there. A scaled ancestor
  // (the HUD root) leaves the top layer unscaled, so the list takes the field's scale itself.
  const place = (): void => {
    const anchor = root.getBoundingClientRect();
    const scale = root.offsetWidth > 0 ? anchor.width / root.offsetWidth : 1;
    list.style.transformOrigin = 'top left';
    list.style.transform = scale === 1 ? '' : `scale(${scale})`;
    list.style.minWidth = `${root.offsetWidth}px`;
    list.style.maxHeight = '';
    const below = window.innerHeight - anchor.bottom - 2 * LIST_GAP_PX;
    const above = anchor.top - 2 * LIST_GAP_PX;
    const downward = list.offsetHeight * scale <= below || below >= above;
    list.style.maxHeight = `${Math.min(list.offsetHeight, (downward ? below : above) / scale)}px`;
    const height = list.offsetHeight * scale;
    const top = downward ? anchor.bottom + LIST_GAP_PX : anchor.top - LIST_GAP_PX - height;
    const left = Math.min(anchor.left, window.innerWidth - list.offsetWidth * scale - LIST_GAP_PX);
    list.style.top = `${Math.max(LIST_GAP_PX, top)}px`;
    list.style.left = `${Math.max(LIST_GAP_PX, left)}px`;
  };
  const focusRow = (next: HTMLButtonElement | undefined): void => {
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ block: 'nearest' });
  };
  // The list's own scroll leaves it where it is; re-placing would reset that scroll.
  const onScroll = (event: Event): void => {
    if (event.target !== list) place();
  };
  let watchField: ResizeObserver | null = null;
  const stopWatching = (): void => {
    button.setAttribute('aria-expanded', 'false');
    watchField?.disconnect();
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', place);
    document.removeEventListener('pointerdown', onPressOutside, true);
  };
  // A hidden or removed field (its window closed under the open list) takes the list with it. A
  // removed one has already hidden its list without a toggle event, so this stops watching itself.
  const onFieldResize = (): void => {
    if (root.isConnected && root.offsetWidth > 0) {
      place();
      return;
    }
    close();
    stopWatching();
  };
  list.addEventListener('beforetoggle', (event) => {
    if (event.newState !== 'open') return;
    // The next frame runs once the opened list has a size, and before it is first painted.
    requestAnimationFrame(() => {
      place();
      const chosen = rows.get(current);
      focusRow(chosen !== undefined && !chosen.disabled ? chosen : enabledRows()[0]);
    });
  });
  list.addEventListener('toggle', (event) => {
    if (event.newState !== 'open') {
      stopWatching();
      return;
    }
    button.setAttribute('aria-expanded', 'true');
    watchField ??= new ResizeObserver(onFieldResize);
    watchField.observe(root);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', onPressOutside, true);
  });
  let typed = '';
  let typedAt = Number.NEGATIVE_INFINITY;
  const searching = (event: KeyboardEvent): boolean => event.timeStamp - typedAt <= TYPE_AHEAD_RESET_MS;
  const typeAhead = (event: KeyboardEvent): void => {
    typed = searching(event) ? typed + event.key : event.key;
    typedAt = event.timeStamp;
    const needle = typed.toLocaleLowerCase();
    const all = enabledRows();
    const from = focusedIndex(all);
    // A repeated first letter steps on through the choices that start with it.
    const ordered = typed.length === 1 ? [...all.slice(from + 1), ...all.slice(0, from + 1)] : all;
    focusRow(ordered.find((option) => option.textContent?.toLocaleLowerCase().startsWith(needle)));
  };
  // The open list keeps its keys from the game (`FIELD_KEYS_ATTRIBUTE`); here it moves and types.
  list.addEventListener('keydown', (event) => {
    const all = enabledRows();
    const at = focusedIndex(all);
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      close();
      button.focus({ preventScroll: true });
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      focusRow(all[at === -1 ? 0 : Math.min(all.length - 1, Math.max(0, at + step))]);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusRow(event.key === 'Home' ? all[0] : all.at(-1));
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Space picks the focused choice, unless it continues a name being typed.
      if (event.key === ' ' && !searching(event)) return;
      event.preventDefault();
      typeAhead(event);
    } else return;
    event.stopPropagation();
  });
  // A closed field opens on an arrow key, as a native select does.
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    event.stopPropagation();
    open();
  });

  setEntries(entries);
  return {
    root,
    button,
    setActive,
    setEntries,
    setDisabled(disabled: boolean): void {
      button.disabled = disabled;
      if (disabled) close();
    },
  };
}
