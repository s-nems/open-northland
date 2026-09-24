import type { UiCue } from '@open-northland/audio';
import type { HudModel } from '@open-northland/render';
import type { Paper } from '@open-northland/sim';
import { formatMessage, messages } from '../../i18n/index.js';
import type { PresentationPack } from '../../presentation/pack.js';
import {
  BUILDING_CATEGORIES,
  type BuildingCategory,
  type CatalogueView,
  CONSTRUCTION_TOOLS,
  type ConstructionPage,
  type ConstructionTool,
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
import { type PaperCard, paperCards, paperCardsKey, plansCount } from '../tool-panel/paper-cards.js';
import type { ToolWindow } from '../tool-panel/window-shell.js';
import type { BuildingThumbs } from './building-thumb.js';
import { goodIconMarkup, goodIconSource, goodIconStyle } from './good-art.js';
import { GLYPH, paintedIcon } from './icons.js';
import { centralWindowPlacer, createHudWindow } from './window.js';

/** Design px (FOUNDATION.md): the window width, sized so the widest bill in the content (eight goods,
 *  the top house) sits in one row beside the picture; the head's painted icon, a card's picture box
 *  and a cost slot's icon box. */
const CONSTRUCTION_WINDOW_W = 640;
const TITLE_ART_PX = 43;
const THUMB_BOX_PX = 72;
const COST_ICON_BOX_PX = 16;
const VIEWS: readonly CatalogueView[] = ['grid', 'list'];
const VIEW_GLYPH: Readonly<Record<CatalogueView, string>> = { grid: GLYPH.grid, list: GLYPH.list };

export interface ConstructionWindowDeps {
  readonly plane: HTMLElement;
  readonly entries: readonly MenuBuildingEntry[];
  readonly thumbs: BuildingThumbs;
  /** The pack the map draws with, or null for the original's art; the cost icons come from the same. */
  readonly pack: PresentationPack | null;
  /** A cost line's good by content type id; `undefined` skips its icon. */
  readonly goodIdOf: (goodType: number) => string | undefined;
  readonly goodLabel: (goodType: number) => string;
  /** The seat's papers in slot order; the papers page lists the plans among them, once a tick. */
  readonly papers: () => readonly Paper[];
  readonly paperLabel: (paper: Paper) => string;
  /** The house a plan names, for its card's "?" label. */
  readonly buildingLabel: (typeId: number) => string;
  readonly onPick: (typeId: number) => void;
  /** The quick-row tools this game offers; the others show disabled. */
  readonly tools: readonly ConstructionTool[];
  /** A quick-row tool was pressed; the window has already hidden for its placement. */
  readonly onPickTool: (tool: ConstructionTool) => void;
  /** A plan card was pressed: the owner starts the placement it pays for (a named house), or holds
   *  it for the catalogue pick (a place-any plan), which the window has already turned to. */
  readonly onPickPaper: (paper: Paper) => void;
  /** A card's "?": the building's Knowledge page; the pending note until the knowledge ticket. */
  readonly onHelp: (typeId: number) => void;
  readonly cue: (cue: UiCue) => void;
}

/** The construction window on the DOM plane (FOUNDATION.md, "Construction window"): the quick row,
 *  then either the catalogue page (the category tabs with the grid or list toggle, the parchment of
 *  permit-like cards with the locked entries at the end) or the papers page (a back tab, the same
 *  toggle, the plans as cards). A pick hides the window for the placement and Esc brings it back as
 *  it was. It takes part in the window registry like a legacy pop-up, but the plane routes its own
 *  pointer input, so it claims no canvas point. */
export interface ConstructionWindow extends ToolWindow {
  /** Re-place an open window against the plane's design-px size; call once per frame. */
  place(): void;
  /** The tick's model: it re-sorts the cards, relists the plans and marks the cost lines the seat
   *  cannot cover; the same model twice costs nothing. */
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
  readonly slots: readonly { readonly element: HTMLElement; readonly goodType: number; shown: string }[];
}

function button(className: string, html: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.innerHTML = html;
  return element;
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export interface BuildingCardView {
  readonly title: string;
  /** The amount of each cost line, in bill order. */
  readonly cost: readonly number[];
  /** Indices into `cost` the seat cannot cover. */
  readonly short?: readonly number[];
  /** The picture box's content: a canvas, or the house glyph. */
  readonly thumb: string;
  readonly helpLabel: string;
  /** True for a card waiting on a discovery: it cannot be picked. */
  readonly locked?: boolean;
  readonly picked?: boolean;
}

/** A card's inner markup, shared with the gallery board. */
export function buildingCardMarkup(view: BuildingCardView): string {
  const locked = view.locked === true;
  const slots = view.cost
    .map(
      (amount, index) =>
        `<i class="on-cost__slot${view.short?.includes(index) === true ? ' on-cost__slot--short' : ''}">${goodIconMarkup(COST_ICON_BOX_PX)}<b>${amount}</b></i>`,
    )
    .join('');
  const pressed = locked ? ' disabled' : ` aria-pressed="${view.picked === true}"`;
  return `<button type="button" class="on-bcard__pick"${pressed}><span class="on-bcard__thumb">${view.thumb}</span><span class="on-bcard__body"><strong class="on-bcard__title">${escapeHtml(view.title)}</strong><span class="on-cost">${slots}</span></span></button><button type="button" class="on-medallion on-bcard__help" aria-label="${escapeHtml(view.helpLabel)}">?</button>`;
}

interface PaperCardView {
  readonly title: string;
  /** What spending the plan does, under the name. */
  readonly effect: string;
  /** The badge for alike plans held more than once ("×3"); empty for a single one. */
  readonly tally: string;
  readonly thumb: string;
  /** The named house's Knowledge label; absent for a place-any plan, which has no "?". */
  readonly helpLabel?: string;
}

/** A plan card's inner markup, in the building card's frame. */
function paperCardMarkup(view: PaperCardView): string {
  const tally = view.tally === '' ? '' : `<b class="on-tally">${escapeHtml(view.tally)}</b>`;
  const help =
    view.helpLabel === undefined
      ? ''
      : `<button type="button" class="on-medallion on-bcard__help" aria-label="${escapeHtml(view.helpLabel)}">?</button>`;
  return `<button type="button" class="on-bcard__pick"><span class="on-bcard__thumb">${view.thumb}</span><span class="on-bcard__body"><strong class="on-bcard__title">${escapeHtml(view.title)}</strong>${tally}<span class="on-bcard__effect">${escapeHtml(view.effect)}</span></span></button>${help}`;
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

  // The quick row: the line and gate tools, the ones the game offers enabled, and the papers.
  const quick = document.createElement('div');
  quick.className = 'on-toolrow';
  for (const tool of CONSTRUCTION_TOOLS) {
    const control = button('on-button', `${GLYPH[tool]}<span></span>`);
    const text = control.querySelector('span');
    if (text !== null) text.textContent = copy[tool];
    if (deps.tools.includes(tool)) {
      control.addEventListener('click', () => {
        deps.cue('confirm');
        suspend();
        deps.onPickTool(tool);
      });
    } else {
      control.disabled = true;
      control.title = copy.notInThisVersion;
    }
    quick.append(control);
  }
  const papers = button(
    'on-button on-button--accent',
    `${GLYPH.papers}<span></span><span class="on-count"></span>`,
  );
  papers.title = copy.papersHint;
  const papersLabel = papers.querySelector('span');
  const papersCount = papers.querySelector('.on-count');
  if (papersLabel === null || !(papersCount instanceof HTMLElement))
    throw new Error('construction: papers button');
  papersLabel.textContent = copy.papers;
  papers.addEventListener('click', () => {
    deps.cue('confirm');
    showPage(state.page === 'papers' ? 'catalog' : 'papers');
  });
  quick.append(papers);

  // The tabs, with the grid or list toggle at their right end; the papers page swaps the category
  // tabs for one back tab and keeps the toggle.
  const tabs = document.createElement('div');
  tabs.className = 'on-tabs';
  tabs.setAttribute('role', 'tablist');
  const back = button('on-tab on-tab--back', `${GLYPH.back}<span></span>`);
  const backLabel = back.querySelector('span');
  if (backLabel !== null) backLabel.textContent = copy.catalog;
  back.addEventListener('click', () => {
    deps.cue('confirm');
    showPage('catalog');
    tabButtons.get(state.category)?.button.focus(); // the tab hid itself under the focus
  });
  tabs.append(back);
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
  const emptyTab = document.createElement('p');
  emptyTab.className = 'on-catalog__empty';
  emptyTab.textContent = copy.emptyCategory;
  parchment.append(openNote.note, openGrid, lockedNote.note, lockedGrid, empty, emptyTab);
  // Kept live: a hidden element reads its scroll as 0, so the close cannot read it back.
  parchment.addEventListener('scroll', () => {
    state = { ...state, scrollTop: parchment.scrollTop };
  });

  // The papers page: the plans under their own note, or the empty note saying where papers come from.
  const plans = document.createElement('div');
  plans.className = 'on-parchment on-catalog';
  const plansNote = note(copy.plans);
  const plansGrid = document.createElement('div');
  plansGrid.className = 'on-build-grid';
  const plansEmpty = document.createElement('div');
  plansEmpty.className = 'on-catalog__empty';
  plansEmpty.innerHTML = `<strong></strong><span></span>`;
  const [plansEmptyTitle, plansEmptyText] = plansEmpty.children;
  if (plansEmptyTitle !== undefined) plansEmptyTitle.textContent = copy.papersEmptyTitle;
  if (plansEmptyText !== undefined) plansEmptyText.textContent = copy.papersEmptyText;
  plans.append(plansNote.note, plansGrid, plansEmpty);
  window.body.append(quick, tabs, parchment, plans);
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
    element.innerHTML = buildingCardMarkup({
      title: entry.label,
      cost: entry.cost.map((line) => line.amount),
      thumb: '<canvas></canvas>',
      helpLabel: formatMessage(copy.help, { name: entry.label }),
    });
    const pick = element.querySelector('.on-bcard__pick');
    const thumb = element.querySelector('canvas');
    const help = element.querySelector('.on-bcard__help');
    if (!(pick instanceof HTMLButtonElement) || thumb === null || !(help instanceof HTMLButtonElement)) {
      throw new Error('construction: card markup');
    }
    if (!deps.thumbs.paint(thumb, entry.typeId, THUMB_BOX_PX)) thumb.outerHTML = GLYPH.house;
    help.title = copy.helpHint;
    const slots = [...element.querySelectorAll('.on-cost__slot')].flatMap((slot, index) => {
      const line = entry.cost[index];
      if (!(slot instanceof HTMLElement) || line === undefined) return [];
      const frame = slot.querySelector('.on-good__frame');
      const goodId = deps.goodIdOf(line.goodType);
      if (frame instanceof HTMLElement && goodId !== undefined) {
        void goodIconSource(goodId, deps.pack).then((source) => {
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
    return { row, element, pick, slots };
  };

  const setPicked = (typeId: number | null): void => {
    state = { ...state, picked: typeId };
    for (const [id, card] of cards) {
      if (!card.pick.disabled) card.pick.setAttribute('aria-pressed', String(id === typeId));
    }
  };

  // A plan card: a named house's picture with the house's "?", or the house glyph for a plan the
  // catalogue names. A named house goes to placement at once, so the window hides for it; a
  // place-any plan turns the window to the catalogue, where the next pick spends it.
  const buildPaperCard = (card: PaperCard): HTMLElement => {
    const element = document.createElement('article');
    element.className = 'on-bcard on-bcard--paper';
    const title = deps.paperLabel(card.paper);
    const houseLabel = card.house === null ? null : deps.buildingLabel(card.house);
    element.innerHTML = paperCardMarkup({
      title,
      effect: copy.paperEffect[card.paper.kind],
      tally: card.count > 1 ? formatMessage(copy.tally, { count: card.count }) : '',
      thumb: card.house === null ? GLYPH.house : '<canvas></canvas>',
      ...(houseLabel === null ? {} : { helpLabel: formatMessage(copy.help, { name: houseLabel }) }),
    });
    const pick = element.querySelector('.on-bcard__pick');
    if (!(pick instanceof HTMLButtonElement)) throw new Error('construction: plan card markup');
    const thumb = element.querySelector('canvas');
    if (thumb !== null && (card.house === null || !deps.thumbs.paint(thumb, card.house, THUMB_BOX_PX))) {
      thumb.outerHTML = GLYPH.house;
    }
    if (card.house === null) element.classList.add('on-bcard--any');
    const house = card.house;
    pick.addEventListener('click', () => {
      deps.cue('confirm');
      if (house === null) showPage('catalog');
      else suspend();
      deps.onPickPaper(card.paper);
    });
    const help = element.querySelector('.on-bcard__help');
    if (help instanceof HTMLButtonElement && house !== null) {
      help.title = copy.helpHint;
      help.addEventListener('click', () => {
        deps.cue('confirm');
        deps.onHelp(house);
      });
    }
    return element;
  };

  // The plans follow the tick: a found or spent plan relists the page and recounts the button.
  let shownPlans: string | null = null;
  const layoutPapers = (): void => {
    const listed = paperCards(deps.papers());
    const key = paperCardsKey(listed);
    if (key === shownPlans) return;
    shownPlans = key;
    plansGrid.replaceChildren(...listed.map(buildPaperCard));
    const count = plansCount(listed);
    plansNote.count.textContent = String(count);
    plansNote.note.hidden = listed.length === 0;
    plansGrid.hidden = listed.length === 0;
    plansEmpty.hidden = listed.length > 0;
    papersCount.textContent = String(count);
    papersCount.hidden = count === 0;
  };

  const showPage = (page: ConstructionPage): void => {
    state = { ...state, page };
    const onPapers = page === 'papers';
    papers.setAttribute('aria-pressed', String(onPapers));
    back.hidden = !onPapers;
    for (const tab of tabButtons.values()) tab.button.hidden = onPapers;
    parchment.hidden = onPapers;
    plans.hidden = !onPapers;
    // Hidden, the parchment forgot its scroll; the state kept it.
    if (!onPapers && window.isOpen()) parchment.scrollTop = state.scrollTop;
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
    emptyTab.hidden = cards.size === 0 || open + locked > 0;
  };

  const showView = (view: CatalogueView): void => {
    state = { ...state, view };
    parchment.dataset.view = view;
    plans.dataset.view = view;
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
    lockedNote.count.textContent = String(partition.locked.length);
    return true;
  };

  const markStocks = (model: HudModel): void => {
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

  // The tick is what moves availability, papers and stocks, so the listing follows the model and
  // a frame between ticks costs nothing.
  let model: HudModel | null = null;
  let shownModel: HudModel | null = null;
  const relist = (): void => {
    if (layoutCards()) showCategory(state.category);
  };
  const present = (): void => {
    if (model === shownModel) return;
    shownModel = model;
    relist();
    layoutPapers();
    if (model !== null) markStocks(model);
  };

  const placeWindow = centralWindowPlacer(window, deps.plane, CONSTRUCTION_WINDOW_W);
  const open = (resumePlacement = false): void => {
    if (!resumePlacement) showPage('catalog');
    layoutCards();
    showCategory(state.category);
    layoutPapers();
    shownModel = null;
    present();
    window.open();
    placeWindow(); // the catalogue needs its height bound before a kept scroll can land
    parchment.scrollTop = state.scrollTop;
  };
  // A close from any path also forgets a pending resume: another window opened over a placement
  // takes the window's place, and the placement's cancel then leaves it away (one window at a time).
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
    open(true);
    const picked = state.page === 'catalog' && state.picked !== null ? cards.get(state.picked) : undefined;
    if (picked !== undefined && !picked.pick.disabled) picked.pick.focus();
  };
  // Build cards and rasterize their thumbnails during HUD boot, before the game loop starts.
  // Opening still checks availability so discoveries and bans made since boot are reflected.
  layoutCards();
  showCategory(state.category);
  showView(state.view);
  showPage(state.page);

  return {
    isOpen: window.isOpen,
    toggle: () => (window.isOpen() ? close() : open()),
    close,
    claims: () => false,
    handleClick: () => false,
    place: placeWindow,
    update: (next) => {
      model = next;
      if (window.isOpen()) present();
    },
    suspend,
    resume,
    state: () => state,
    restore: (next) => {
      state = next;
      // The cards were laid out at boot with nothing picked; an unchanged availability lays none out again.
      setPicked(next.picked);
      showView(next.view);
      showPage(next.page);
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
