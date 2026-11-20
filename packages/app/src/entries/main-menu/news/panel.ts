import { GAME_VERSION } from '../../../build-version.js';
import { bcp47Tag, currentLocale, formatMessage, messages } from '../../../i18n/index.js';
import { servedByBrowser } from '../../../view/platform/host.js';
import {
  type MenuNews,
  type NewsEntryView,
  type NewsPanelModel,
  newsPanelModel,
  panelIsEmpty,
  type ReleaseView,
  type UpdateNotice,
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

function columnElement(className: string, heading: string, blocks: readonly HTMLElement[]): HTMLElement {
  const column = element('div', `main-menu__news-column ${className}`);
  column.append(element('div', 'main-menu__news-heading', heading), ...blocks);
  return column;
}

function panelElement(model: NewsPanelModel, nowMs: number): HTMLElement {
  const copy = messages().mainMenu.news;
  const tag = bcp47Tag();
  const versions: HTMLElement[] = [];
  if (model.notice !== null) versions.push(noticeElement(model.notice));
  if (model.releases.length > 0) versions.push(releasesElement(model.releases, tag));
  const panel = element('section', 'main-menu__news');
  panel.setAttribute('aria-label', copy.heading);
  // A column without blocks is left out, so the other one stands at the left edge.
  if (model.entries.length > 0) {
    panel.append(
      columnElement(
        'main-menu__news-entries',
        copy.heading,
        model.entries.map((entry) => entryElement(entry, nowMs, tag)),
      ),
    );
  }
  if (versions.length > 0) panel.append(columnElement('main-menu__news-versions', copy.releases, versions));
  return panel;
}

const childElements = (parent: HTMLElement): HTMLElement[] =>
  [...parent.children].filter((child): child is HTMLElement => child instanceof HTMLElement);

/** Hides, and takes out of Tab order and the accessibility tree, each block that reaches past its
 *  column's height cap and every block after it, so a short window drops whole blocks instead of
 *  cutting one. A column left without blocks hides its heading too. */
function retireHiddenBlocks(panel: HTMLElement): void {
  for (const column of childElements(panel)) {
    const limit = column.getBoundingClientRect().bottom;
    const [heading, ...blocks] = childElements(column);
    let fits = true;
    for (const block of blocks) {
      fits &&= block.getBoundingClientRect().bottom <= limit;
      block.inert = !fits;
    }
    if (heading !== undefined) heading.inert = blocks.every((block) => block.inert);
  }
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
): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let shown: HTMLElement | null = null;
  let shownKeys = '';
  // A window or interface scale change resizes the columns, which may hide or reveal blocks.
  const resizes = new ResizeObserver(() => {
    if (shown !== null) retireHiddenBlocks(shown);
  });
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
    const next = panelIsEmpty(model) ? null : panelElement(model, nowMs);
    if (shown === null && next !== null) next.classList.add('is-entering');
    resizes.disconnect();
    shown?.remove();
    if (next !== null) {
      host.append(next);
      for (const column of childElements(next)) resizes.observe(column);
    }
    shown = next;
    shownKeys = keys;
  };
  void news.then((data) => {
    if (disposed) return;
    render(data);
    timer = setInterval(() => render(data), RELABEL_INTERVAL_MS);
  });
  return () => {
    disposed = true;
    clearInterval(timer);
    resizes.disconnect();
  };
}
