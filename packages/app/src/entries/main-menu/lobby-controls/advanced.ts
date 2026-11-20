import { dismissOnBackdropClick } from '../../../view/backdrop-dismiss.js';
import { node } from '../dom.js';

export interface AdvancedText {
  /** The entry button's name. */
  readonly label: string;
  readonly title: string;
  /** The entry's state while every advanced rule plays as the standard game does. */
  readonly standard: string;
  /** The entry's state while one differs. */
  readonly changed: string;
  readonly rulesGroup: string;
  readonly resourcesGroup: string;
  readonly worldGroup: string;
  readonly reset: string;
  readonly done: string;
  /** Done's label for a viewer who cannot change anything. */
  readonly close: string;
  /** Why a room guest only reads the window. */
  readonly hostOnly: string;
}

interface AdvancedGroup {
  readonly title: string;
  readonly rows: readonly HTMLElement[];
}

/** Where the window mounts: inside the screen that holds the entry, so it reads that screen's scale
 *  and palette. */
const WINDOW_HOSTS = ['.network-room', '.main-menu__screen'] as const;

let windowIds = 0;

/**
 * The advanced match rules behind one entry on the settings card: a modal window grouping rules most
 * games keep standard. A change applies at once, as on the card; Escape, a backdrop click and Done
 * close it. The entry names what differs from the standard game, so a room member sees it unopened.
 */
export function advancedSettings(options: {
  readonly text: AdvancedText;
  readonly groups: readonly AdvancedGroup[];
  /** Restore the standard game's rules, all in one change. */
  readonly reset: () => void;
}) {
  const { text } = options;
  const id = ++windowIds;
  const entry = node('button', 'main-menu__advanced-entry');
  entry.type = 'button';
  entry.setAttribute('aria-haspopup', 'dialog');
  const state = node('span', 'main-menu__advanced-entry-state');
  entry.append(node('span', 'main-menu__advanced-entry-name', text.label), state);
  const summary = node('p', 'main-menu__advanced-summary');
  summary.id = `lobby-advanced-summary-${id}`;
  entry.setAttribute('aria-describedby', summary.id);

  const shade = node('div', 'main-menu__dialog-shade');
  const box = node('div', 'main-menu__dialog main-menu__advanced');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const title = node('h2', 'main-menu__dialog-title', text.title);
  title.id = `lobby-advanced-${id}`;
  box.setAttribute('aria-labelledby', title.id);
  const note = node('p', 'main-menu__advanced-note');
  const groups = options.groups.map((group) => {
    const section = node('section', 'main-menu__advanced-group');
    section.append(node('h3', 'main-menu__advanced-group-title', group.title), ...group.rows);
    return section;
  });
  const reset = node('button', 'main-menu__ghost', text.reset);
  reset.type = 'button';
  reset.addEventListener('click', options.reset);
  const done = node('button', 'main-menu__ghost is-accent main-menu__advanced-done', text.done);
  done.type = 'button';
  done.addEventListener('click', () => close());
  const actions = node('div', 'main-menu__dialog-actions main-menu__advanced-actions');
  actions.append(reset, done);
  box.append(title, note, ...groups, actions);
  shade.append(box);
  dismissOnBackdropClick([shade], () => close());

  const focusable = (): HTMLButtonElement[] =>
    [...box.querySelectorAll<HTMLButtonElement>('button')].filter(
      (button) => !button.disabled && button.getClientRects().length > 0,
    );
  // Capture phase, so the screen's own keys stay behind the window. An open choice list keeps its
  // other keys, and Escape there closes only the list.
  const onKey = (event: KeyboardEvent): void => {
    if (!shade.isConnected) {
      detach();
      return;
    }
    const list = event.target instanceof Element ? event.target.closest<HTMLElement>('[popover]') : null;
    if (event.key === 'Escape' && list === null) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      // Tab leaves an open list as it leaves its closed field, so it steps on from that field: the
      // button the dropdown lays beside its list.
      list?.hidePopover();
      const all = focusable();
      const active =
        list === null ? document.activeElement : all.find((b) => b.parentElement?.contains(list) === true);
      const at = active instanceof HTMLButtonElement ? all.indexOf(active) : -1;
      const next = event.shiftKey ? (at <= 0 ? all.length - 1 : at - 1) : (at + 1) % all.length;
      event.preventDefault();
      event.stopPropagation();
      all[next]?.focus();
    }
  };
  const detach = (): void => {
    document.removeEventListener('keydown', onKey, true);
  };
  function open(): void {
    if (shade.isConnected) return;
    const host = WINDOW_HOSTS.map((selector) => entry.closest<HTMLElement>(selector)).find((h) => h !== null);
    (host ?? document.body).append(shade);
    document.addEventListener('keydown', onKey, true);
    (focusable().find((button) => button !== reset) ?? done).focus();
  }
  function close(): void {
    if (!shade.isConnected) return;
    detach();
    shade.remove();
    if (entry.isConnected) entry.focus();
  }
  entry.addEventListener('click', open);

  return {
    elements: [entry, summary],
    /** `changes` are what differs from the standard game; `why` says, while `frozen`, why they cannot
     *  be changed. `resettable` is false while the reset has none of them to restore. */
    update(changes: readonly string[], frozen: boolean, why: string, resettable = changes.length > 0): void {
      const changed = changes.length > 0;
      // A reset that leaves nothing to reset, or a lost right to change, takes the button away from
      // under the focus; Done keeps it inside the window.
      if (document.activeElement === reset && (frozen || !resettable)) done.focus();
      state.textContent = changed ? text.changed : text.standard;
      entry.classList.toggle('is-changed', changed);
      summary.textContent = changes.join(' · ');
      summary.hidden = !changed;
      note.textContent = why;
      note.hidden = !frozen || why === '';
      // A viewer who cannot change anything reads each rule's choice as text, not a dimmed control.
      box.classList.toggle('is-readonly', frozen);
      done.textContent = frozen ? text.close : text.done;
      reset.hidden = frozen;
      reset.disabled = !resettable;
    },
    dispose(): void {
      detach();
      shade.remove();
    },
  };
}
