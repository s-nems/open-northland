import { CIVILIZATION_TRIBES } from '@open-northland/data';
import {
  type CivilizationRow,
  liveCivilizationTribes,
  loadCivilizations,
} from '../../../content/civilizations.js';
import { formatMessage, messages, tribeName } from '../../../i18n/index.js';
import { node } from '../dom.js';
import { tribeEmblem } from './tribe-emblems.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STAR_PATH = 'M12 2l2.9 6.9 7.1.6-5.4 4.7 1.6 7-6.2-3.8-6.2 3.8 1.6-7L2 9.5l7.1-.6z';
/** The civilizations a build offers without content: the authored five, until the IR names more. */
const DEFAULT_TRIBES: readonly CivilizationRow[] = CIVILIZATION_TRIBES.map((typeId) => ({ typeId }));
/** Gap in CSS pixels between the button and its opened list, and between the list and the viewport edge. */
const MENU_GAP_PX = 4;
/** The thumbnail's class on the button and in every list entry. */
const EMBLEM_CLASS = 'lobby-tribe__emblem';

/** The map's own civilization's mark; the note beside it says what it means. */
function star(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('lobby-tribe__star');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', STAR_PATH);
  svg.append(path);
  return svg;
}

/** A list entry's name, over a small starred line on the map's own civilization. */
function caption(tribe: number, authored: number): HTMLElement {
  const root = node('span', 'lobby-tribe__caption');
  root.append(node('span', 'lobby-tribe__name', tribeName(tribe)));
  if (tribe === authored) {
    const note = node('span', 'lobby-tribe__note');
    note.append(star(), messages().mainMenu.lobby.tribeMapDefault);
    root.append(note);
  }
  return root;
}

/**
 * A seat's civilization picker, shared by the local lobby and a network room: the chosen
 * civilization's icon, opening a named list of all of them with the map's own starred.
 */
export function tribePicker(authored: number, change: (tribe: number) => void, className = '') {
  const copy = messages().mainMenu.lobby;
  const root = node('div', `lobby-tribe ${className}`.trim());
  const label = node('span', 'lobby-tribe__label', copy.tribe);
  const button = node('button', 'lobby-tribe__button');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  let current = authored;
  let buttonEmblem = tribeEmblem(authored, EMBLEM_CLASS);
  button.append(buttonEmblem);

  const menu = node('div', 'lobby-tribe__menu');
  menu.popover = 'auto';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', copy.tribe);
  // The button invokes the list natively, so a second click closes it instead of light-dismissing
  // and reopening it.
  button.popoverTargetElement = menu;
  let options: { tribe: number; option: HTMLElement }[] = [];
  /** Rebuilds the list's entries over `rows`, keeping the open popover's focus behaviour intact. */
  const renderOptions = (rows: readonly CivilizationRow[]): void => {
    menu.replaceChildren();
    options = rows.map((row) => {
      const option = node('button', 'lobby-tribe__option');
      option.type = 'button';
      option.setAttribute('role', 'option');
      option.append(tribeEmblem(row.typeId, EMBLEM_CLASS), caption(row.typeId, authored));
      option.addEventListener('click', () => {
        menu.hidePopover();
        if (row.typeId !== current) change(row.typeId);
      });
      menu.append(option);
      return { tribe: row.typeId, option };
    });
    for (const { tribe, option } of options) {
      const selected = tribe === current;
      option.classList.toggle('is-current', selected);
      option.setAttribute('aria-selected', String(selected));
    }
  };
  renderOptions(DEFAULT_TRIBES);
  // A content pack's own people joins the list once the served IR has answered.
  void loadCivilizations().then((rows) => {
    if (rows.length > DEFAULT_TRIBES.length) renderOptions(rows);
  });
  root.append(label, button, menu);

  const place = (): void => {
    const anchor = button.getBoundingClientRect();
    const below = window.innerHeight - anchor.bottom;
    const height = menu.offsetHeight;
    const top =
      below >= height + MENU_GAP_PX || below >= anchor.top
        ? anchor.bottom + MENU_GAP_PX
        : anchor.top - MENU_GAP_PX - height;
    const left = Math.min(anchor.left, window.innerWidth - menu.offsetWidth - MENU_GAP_PX);
    menu.style.top = `${Math.max(MENU_GAP_PX, top)}px`;
    menu.style.left = `${Math.max(MENU_GAP_PX, left)}px`;
  };
  // Esc anywhere closes the open list before the menu reads it as back-navigation, even with focus
  // outside the picker (a click on the list's padding, a Tab past its last entry).
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    event.preventDefault();
    menu.hidePopover();
    button.focus();
  };
  menu.addEventListener('beforetoggle', (event) => {
    // The next frame runs once the opened list has a size, and before it is first painted.
    if (event.newState === 'open') requestAnimationFrame(place);
  });
  menu.addEventListener('toggle', (event) => {
    const open = event.newState === 'open';
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      window.addEventListener('keydown', onKeydown, true);
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
      options.find(({ tribe }) => tribe === current)?.option.focus();
    } else {
      window.removeEventListener('keydown', onKeydown, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    }
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const at = options.findIndex(({ option }) => option === document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next =
      at === -1 ? (step > 0 ? 0 : options.length - 1) : (at + step + options.length) % options.length;
    options[next]?.option.focus();
  });

  return {
    root,
    button,
    update(chosen: number, disabled: boolean): void {
      // The world plays the map's own tribe for any other value a relay passes on.
      const tribe = liveCivilizationTribes().includes(chosen) ? chosen : authored;
      if (tribe !== current) {
        const next = tribeEmblem(tribe, EMBLEM_CLASS);
        buttonEmblem.replaceWith(next);
        buttonEmblem = next;
      }
      current = tribe;
      const name = tribeName(tribe);
      button.setAttribute('aria-label', `${copy.tribe}: ${name}`);
      button.title = `${
        tribe === authored
          ? `${name} (${copy.tribeMapDefault})`
          : `${name}. ${formatMessage(copy.tribeMapChoice, { tribe: tribeName(authored) })}.`
      }\n${copy.tribeTitle}`;
      button.disabled = disabled;
      if (disabled && menu.matches(':popover-open')) menu.hidePopover();
      for (const { tribe: entry, option } of options) {
        const selected = entry === tribe;
        option.classList.toggle('is-current', selected);
        option.setAttribute('aria-selected', String(selected));
      }
    },
  };
}
