import { CIVILIZATION_TRIBES, isCivilizationTribe } from '@open-northland/data';
import { formatMessage, messages, tribeName } from '../../../i18n/index.js';
import { node } from '../dom.js';
import { loadTribeEmblems } from './tribe-emblems.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STAR_PATH = 'M12 2l2.9 6.9 7.1.6-5.4 4.7 1.6 7-6.2-3.8-6.2 3.8 1.6-7L2 9.5l7.1-.6z';
/** Gap in CSS pixels between the button and its opened list. */
const MENU_GAP_PX = 4;

/** The recommended civilization's mark; its tooltip and accessible name say what it means. */
function star(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('role', 'img');
  svg.classList.add('lobby-tribe__star');
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = messages().mainMenu.lobby.tribeRecommended;
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', STAR_PATH);
  svg.append(title, path);
  return svg;
}

/** The civilization's headquarters thumbnail; its initial stands in until the content draws it. */
function emblem(tribe: number): HTMLElement {
  const box = node('span', 'lobby-tribe__emblem', tribeName(tribe).slice(0, 1));
  box.dataset.tribe = String(tribe);
  void loadTribeEmblems().then((urls) => {
    const url = urls.get(tribe);
    if (url === undefined) return;
    const image = node('img');
    image.src = url;
    image.alt = '';
    box.replaceChildren(image);
    box.classList.add('has-image');
  });
  return box;
}

/** The civilization's name, starred when it is the map's own. */
function caption(): { root: HTMLElement; set(tribe: number, authored: number): void } {
  const root = node('span', 'lobby-tribe__caption');
  const name = node('span', 'lobby-tribe__name');
  root.append(name);
  return {
    root,
    set(tribe, authored) {
      name.textContent = tribeName(tribe);
      root.replaceChildren(name, ...(tribe === authored ? [star()] : []));
    },
  };
}

/**
 * A seat's civilization picker, shared by the local lobby and a network room: a button showing the
 * chosen civilization, opening a list of all of them. The map's own is starred as recommended.
 */
export function tribePicker(authored: number, change: (tribe: number) => void, className = '') {
  const copy = messages().mainMenu.lobby;
  const root = node('div', `lobby-tribe ${className}`.trim());
  const label = node('span', 'lobby-tribe__label', copy.tribe);
  const button = node('button', 'lobby-tribe__button');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  const shown = caption();
  const caret = node('span', 'lobby-tribe__caret');
  caret.setAttribute('aria-hidden', 'true');
  let current = authored;
  let buttonEmblem = emblem(authored);
  button.append(buttonEmblem, shown.root, caret);

  const menu = node('div', 'lobby-tribe__menu');
  menu.popover = 'auto';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', copy.tribe);
  const options = CIVILIZATION_TRIBES.map((tribe) => {
    const option = node('button', 'lobby-tribe__option');
    option.type = 'button';
    option.setAttribute('role', 'option');
    option.dataset.tribe = String(tribe);
    const text = caption();
    text.set(tribe, authored);
    option.append(emblem(tribe), text.root);
    option.addEventListener('click', () => {
      menu.hidePopover();
      if (tribe !== current) change(tribe);
    });
    menu.append(option);
    return option;
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
    menu.style.top = `${Math.max(MENU_GAP_PX, top)}px`;
    menu.style.left = `${anchor.left}px`;
    menu.style.minWidth = `${anchor.width}px`;
  };
  button.addEventListener('click', () => menu.togglePopover());
  menu.addEventListener('toggle', (event) => {
    const open = (event as ToggleEvent).newState === 'open';
    button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    place();
    options.find((option) => option.classList.contains('is-current'))?.focus();
  });
  // Esc closes the list here, before the menu reads it as back-navigation.
  root.addEventListener('keydown', (event) => {
    if (!menu.matches(':popover-open')) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      menu.hidePopover();
      button.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const at = options.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    options[(at + step + options.length) % options.length]?.focus();
  });

  return {
    root,
    button,
    update(chosen: number, disabled: boolean): void {
      // The world plays the map's own tribe for any other value a relay passes on.
      const tribe = isCivilizationTribe(chosen) ? chosen : authored;
      if (tribe !== current) {
        const next = emblem(tribe);
        buttonEmblem.replaceWith(next);
        buttonEmblem = next;
      }
      current = tribe;
      shown.set(tribe, authored);
      const offMap = tribe !== authored;
      root.classList.toggle('is-off-map', offMap);
      // Another pick names the map's own only in the tooltip, so the row stays one line.
      button.title = offMap
        ? `${formatMessage(copy.tribeMapChoice, { tribe: tribeName(authored) })}. ${copy.tribeTitle}`
        : copy.tribeTitle;
      button.disabled = disabled;
      if (disabled && menu.matches(':popover-open')) menu.hidePopover();
      for (const option of options) {
        const selected = option.dataset.tribe === String(tribe);
        option.classList.toggle('is-current', selected);
        option.setAttribute('aria-selected', String(selected));
      }
    },
  };
}
