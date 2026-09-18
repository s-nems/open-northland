import type { UiCue } from '@open-northland/audio';
import type { HudModel } from '@open-northland/render';
import { formatMessage, messages } from '../../i18n/index.js';
import { centralWindowFloor, centralWindowOrigin } from '../regions.js';
import {
  BUILDING_CATEGORIES,
  type BuildingCategory,
  type CatalogueView,
  type ConstructionWindowState,
  INITIAL_CONSTRUCTION_STATE,
  type MenuBuildingEntry,
} from '../tool-panel/building-menu.js';
import {
  availabilityKey,
  type CatalogueRow,
  costSlots,
  partitionCatalogue,
  tabCounts,
} from '../tool-panel/construction-catalog.js';
import type { ToolWindow } from '../tool-panel/window-shell.js';
import type { BuildingThumbs } from './building-thumb.js';
import { goodIconMarkup, goodIconSource, goodIconStyle } from './good-art.js';
import { GLYPH, paintedIcon } from './icons.js';
import { createHudWindow } from './window.js';

/** Design px (FOUNDATION.md): the central window width, the head's painted icon, a card's picture box
 *  and a cost slot's icon box. */
const CONSTRUCTION_WINDOW_W = 540;
const TITLE_ART_PX = 43;
const THUMB_BOX_PX = 72;
const COST_ICON_BOX_PX = 16;
const VIEWS: readonly CatalogueView[] = ['grid', 'list'];
const VIEW_GLYPH: Readonly<Record<CatalogueView, string>> = {
  grid: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>',
  list: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 6h3M10 6h10M4 12h3M10 12h10M4 18h3M10 18h10"/></svg>',
};
const ROAD_GLYPH =
  '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 20 9 4h6l5 16M12 6v3M12 12v3M12 18v2"/></svg>';
const WALL_GLYPH =
  '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M3 20V9l3-4 3 4v11M9 12h12v8H9M12 12v-2h3v2M17 12v-2h3v2"/></svg>';
const PAPERS_GLYPH =
  '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6"/></svg>';

export interface ConstructionWindowDeps {
  readonly plane: HTMLElement;
  readonly entries: readonly MenuBuildingEntry[];
  readonly thumbs: BuildingThumbs;
  /** A cost line's good by content type id; `undefined` skips its icon. */
  readonly goodIdOf: (goodType: number) => string | undefined;
  readonly goodLabel: (goodType: number) => string;
  /** How many papers on hand a pick could spend, for the Papiery button's count. */
  readonly papersCount: () => number;
  readonly onPick: (typeId: number) => void;
  /** The Papiery button: the papers list, which stays the chest window's tab until its own ticket. */
  readonly onPapers: () => void;
  /** A card's "?": the building's Knowledge page; the pending note until the knowledge ticket. */
  readonly onHelp: (typeId: number) => void;
  readonly cue: (cue: UiCue) => void;
}

/** The construction window on the DOM plane (FOUNDATION.md, "Construction window"): the quick row,
 *  the category tabs with the grid or list toggle, and the parchment catalogue of permit-like cards
 *  with the locked entries at the end. A pick hides the window for the placement and Esc brings it
 *  back as it was. It takes part in the window registry like a legacy pop-up, but the plane routes its
 *  own pointer input, so it claims no canvas point. */
export interface ConstructionWindow extends ToolWindow {
  /** Re-place an open window against the plane's design-px size; call once per frame. */
  place(): void;
  /** Per-frame while open: re-sort the cards on an availability change, refresh the papers count. */
  refresh(): void;
  /** The tick's stocks mark the cost lines the seat cannot cover; the same model twice costs nothing. */
  update(model: HudModel): void;
  /** Hide for a placement without closing the window's state; `resume` brings it back. */
  suspend(): void;
  /** A placement was called off: show the window again as it was, the picked card focused. */
  resume(): void;
  state(): ConstructionWindowState;
  restore(state: ConstructionWindowState): void;
  /** The close medallion was pressed; the owner returns focus to the beam. */
  onDismiss(listener: () => void): void;
  dispose(): void;
}

