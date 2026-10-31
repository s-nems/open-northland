import { PRIMARY_TRIBE } from '../../../game/rules.js';
import { messages } from '../../../i18n/index.js';
import { type ArticleGroup, loadArticles } from '../../knowledge/articles.js';
import type { EntryKind, EntryRef } from '../../knowledge/model.js';
import { entrySearchItems, type SearchItem, searchItems } from '../../knowledge/search.js';
import { goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { button, element, write } from '../parts/dom.js';
import { articleGroups, CALCULATOR_ARTICLE, renderArticle } from './article-view.js';
import type {
  KnowledgeContext,
  KnowledgeDeps,
  KnowledgeTab,
  KnowledgeTarget,
  KnowledgeTree,
  KnowledgeView,
} from './context.js';
import { renderEncyclopedia } from './encyclopedia-view.js';
import { createTreeView, SCALE_DEFAULT_PCT, type TreeScales, type TreeView, treeHolds } from './tree-view.js';
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
  /** Scroll offsets by name, kept live, so a step and a reopen both land where the reader was. */
  const scrolls = new Map<string, readonly [left: number, top: number]>();
  const scales: TreeScales = { goods: SCALE_DEFAULT_PCT, buildings: SCALE_DEFAULT_PCT };
  let tree: { readonly id: KnowledgeTree; readonly view: TreeView } | null = null;

  const go = (target: KnowledgeTarget): void => {
    const next = placeOf(place, target);
    if (samePlace(next, place)) return;
    past.push({ place, scrolls: new Map(scrolls) });
    place = next;
    render();
  };
  const context: KnowledgeContext = { ...deps, tribe: () => tribe, go };

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

  const tool = element('div', 'kn-tool');
  const back = button('on-button on-button--rounded kn-back');
  back.innerHTML = GLYPH.back;
  back.append(copy.back);
  const gap = element('span', 'kn-tool__gap');
  const searchBox = element('label', 'on-res-field on-res-field--search kn-search');
  searchBox.innerHTML = GLYPH.search;
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = copy.search;
  search.setAttribute('aria-label', copy.search);
  searchBox.append(search);
  tool.append(back, gap, searchBox);
  if (deps.settlement === null) {
    const label = element('label', 'kn-tribe');
    label.append(copy.tribe);
    const picker = document.createElement('select');
    for (const known of deps.base.tribes) {
      const option = document.createElement('option');
      option.value = String(known.typeId);
      option.textContent = known.name;
      option.selected = known.typeId === tribe;
      picker.append(option);
    }
    picker.addEventListener('input', () => {
      tribe = Number(picker.value);
      dropTree();
      render();
    });
    label.append(picker);
    tool.append(label);
  }
  const main = element('div', 'kn-main');
  root.append(tabs, tool, main);

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
      const view = createTreeView(context, id, {
        scales,
        onClosePane: () => go({ tree: id, pin: null }),
      });
      tree = { id, view };
      main.replaceChildren(view.element);
      applyScrolls(scrolls);
    }
    tree.view.pin(place.pin);
    if (restored !== null) applyScrolls(restored);
  };

  const showPage = (page: HTMLElement, restored: Scrolls | null): void => {
    dropTree();
    main.replaceChildren(page);
    applyScrolls(restored ?? scrolls);
  };

  function render(restored: Scrolls | null = null): void {
    for (const item of tabButtons) {
      item.setAttribute('aria-selected', String(item.dataset.tab === place.tab));
    }
    back.disabled = past.length === 0;
    if (search.value !== place.query) search.value = place.query;
    if (place.query.trim() !== '') showPage(searchPage(place.query), restored);
    else if (isTree(place.tab)) showTree(place.tab, restored);
    else if (place.tab === 'encyclopedia') showPage(renderEncyclopedia(context, place.entry), restored);
    else {
      const focus = place.calculator === null ? {} : { calculator: place.calculator };
      const article = place.article ?? articleGroups()[0]?.items[0]?.id ?? '';
      showPage(renderArticle(context, article, focus), restored);
    }
  }

  const backOne = (): void => {
    const step = past.pop();
    if (step === undefined) return;
    place = step.place;
    render(step.scrolls);
  };

  const setQuery = (query: string): void => {
    const wasSearching = place.query !== '';
    if (!wasSearching && query !== '') past.push({ place, scrolls: new Map(scrolls) });
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
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (dropLayer()) {
      event.preventDefault();
      event.stopPropagation();
    } else if (event.target === search) search.blur();
  });

  return {
    element: root,
    open: (target) => {
      dropTree();
      const next = target === undefined ? place : placeOf(place, target);
      if (samePlace(next, place)) render();
      else if (target !== undefined) go(target);
    },
    escape: dropLayer,
    dispose: dropTree,
  };
}
