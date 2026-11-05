import { PRIMARY_TRIBE } from '../../../game/rules.js';
import { messages } from '../../../i18n/index.js';
import { type ArticleGroup, loadArticles } from '../../knowledge/articles.js';
import { treeHolds } from '../../knowledge/lanes.js';
import type { EntryKind, EntryRef, KnowledgeTab, KnowledgeTree } from '../../knowledge/model.js';
import { entrySearchItems, type SearchItem, searchItems } from '../../knowledge/search.js';
import { goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { button, element, write } from '../parts/dom.js';
import { tribeEmblem } from '../tribe-emblems.js';
import { articleGroups, CALCULATOR_ARTICLE, renderArticle } from './articles/view.js';
import type { KnowledgeContext, KnowledgeDeps, KnowledgeTarget, KnowledgeView } from './context.js';
import { ENCYCLOPEDIA_LIST_SCROLL, firstEntry, renderEncyclopedia } from './entries/encyclopedia.js';
import {
  createTreeView,
  SCALE_DEFAULT_PCT,
  SCALE_MAX_PCT,
  SCALE_MIN_PCT,
  SCALE_STEP_PCT,
  type TreeScales,
  type TreeView,
} from './tree/view.js';
import './knowledge.css';

const TABS: readonly KnowledgeTab[] = ['goods', 'buildings', 'encyclopedia', 'mechanics'];
const ENTRY_KINDS: ReadonlySet<string> = new Set<EntryKind>([
  'animal',
  'building',
  'good',
  'job',
  'tribe',
  'vehicle',
]);
/** Rows a search group lists before it is cut; its heading still counts them all. */
const GROUP_ROW_LIMIT = 12;
const HIT_ICON_PX = 24;
/** Steps Wróć remembers; the oldest falls away past this. */
const PAST_LIMIT = 100;

const isTree = (tab: KnowledgeTab): tab is KnowledgeTree => tab === 'goods' || tab === 'buildings';
const isEntryKind = (kind: string): kind is EntryKind => ENTRY_KINDS.has(kind);

/** One stop of the reader's way through the window. */
interface Place {
  readonly tab: KnowledgeTab;
  readonly entry: EntryRef | null;
  readonly article: string | null;
  readonly calculator: string | null;
  /** The card pinned in the tree on screen. */
  readonly pin: EntryRef | null;
  readonly query: string;
}

type Scrolls = ReadonlyMap<string, readonly [left: number, top: number]>;

interface PastStep {
  readonly place: Place;
  readonly scrolls: Scrolls;
}

interface SearchHit {
  readonly group: string;
  readonly go: string;
  readonly goodId: string | null;
}

const samePlace = (a: Place, b: Place): boolean =>
  a.tab === b.tab &&
  a.article === b.article &&
  a.calculator === b.calculator &&
  a.query === b.query &&
  a.entry?.kind === b.entry?.kind &&
  a.entry?.id === b.entry?.id &&
  a.pin?.kind === b.pin?.kind &&
  a.pin?.id === b.pin?.id;

function placeOf(from: Place, target: KnowledgeTarget): Place {
  const left: Place = { ...from, query: '', pin: null, calculator: null };
  if ('tree' in target) return { ...left, tab: target.tree, pin: target.pin };
  if ('tab' in target) return { ...left, tab: target.tab };
  if ('entry' in target) return { ...left, tab: 'encyclopedia', entry: target.entry };
  if ('article' in target) return { ...left, tab: 'mechanics', article: target.article };
  return { ...left, tab: 'mechanics', article: CALCULATOR_ARTICLE, calculator: target.calculator };
}

function articleHits(groups: readonly ArticleGroup[]): readonly SearchItem<SearchHit>[] {
  const group = messages().knowledge.shell.searchGroups.mechanics;
  return groups.flatMap(({ items }) =>
    items.flatMap((article) => {
      const hit: SearchHit = { group, go: `article:${article.id}`, goodId: null };
      return [
        { name: article.name, target: hit },
        ...article.blocks.flatMap((block) =>
          'h' in block ? [{ name: `${article.name}: ${block.h}`, target: hit }] : [],
        ),
      ];
    }),
  );
}

export function createKnowledgeView(deps: KnowledgeDeps): KnowledgeView {
  const copy = messages().knowledge.shell;
  let tribe = deps.settlement?.tribe ?? PRIMARY_TRIBE;
  let place: Place = {
    tab: 'goods',
    entry: null,
    article: null,
    calculator: null,
    pin: null,
    query: '',
  };
  const past: PastStep[] = [];
  const remember = (): void => {
    past.push({ place, scrolls: new Map(scrolls) });
    if (past.length > PAST_LIMIT) past.shift();
  };
  /** Scroll offsets by name, kept live, so a step and a reopen both land where the reader was. */
  const scrolls = new Map<string, readonly [left: number, top: number]>();
  const scales: TreeScales = { goods: SCALE_DEFAULT_PCT, buildings: SCALE_DEFAULT_PCT };
  let tree: { readonly id: KnowledgeTree; readonly view: TreeView } | null = null;
  const pageReleases: (() => void)[] = [];
  const leavePage = (): void => {
    for (const release of pageReleases.splice(0)) release();
  };

  const go = (target: KnowledgeTarget): void => {
    const next = placeOf(place, target);
    if (samePlace(next, place)) return;
    remember();
    place = next;
    render();
  };
  const context: KnowledgeContext = {
    ...deps,
    // The seat's standing says nothing about another people's page.
    get settlement() {
      return deps.settlement?.tribe === tribe ? deps.settlement : null;
    },
    tribe: () => tribe,
    go,
    onPageLeft: (release) => pageReleases.push(release),
    leavePage,
  };

  const root = element('div', 'kn-view');
  const tabs = element('div', 'kn-tabs on-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', copy.tabsLabel);
  const tabButtons = TABS.map((tab) => {
    const item = button('on-tab');
    item.setAttribute('role', 'tab');
    item.dataset.tab = tab;
    write(item, copy.tabs[tab]);
    item.addEventListener('click', () => go({ tab }));
    return item;
  });
  tabs.append(...tabButtons);

  const back = button('on-button on-button--rounded kn-back');
  back.innerHTML = GLYPH.back;
  back.append(copy.back);
  const gap = element('span', 'kn-tool__gap');

  const zoom = element('label', 'kn-zoom');
  const treeCopy = messages().knowledge.tree;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(SCALE_MIN_PCT);
  slider.max = String(SCALE_MAX_PCT);
  slider.step = String(SCALE_STEP_PCT);
  slider.setAttribute('aria-label', treeCopy.scaleLabel);
  const scaleOut = document.createElement('output');
  zoom.append(slider, scaleOut);
  const showScale = (percent: number): void => {
    slider.value = String(percent);
    scaleOut.textContent = `${percent}%`;
  };
  slider.addEventListener('input', () => tree?.view.setScale(Number(slider.value)));

  const tribes = element('div', 'kn-tribes');
  tribes.setAttribute('role', 'group');
  tribes.setAttribute('aria-label', copy.tribe);
  const tribeButtons = deps.base.tribes.map((known) => {
    const item = button('kn-tribes__item');
    item.title = known.name;
    item.setAttribute('aria-label', known.name);
    item.setAttribute('aria-pressed', String(known.typeId === tribe));
    item.append(tribeEmblem(known.typeId, 'kn-tribes__emblem'));
    item.addEventListener('click', () => {
      if (known.typeId === tribe) return;
      showTribe(known.typeId);
      render();
    });
    return item;
  });
  const showTribe = (next: number): void => {
    tribe = next;
    for (const [index, row] of deps.base.tribes.entries()) {
      tribeButtons[index]?.setAttribute('aria-pressed', String(row.typeId === tribe));
    }
    dropTree();
  };
  /** The watched seat's people as of the last open; a change of seat turns the page to its people. */
  let seatTribe = deps.settlement?.tribe;
  tribes.append(...tribeButtons);

  const searchBox = element('label', 'on-res-field on-res-field--search kn-search');
  searchBox.innerHTML = GLYPH.search;
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = copy.search;
  search.setAttribute('aria-label', copy.search);
  searchBox.append(search);

  const main = element('div', 'kn-main');
  const head = element('div', 'kn-head');
  head.append(back, tabs, gap, zoom, tribes, searchBox);
  root.append(head, main);

  const dropTree = (): void => {
    tree?.view.dispose();
    tree = null;
  };

  const applyScrolls = (held: Scrolls): void => {
    for (const node of main.querySelectorAll<HTMLElement>('[data-keep-scroll]')) {
      const at = node.dataset.keepScroll === undefined ? undefined : held.get(node.dataset.keepScroll);
      if (at !== undefined) [node.scrollLeft, node.scrollTop] = at;
    }
  };

  const searchIndex = (): readonly SearchItem<SearchHit>[] => {
    const groups = copy.searchGroups;
    return [
      ...entrySearchItems(deps.base).map(({ name, target }) => ({
        name,
        target: {
          group: groups[target.group],
          go: `${target.entry.kind}:${target.entry.id}`,
          goodId: target.entry.kind === 'good' ? target.entry.id : null,
        },
      })),
      ...articleHits(articleGroups()),
    ];
  };

  const searchPage = (query: string): HTMLElement => {
    const page = element('div', 'on-parchment kn-page');
    const hits = searchItems(searchIndex(), query);
    if (hits.length === 0) {
      const title = element('h3', '');
      write(title, copy.nothingFound);
      const hint = element('p', '');
      write(hint, copy.nothingFoundHint);
      page.classList.add('kn-search-empty');
      page.append(title, hint);
      return page;
    }
    for (const group of new Set(hits.map((hit) => hit.target.group))) {
      const rows = hits.filter((hit) => hit.target.group === group);
      const section = element('section', '');
      const heading = element('h3', 'on-section');
      write(heading, `${group} · ${rows.length}`);
      const list = element('div', 'kn-hits');
      for (const { name, target } of rows.slice(0, GROUP_ROW_LIMIT)) {
        const row = button('kn-row');
        row.dataset.go = target.go;
        if (target.goodId !== null) {
          row.innerHTML = goodIconMarkup(HIT_ICON_PX);
          const frame = row.querySelector<HTMLElement>('.on-good__frame');
          if (frame !== null) deps.art.goodIcon(frame, target.goodId, HIT_ICON_PX);
        }
        const label = element('span', '');
        write(label, name);
        row.append(label);
        list.append(row);
      }
      section.append(heading, list);
      page.append(section);
    }
    return page;
  };

  const showTree = (id: KnowledgeTree, restored: Scrolls | null): void => {
    const fresh = tree?.id !== id;
    if (fresh || tree === null) {
      dropTree();
      leavePage();
      const view = createTreeView(context, id, {
        scales,
        onClosePane: () => go({ tree: id, pin: null }),
        onScale: showScale,
      });
      tree = { id, view };
      main.replaceChildren(view.element);
      applyScrolls(scrolls);
    }
    tree.view.pin(place.pin);
    if (restored !== null) applyScrolls(restored);
  };

  const showPage = (build: () => HTMLElement, restored: Scrolls | null): void => {
    dropTree();
    leavePage();
    main.replaceChildren(build());
    applyScrolls(restored ?? scrolls);
  };

  function render(restored: Scrolls | null = null): void {
    for (const item of tabButtons) {
      item.setAttribute('aria-selected', String(item.dataset.tab === place.tab));
    }
    back.disabled = past.length === 0;
    zoom.hidden = !isTree(place.tab) || place.query.trim() !== '';
    if (search.value !== place.query) search.value = place.query;
    if (place.query.trim() !== '') showPage(() => searchPage(place.query), restored);
    else if (isTree(place.tab)) showTree(place.tab, restored);
    else if (place.tab === 'encyclopedia') {
      // Picking for the reader takes no step of theirs, so the place is rewritten rather than left.
      const entry = place.entry ?? firstEntry(deps.base);
      place = { ...place, entry };
      showPage(() => renderEncyclopedia(context, entry, openCategory), restored);
    } else {
      const focus = place.calculator === null ? {} : { calculator: place.calculator };
      const article = place.article ?? articleGroups()[0]?.items[0]?.id ?? '';
      showPage(() => renderArticle(context, article, focus), restored);
    }
  }

  const openCategory = (first: EntryRef): void => {
    place = { ...place, entry: first };
    scrolls.delete(ENCYCLOPEDIA_LIST_SCROLL);
    render();
  };

  const backOne = (): void => {
    const step = past.pop();
    if (step === undefined) return;
    place = step.place;
    render(step.scrolls);
  };

  const setQuery = (query: string): void => {
    const wasSearching = place.query !== '';
    if (!wasSearching && query !== '') remember();
    place = { ...place, query };
    if (wasSearching && query === '') backOne();
    else render();
  };

  const dropLayer = (): boolean => {
    if (place.query !== '') {
      setQuery('');
      return true;
    }
    if (place.pin !== null && isTree(place.tab)) {
      go({ tree: place.tab, pin: null });
      return true;
    }
    return false;
  };

  /** A link inside a tree stays there when a tree holds its card; everything else leaves for its tab. */
  const follow = (link: string, inTree: boolean): void => {
    const at = link.indexOf(':');
    const kind = link.slice(0, at);
    const id = link.slice(at + 1);
    if (kind === 'article') {
      go({ article: id });
      return;
    }
    if (kind === 'calculator') {
      go({ calculator: id });
      return;
    }
    if (!isEntryKind(kind)) return;
    const entry: EntryRef = { kind, id };
    const home = kind === 'good' ? 'goods' : 'buildings';
    if (inTree && treeHolds(deps.base, home, entry)) go({ tree: home, pin: entry });
    else go({ entry });
  };

  back.addEventListener('click', backOne);
  search.addEventListener('input', () => setQuery(search.value));
  search.addEventListener('focus', () => {
    void loadArticles().then(() => {
      if (place.query !== '') render();
    });
  });
  root.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-go]') : null;
    if (link?.dataset.go === undefined) return;
    event.preventDefault();
    follow(link.dataset.go, link.closest('.kn-treeview') !== null);
  });
  root.addEventListener(
    'scroll',
    (event) => {
      const { target } = event;
      if (target instanceof HTMLElement && target.dataset.keepScroll !== undefined) {
        scrolls.set(target.dataset.keepScroll, [target.scrollLeft, target.scrollTop]);
      }
    },
    { capture: true, passive: true },
  );
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (dropLayer()) {
      event.preventDefault();
      event.stopPropagation();
    } else if (event.target === search) search.blur();
  };
  root.addEventListener('keydown', onKey);
  // The game window lifts the bar out of the view into its own head, beyond the view's listener.
  head.addEventListener('keydown', onKey);

  return {
    element: root,
    head,
    open: (target) => {
      dropTree();
      const watched = deps.settlement?.tribe;
      if (watched !== seatTribe) {
        seatTribe = watched;
        if (watched !== undefined && watched !== tribe) showTribe(watched);
      }
      const next = target === undefined ? place : placeOf(place, target);
      if (samePlace(next, place)) render();
      else if (target !== undefined) go(target);
    },
    escape: dropLayer,
    close: leavePage,
    dispose: () => {
      dropTree();
      leavePage();
    },
  };
}