interface Card {
  readonly row: CatalogueRow;
  readonly element: HTMLElement;
  readonly pick: HTMLButtonElement;
  readonly reason: HTMLElement;
  readonly slots: readonly { readonly element: HTMLElement; readonly goodType: number; shown: string }[];
}

function button(className: string, html: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.innerHTML = html;
  return element;
}

/** A cost slot: the good's icon on a small parchment square with the amount as a corner badge. */
export function costSlotMarkup(amount: number): string {
  return `<i class="on-cost__slot">${goodIconMarkup(COST_ICON_BOX_PX)}<b>${amount}</b></i>`;
}

/** A card's inner markup, shared with the gallery board: the name, the reason and the help label are
 *  text the owner sets afterwards. `thumb` is the picture box's content. */
export function buildingCardMarkup(cost: readonly number[], thumb: string, locked = false): string {
  const slots = cost.map((amount) => costSlotMarkup(amount)).join('');
  return `<button type="button" class="on-bcard__pick"${locked ? ' disabled' : ' aria-pressed="false"'}><span class="on-bcard__thumb">${thumb}</span><span class="on-bcard__body"><strong class="on-bcard__title"></strong><small class="on-bcard__reason" hidden></small><span class="on-cost">${slots}</span></span></button><button type="button" class="on-medallion on-bcard__help">?</button>`;
}

