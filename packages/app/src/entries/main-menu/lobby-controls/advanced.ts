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
  readonly worldGroup: string;
  readonly reset: string;
  readonly done: string;
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
  const entry = node('button', 'main-menu__advanced-entry');
  entry.type = 'button';
  entry.setAttribute('aria-haspopup', 'dialog');
  const state = node('span', 'main-menu__advanced-entry-state');
  entry.append(node('span', 'main-menu__advanced-entry-name', text.label), state);
  const summary = node('p', 'main-menu__advanced-summary');

  const shade = node('div', 'main-menu__dialog-shade');
  const box = node('div', 'main-menu__dialog main-menu__advanced');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const title = node('h2', 'main-menu__dialog-title', text.title);
  title.id = `lobby-advanced-${++windowIds}`;
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

  const focusable = (): HTMLElement[] =>
    [...box.querySelectorAll<HTMLButtonElement>('button')].filter(
      (button) => !button.disabled && button.getClientRects().length > 0,
    );
  // Capture phase, so the screen's own Escape stays behind the window; an open choice list keeps
  // its keys, and closing it leaves the window open.
  const onKey = (event: KeyboardEvent): void => {
    if (!shade.isConnected) {
      detach();
      return;
    }
    if (event.target instanceof Element && event.target.closest('[popover]') !== null) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      const all = focusable();
      const active = document.activeElement;
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
    /** `changes` are the rules that differ from the standard game; `why` says, while `frozen`, why
     *  they cannot be changed. */
    update(changes: readonly string[], frozen: boolean, why: string): void {
      const changed = changes.length > 0;
      state.textContent = changed ? text.changed : text.standard;
      entry.classList.toggle('is-changed', changed);
      summary.textContent = changes.join(' · ');
      summary.hidden = !changed;
      note.textContent = why;
      note.hidden = !frozen || why === '';
      reset.hidden = frozen;
      reset.disabled = !changed;
    },
    dispose(): void {
      detach();
      shade.remove();
    },
  };
}
