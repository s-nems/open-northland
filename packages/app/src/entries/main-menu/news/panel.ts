import { GAME_VERSION } from '../../../build-version.js';
import { bcp47Tag, currentLocale, formatMessage, messages } from '../../../i18n/index.js';
import { servedByBrowser } from '../../../view/platform/host.js';
import type { MenuNewsColumn, MenuNewsColumns } from '../../../view/settings/store.js';
import { menuSettings, updateSettings } from '../settings/state.js';
import { fitPanel } from './fit.js';
import {
  hasUnseen,
  type MenuNews,
  type NewsEntryView,
  type NewsPanelModel,
  newsColumnMarks,
  newsPanelModel,
  panelIsEmpty,
  type ReleaseView,
  type UpdateNotice,
  versionsColumnMarks,
} from './model.js';
import { formatCalendarDate, formatEventStart, formatUntilStart } from './when.js';
import './news.css';

/** How often the relative start labels ("in 5 minutes") move on while the main screen shows. */
const RELABEL_INTERVAL_MS = 60_000;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Opens in the player's browser; the desktop shell hands the link to the system. */
function externalLink(className: string, url: string, label: string): HTMLAnchorElement {
  const link = element('a', className, label);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function whenLabel(startsAt: number, nowMs: number, tag: string): string {
  const relative = startsAt <= nowMs ? messages().mainMenu.news.live : formatUntilStart(startsAt, nowMs, tag);
  return `${formatEventStart(startsAt, tag)} · ${relative}`;
}

function entryElement(entry: NewsEntryView, nowMs: number, tag: string): HTMLElement {
  const copy = messages().mainMenu.news;
  const article = element('article', 'main-menu__news-entry');
  if (entry.startsAt !== null) {
    const when = element('div', 'main-menu__news-when', whenLabel(entry.startsAt, nowMs, tag));
    when.dataset.startsAt = String(entry.startsAt);
    article.append(when);
  }
  article.append(element('div', 'main-menu__news-title', entry.title));
  if (entry.text !== null) article.append(element('p', 'main-menu__news-text', entry.text));
  if (entry.link !== null) {
    article.append(externalLink('main-menu__news-link', entry.link.url, entry.link.label ?? copy.more));
  }
  return article;
}

function noticeElement(notice: UpdateNotice): HTMLElement {
  const copy = messages().mainMenu.news;
  const row = element('div', 'main-menu__news-notice');
  row.append(
    element(
      'span',
      'main-menu__news-notice-text',
      formatMessage(copy.updateAvailable, { version: notice.version }),
    ),
    externalLink('main-menu__news-download', notice.url, copy.download),
  );
  return row;
}

function releasesElement(releases: readonly ReleaseView[], tag: string): HTMLElement {
  const copy = messages().mainMenu.news;
  const list = element('ul', 'main-menu__news-release-list');
  for (const release of releases) {
    const row = element('li', 'main-menu__news-release');
    row.append(
      element('span', 'main-menu__news-version', release.version),
      element('span', 'main-menu__news-date', formatCalendarDate(release.date, tag)),
      externalLink('main-menu__news-changelog', release.url, copy.changelog),
    );
    list.append(row);
  }
  return list;
}

/** Where the panel keeps each column's fold and what the player saw in it; the menu settings by
 *  default. */
export interface NewsColumnStore {
  readonly read: () => MenuNewsColumns;
  readonly write: (columns: MenuNewsColumns) => void;
}

const menuSettingsColumns: NewsColumnStore = {
  read: () => menuSettings().menuNews,
  write: (columns) => void updateSettings({ menuNews: columns }),
};

interface ColumnSpec {
  readonly id: MenuNewsColumn;
  readonly className: string;
  readonly heading: string;
  readonly blocks: readonly HTMLElement[];
  readonly marks: readonly string[];
}

function sameMarks(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((mark, i) => mark === b[i]);
}

/** A column whose heading folds and unfolds its blocks. Shown unfolded, the column records its items
 *  as seen; folded, its heading carries a dot while it holds an item the player has not seen. */
function columnElement(spec: ColumnSpec, store: NewsColumnStore): HTMLElement {
  const copy = messages().mainMenu.news;
  const column = element('div', `main-menu__news-column ${spec.className}`);
  const body = element('div', 'main-menu__news-body');
  body.id = `main-menu-news-${spec.id}`;
  body.append(...spec.blocks);
  const heading = element('button', 'main-menu__news-heading');
  heading.type = 'button';
  heading.setAttribute('aria-controls', body.id);
  const unseen = element('span', 'main-menu__news-unseen');
  unseen.setAttribute('role', 'img');
  unseen.setAttribute('aria-label', copy.unseen);
  unseen.title = copy.unseen;
  const chevron = element('span', 'main-menu__news-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  heading.append(element('span', 'main-menu__news-label', spec.heading), unseen, chevron);
  column.append(heading, body);

  const show = (collapsed: boolean): void => {
    const state = store.read()[spec.id];
    if (state.collapsed !== collapsed || (!collapsed && !sameMarks(state.seen, spec.marks))) {
      store.write({
        ...store.read(),
        [spec.id]: { collapsed, seen: collapsed ? state.seen : spec.marks },
      });
    }
    body.hidden = collapsed;
    column.classList.toggle('is-collapsed', collapsed);
    heading.setAttribute('aria-expanded', String(!collapsed));
    heading.title = collapsed ? copy.expand : copy.collapse;
    unseen.hidden = !collapsed || !hasUnseen(spec.marks, state.seen);
    // Folding one column gives the other its full size again; the panel fits once it is shown.
    if (column.parentElement !== null) fitPanel(column.parentElement);
  };
  heading.addEventListener('click', () => show(heading.getAttribute('aria-expanded') === 'true'));
  show(store.read()[spec.id].collapsed);
  return column;
}

function panelElement(model: NewsPanelModel, nowMs: number, store: NewsColumnStore): HTMLElement {
  const copy = messages().mainMenu.news;
  const tag = bcp47Tag();
  const versions: HTMLElement[] = [];
  if (model.notice !== null) versions.push(noticeElement(model.notice));
  if (model.releases.length > 0) versions.push(releasesElement(model.releases, tag));
  const panel = element('section', 'main-menu__news');
  panel.setAttribute('aria-label', copy.heading);
  // A column without blocks is left out.
  if (model.entries.length > 0) {
    panel.append(
      columnElement(
        {
          id: 'news',
          className: 'main-menu__news-entries',
          heading: copy.heading,
          blocks: model.entries.map((entry) => entryElement(entry, nowMs, tag)),
          marks: newsColumnMarks(model),
        },
        store,
      ),
    );
  }
  if (versions.length > 0) {
    panel.append(
      columnElement(
        {
          id: 'versions',
          className: 'main-menu__news-versions',
          heading: copy.releases,
          blocks: versions,
          marks: versionsColumnMarks(model),
        },
        store,
      ),
    );
  }
  return panel;
}

const entryKeys = (model: NewsPanelModel): string => model.entries.map((entry) => entry.key).join(',');

/**
 * Shows the panel in `host` once `news` arrives, nothing before and nothing when it has nothing to
 * show. Returns the teardown the main screen runs when it leaves.
 */
export function mountNewsPanel(
  host: HTMLElement,
  news: Promise<MenuNews>,
  now: () => number = Date.now,
  store: NewsColumnStore = menuSettingsColumns,
): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let shown: HTMLElement | null = null;
  let shownKeys = '';
  // A window resize changes the columns' room. The panel covers the screen, so a new fit never
  // resizes what is observed.
  const refit = (): void => {
    if (!disposed && shown !== null) fitPanel(shown);
  };
  const resizes = new ResizeObserver(refit);
  const modelAt = (data: MenuNews, nowMs: number): NewsPanelModel =>
    newsPanelModel(data, nowMs, currentLocale(), { version: GAME_VERSION, browser: servedByBrowser() });
  const render = (data: MenuNews): void => {
    const nowMs = now();
    const model = modelAt(data, nowMs);
    const keys = entryKeys(model);
    if (shown !== null && keys === shownKeys) {
      const tag = bcp47Tag();
      for (const when of shown.querySelectorAll<HTMLElement>('.main-menu__news-when')) {
        when.textContent = whenLabel(Number(when.dataset.startsAt), nowMs, tag);
      }
      return;
    }
    const next = panelIsEmpty(model) ? null : panelElement(model, nowMs, store);
    if (shown === null && next !== null) next.classList.add('is-entering');
    resizes.disconnect();
    shown?.remove();
    if (next !== null) {
      host.append(next);
      resizes.observe(next);
    }
    shown = next;
    shownKeys = keys;
  };
  void news.then((data) => {
    if (disposed) return;
    render(data);
    timer = setInterval(() => render(data), RELABEL_INTERVAL_MS);
    // A web font that arrives later changes the text's size, not the panel's.
    void document.fonts.ready.then(refit);
  });
  return () => {
    disposed = true;
    clearInterval(timer);
    resizes.disconnect();
  };
}