export function createConstructionWindow(deps: ConstructionWindowDeps): ConstructionWindow {
  const copy = messages().hud.construction;
  const shellCopy = messages().hud.shell;
  const categoryCopy = messages().hud.categories;
  const window = createHudWindow(deps.plane, {
    title: copy.title,
    art: paintedIcon('build', TITLE_ART_PX),
    closeLabel: shellCopy.close,
    width: CONSTRUCTION_WINDOW_W,
  });
  window.element.classList.add('on-window--construction');
  window.body.classList.add('on-window__body--column');
  let disposed = false;
  let state: ConstructionWindowState = INITIAL_CONSTRUCTION_STATE;

  // The quick row: the road, palisade and gate the sim has no command for yet, and the papers.
  const quick = document.createElement('div');
  quick.className = 'on-toolrow';
  for (const [glyph, label] of [
    [ROAD_GLYPH, copy.road],
    [WALL_GLYPH, copy.palisade],
    [WALL_GLYPH, copy.gate],
  ] as const) {
    const control = button('on-button', `${glyph}<span></span>`);
    control.disabled = true;
    control.title = copy.notInThisVersion;
    const text = control.querySelector('span');
    if (text !== null) text.textContent = label;
    quick.append(control);
  }
  const papers = button(
    'on-button on-button--accent',
    `${PAPERS_GLYPH}<span></span><span class="on-count"></span>`,
  );
  papers.title = copy.papersHint;
  const papersLabel = papers.querySelector('span');
  const papersCount = papers.querySelector('.on-count');
  if (papersLabel === null || !(papersCount instanceof HTMLElement))
    throw new Error('construction: papers button');
  papersLabel.textContent = copy.papers;
  let shownPapers = -1;
  papers.addEventListener('click', () => {
    deps.cue('confirm');
    deps.onPapers();
  });
  quick.append(papers);

  // The tabs, with the grid or list toggle at their right end.
  const tabs = document.createElement('div');
  tabs.className = 'on-tabs';
  tabs.setAttribute('role', 'tablist');
  const tabButtons = new Map<BuildingCategory, { button: HTMLButtonElement; count: HTMLElement }>();
  for (const tab of BUILDING_CATEGORIES) {
    const control = button('on-tab', `<span></span><span class="on-tab__count"></span>`);
    control.setAttribute('role', 'tab');
    control.setAttribute('aria-selected', 'false');
    const [label, count] = control.querySelectorAll('span');
    if (label === undefined || !(count instanceof HTMLElement)) throw new Error('construction: tab');
    label.textContent = categoryCopy[tab.id];
    control.addEventListener('click', () => {
      deps.cue('confirm');
      showCategory(tab.id);
    });
    tabButtons.set(tab.id, { button: control, count });
    tabs.append(control);
  }
  const viewToggle = document.createElement('fieldset');
  viewToggle.className = 'on-view';
  viewToggle.innerHTML = `<legend class="on-sr"></legend>`;
  const legend = viewToggle.querySelector('legend');
  if (legend !== null) legend.textContent = copy.viewLabel;
  const viewButtons = new Map<CatalogueView, HTMLButtonElement>();
  for (const view of VIEWS) {
    const control = button('on-view__button', VIEW_GLYPH[view]);
    control.setAttribute('aria-pressed', 'false');
    control.title = view === 'grid' ? copy.gridView : copy.listView;
    control.addEventListener('click', () => {
      deps.cue('confirm');
      showView(view);
    });
    viewButtons.set(view, control);
    viewToggle.append(control);
  }
  tabs.append(viewToggle);

  // The parchment: the open cards, the locked cards under their own note, or the empty note.
  const parchment = document.createElement('div');
  parchment.className = 'on-parchment on-catalog';
  const note = (text: string): { note: HTMLElement; count: HTMLElement } => {
    const element = document.createElement('p');
    element.className = 'on-parchment__note';
    element.innerHTML = `<span></span><span class="on-parchment__count"></span>`;
    const [label, count] = element.querySelectorAll('span');
    if (label === undefined || !(count instanceof HTMLElement)) throw new Error('construction: note');
    label.textContent = text;
    return { note: element, count };
  };
  const openNote = note(copy.availableNow);
  const openGrid = document.createElement('div');
  openGrid.className = 'on-build-grid';
  const lockedNote = note(copy.locked);
  lockedNote.note.classList.add('on-parchment__note--locked');
  lockedNote.count.textContent = '';
  const lockedGrid = document.createElement('div');
  lockedGrid.className = 'on-build-grid';
  const empty = document.createElement('div');
  empty.className = 'on-catalog__empty';
  empty.innerHTML = `<strong></strong><span></span>`;
  const [emptyTitle, emptyText] = empty.children;
  if (emptyTitle !== undefined) emptyTitle.textContent = copy.emptyTitle;
  if (emptyText !== undefined) emptyText.textContent = copy.emptyText;
  parchment.append(openNote.note, openGrid, lockedNote.note, lockedGrid, empty);
  // Kept live: a hidden element reads its scroll as 0, so the close cannot read it back.
  parchment.addEventListener('scroll', () => {
    state = { ...state, scrollTop: parchment.scrollTop };
  });
  window.body.append(quick, tabs, parchment);
  window.onDismiss(() => {
    state = { ...state, suspended: false };
  });

  // One card per entry, built once; a tick moves cards between the grids and marks their slots.
  const cards = new Map<number, Card>();
  const buildCard = (row: CatalogueRow): Card => {
    const { entry } = row;
    const element = document.createElement('article');
    element.className = 'on-bcard';
    element.dataset.category = row.category;
    element.innerHTML = buildingCardMarkup(
      entry.cost.map((line) => line.amount),
      '<canvas></canvas>',
    );
    const pick = element.querySelector('.on-bcard__pick');
    const title = element.querySelector('.on-bcard__title');
    const reason = element.querySelector('.on-bcard__reason');
    const thumb = element.querySelector('canvas');
    const help = element.querySelector('.on-bcard__help');
    if (
      !(pick instanceof HTMLButtonElement) ||
      title === null ||
      !(reason instanceof HTMLElement) ||
      thumb === null ||
      !(help instanceof HTMLButtonElement)
    ) {
      throw new Error('construction: card markup');
    }
    title.textContent = entry.label;
    if (!deps.thumbs.paint(thumb, entry.typeId, THUMB_BOX_PX)) thumb.outerHTML = GLYPH.house;
    help.setAttribute('aria-label', formatMessage(copy.help, { name: entry.label }));
    help.title = copy.helpHint;
    const slots = [...element.querySelectorAll('.on-cost__slot')].flatMap((slot, index) => {
      const line = entry.cost[index];
      if (!(slot instanceof HTMLElement) || line === undefined) return [];
      const frame = slot.querySelector('.on-good__frame');
      const goodId = deps.goodIdOf(line.goodType);
      if (frame instanceof HTMLElement && goodId !== undefined) {
        void goodIconSource(goodId).then((source) => {
          if (!disposed && source !== null) frame.style.cssText = goodIconStyle(source, COST_ICON_BOX_PX);
        });
      }
      return [{ element: slot, goodType: line.goodType, shown: '' }];
    });
    pick.addEventListener('click', () => {
      deps.cue('confirm');
      setPicked(entry.typeId);
      suspend();
      deps.onPick(entry.typeId);
    });
    help.addEventListener('click', () => {
      deps.cue('confirm');
      deps.onHelp(entry.typeId);
    });
    return { row, element, pick, reason, slots };
  };

  const setPicked = (typeId: number | null): void => {
    state = { ...state, picked: typeId };
    for (const [id, card] of cards) {
      if (!card.pick.disabled) card.pick.setAttribute('aria-pressed', String(id === typeId));
    }
  };

  // The category filter hides cards; a note goes with its grid when nothing of it is shown.
  const showCategory = (category: BuildingCategory): void => {
    state = { ...state, category };
    for (const [id, tab] of tabButtons) tab.button.setAttribute('aria-selected', String(id === category));
    const shownIn = (grid: HTMLElement): number => {
      let shown = 0;
      for (const card of grid.children) {
        if (!(card instanceof HTMLElement)) continue;
        card.hidden = category !== 'all' && card.dataset.category !== category;
        if (!card.hidden) shown += 1;
      }
      return shown;
    };
    const open = shownIn(openGrid);
    const locked = shownIn(lockedGrid);
    openNote.note.hidden = open === 0;
    openGrid.hidden = open === 0;
    lockedNote.note.hidden = locked === 0;
    lockedGrid.hidden = locked === 0;
    empty.hidden = cards.size > 0;
  };

  const showView = (view: CatalogueView): void => {
    state = { ...state, view };
    parchment.dataset.view = view;
    for (const [id, control] of viewButtons) control.setAttribute('aria-pressed', String(id === view));
  };

  // Availability: cards keep their order inside each grid; a discovery moves a card up into the open
  // grid, a script's ban drops it, and the tab counts follow.
  let shownAvailability = '';
  const layoutCards = (): boolean => {
    const partition = partitionCatalogue(deps.entries);
    const key = availabilityKey(partition);
    if (key === shownAvailability) return false;
    shownAvailability = key;
    const listed = new Set<number>();
    const place = (rows: readonly CatalogueRow[], grid: HTMLElement, locked: boolean): void => {
      for (const row of rows) {
        let card = cards.get(row.entry.typeId);
        if (card === undefined) {
          card = buildCard(row);
          cards.set(row.entry.typeId, card);
        }
        listed.add(row.entry.typeId);
        card.element.classList.toggle('on-bcard--locked', locked);
        card.pick.disabled = locked;
        if (locked) card.pick.removeAttribute('aria-pressed');
        else card.pick.setAttribute('aria-pressed', String(row.entry.typeId === state.picked));
        const reason = row.availability.kind === 'locked' ? row.availability.reason : '';
        card.reason.textContent = reason;
        card.reason.title = reason;
        card.reason.hidden = reason === '';
        grid.append(card.element);
      }
    };
    place(partition.open, openGrid, false);
    place(partition.locked, lockedGrid, true);
    for (const [id, card] of cards) {
      if (!listed.has(id)) {
        card.element.remove();
        cards.delete(id);
      }
    }
    const counts = tabCounts(partition.open);
    for (const [id, tab] of tabButtons) tab.count.textContent = String(counts[id]);
    openNote.count.textContent = String(partition.open.length);
    lockedNote.count.textContent = `${partition.locked.length} · ${copy.lockedHint}`;
    return true;
  };

  const refreshPapers = (): void => {
    const count = deps.papersCount();
    if (count === shownPapers) return;
    shownPapers = count;
    papersCount.textContent = String(count);
    papersCount.hidden = count === 0;
  };

  let shownModel: HudModel | null = null;
  const markStocks = (model: HudModel): void => {
    if (model === shownModel) return;
    shownModel = model;
    const stock = new Map(model.stocks.map((line) => [line.goodType, line.amount]));
    const stockOf = (goodType: number): number => stock.get(goodType) ?? 0;
    for (const card of cards.values()) {
      const slots = costSlots(card.row.entry.cost, stockOf);
      for (const [index, slot] of card.slots.entries()) {
        const line = slots[index];
        if (line === undefined) continue;
        const name = deps.goodLabel(line.goodType);
        const title = line.short
          ? formatMessage(copy.costShort, { name, have: line.have, amount: line.amount })
          : formatMessage(copy.costLine, { name, amount: line.amount });
        if (title === slot.shown) continue;
        slot.shown = title;
        slot.element.title = title;
        slot.element.classList.toggle('on-cost__slot--short', line.short);
      }
    }
  };

  let placed = '';
  const open = (): void => {
    layoutCards();
    showCategory(state.category);
    refreshPapers();
    if (shownModel !== null) {
      const model = shownModel;
      shownModel = null;
      markStocks(model);
    }
    window.open();
    parchment.scrollTop = state.scrollTop;
  };
  const close = (): void => {
    state = { ...state, suspended: false };
    window.close();
  };
  const suspend = (): void => {
    if (!window.isOpen()) return;
    state = { ...state, suspended: true };
    window.close();
  };
  const resume = (): void => {
    if (!state.suspended) return;
    state = { ...state, suspended: false };
    open();
    const picked = state.picked === null ? undefined : cards.get(state.picked);
    if (picked !== undefined && !picked.pick.disabled) picked.pick.focus();
  };
  showView(state.view);

  return {
    isOpen: window.isOpen,
    toggle: () => (window.isOpen() ? close() : open()),
    close,
    claims: () => false,
    handleClick: () => false,
    place: () => {
      if (!window.isOpen()) return;
      // The plane's client box is the design-px screen (foundation.css sizes it by 1 / scale).
      const size = { width: deps.plane.clientWidth, height: deps.plane.clientHeight };
      const origin = centralWindowOrigin(size, 1, CONSTRUCTION_WINDOW_W);
      const floor = centralWindowFloor(size, 1);
      const key = `${origin.x},${origin.y},${floor}`;
      if (key === placed) return;
      placed = key;
      window.place(origin.x, origin.y);
      window.element.style.maxHeight = `${Math.max(0, floor - origin.y)}px`;
    },
    refresh: () => {
      if (!window.isOpen()) return;
      if (layoutCards()) showCategory(state.category);
      refreshPapers();
    },
    update: (model) => {
      if (window.isOpen()) markStocks(model);
      else shownModel = model;
    },
    suspend,
    resume,
    state: () => state,
    restore: (next) => {
      state = next;
      showView(next.view);
      if (window.isOpen()) {
        layoutCards();
        showCategory(next.category);
        parchment.scrollTop = next.scrollTop;
      }
    },
    onDismiss: window.onDismiss,
    dispose: () => {
      disposed = true;
      window.dispose();
    },
  };
}
