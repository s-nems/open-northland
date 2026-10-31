import { messages } from '../../../i18n/index.js';
import {
  type Article,
  type ArticleGroup,
  findArticle,
  type LoadedArticles,
  loadArticles,
  loadedArticles,
} from '../../knowledge/articles.js';
import { button, element, write } from '../parts/dom.js';
import { type ArticleScope, appendInline, goLink, renderBlock } from './blocks.js';
import { createCalculator, focusCalculator, selectCalculatorWeapon } from './calculator-view.js';
import type { KnowledgeContext } from './context.js';
import { renderDataBlock } from './data-blocks.js';
import './article.css';

/** The article the matrix and calculator live in. */
export const CALCULATOR_ARTICLE = 'damage';

export interface ArticleFocus {
  /** Preselects a weapon in the calculator and scrolls to it. */
  readonly calculator?: string;
}

/** The rail's groups in reading order; empty until the language's chunk has arrived. */
export function articleGroups(): readonly ArticleGroup[] {
  return loadedArticles()?.groups ?? [];
}

function rail(groups: readonly ArticleGroup[], current: string): HTMLElement {
  const nav = element('nav', 'kn-rail');
  nav.dataset.keepScroll = 'article-rail';
  nav.setAttribute('aria-label', messages().knowledge.mechanics.railLabel);
  for (const { group, items } of groups) {
    const title = element('h4', '');
    write(title, group);
    nav.append(title);
    for (const article of items) {
      const item = button('kn-rail__item');
      item.dataset.go = `article:${article.id}`;
      item.setAttribute('aria-current', String(article.id === current));
      write(item, article.name);
      nav.append(item);
    }
  }
  return nav;
}

function seeLink(key: string, scope: ArticleScope): HTMLElement {
  const at = key.indexOf(':');
  const kind = key.slice(0, at);
  const id = key.slice(at + 1);
  const { base } = scope.context;
  const named: Readonly<Record<string, string | undefined>> = {
    article: findArticle(scope.articles, id)?.name,
    building: base.buildingById.get(id)?.name,
    good: base.goodById.get(id)?.name,
    job: base.jobById.get(id)?.name,
  };
  return goLink(key, named[kind] ?? id);
}

function articleBody(article: Article, scope: ArticleScope): HTMLElement {
  const copy = messages().knowledge.mechanics;
  const body = element('article', 'kn-article');
  const title = element('h2', 'kn-title');
  write(title, article.name);
  const speed = element('p', 'kn-speed');
  write(speed, copy.speedNote);
  body.append(title, speed);
  if (article.lead !== undefined) {
    const lead = element('p', 'kn-lead');
    appendInline(lead, article.lead, scope);
    body.append(lead);
  }
  for (const block of article.blocks) {
    if ('data' in block && block.data === 'matrix') body.append(createCalculator(scope.context));
    body.append(renderBlock(block, scope));
  }
  if (article.see !== undefined && article.see.length > 0) {
    const see = element('p', 'kn-seealso');
    see.append(copy.seeAlso, ' ');
    for (const key of article.see) see.append(seeLink(key, scope), ' ');
    body.append(see);
  }
  return body;
}

function fillBook(
  book: HTMLElement,
  context: KnowledgeContext,
  articles: LoadedArticles,
  id: string,
  focus: ArticleFocus,
): void {
  const article = findArticle(articles, id) ?? articles.groups[0]?.items[0];
  if (article === undefined) return;
  const scope: ArticleScope = {
    context,
    articles,
    dataBlock: (name) => renderDataBlock(context, name),
  };
  const page = element('div', 'on-parchment kn-page');
  page.dataset.keepScroll = `article-${article.id}`;
  page.append(articleBody(article, scope));
  const nav = rail(articles.groups, article.id);
  book.replaceChildren(nav, page);
  // Laid out only once the caller has placed the book.
  requestAnimationFrame(() => {
    nav.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
    if (focus.calculator !== undefined) focusCalculator(page);
  });
}

/** The Mechaniki tab on one article; the text of a language arrives as its own chunk. */
export function renderArticle(context: KnowledgeContext, id: string, focus: ArticleFocus = {}): HTMLElement {
  const book = element('div', 'kn-book');
  if (focus.calculator !== undefined) selectCalculatorWeapon(context, focus.calculator);
  const ready = loadedArticles();
  if (ready !== null) {
    fillBook(book, context, ready, id, focus);
    return book;
  }
  const note = element('p', 'kn-empty');
  write(note, messages().knowledge.mechanics.loading);
  book.append(note);
  void loadArticles().then((articles) => {
    if (articles === null) write(note, messages().knowledge.mechanics.loadFailed);
    else fillBook(book, context, articles, id, focus);
  });
  return book;
}
