import { messages } from '../../../i18n/index.js';
import {
  type ArticleBlock,
  type ArticleTable,
  fillTokens,
  type InlinePart,
  type LoadedArticles,
  parseInline,
} from '../../knowledge/articles.js';
import { factText } from '../../knowledge/facts.js';
import { goodIconMarkup } from '../good-art.js';
import { button, element, setHidden, write } from '../parts/dom.js';
import { foldText, hasWords, searchWords } from '../parts/name-search.js';
import { quietTextField } from '../parts/text-field.js';
import type { KnowledgeContext } from './context.js';
import { renderFigure } from './figures/index.js';

const GOOD_CELL_ICON_PX = 20;

/** What rendering an article's text needs. */
export interface ArticleScope {
  readonly context: KnowledgeContext;
  /** False when the text is another language's fallback, so a link shows the reader's own name. */
  readonly nativeText: boolean;
  readonly articles: LoadedArticles;
  readonly dataBlock: (name: Extract<ArticleBlock, { data: unknown }>['data']) => HTMLElement;
}

export function goLink(target: string, label: string): HTMLButtonElement {
  const link = button('kn-link');
  link.dataset.go = target;
  link.append(element('span', ''));
  write(link.lastElementChild ?? link, label);
  return link;
}

/** The name the reader's language gives a link's target; the authored label where it names nothing. */
function targetName({ context }: ArticleScope, part: Extract<InlinePart, { kind: string }>): string {
  const { base } = context;
  switch (part.kind) {
    case 'good':
      return base.goodById.get(part.id)?.name ?? part.label;
    case 'building':
      return base.buildingById.get(part.id)?.name ?? part.label;
    case 'job':
      return base.jobById.get(part.id)?.name ?? part.label;
    case 'vehicle':
      return base.vehicles.find((v) => v.id === part.id)?.name ?? part.label;
    case 'animal':
      return base.animals.find((a) => String(a.tribe) === part.id)?.name ?? part.label;
    case 'article':
      return part.label;
  }
}

/** A sentence in its own language keeps its inflected label ("kilka Drewna"); a name swapped in cannot. */
const linkLabel = (scope: ArticleScope, part: Extract<InlinePart, { kind: string }>): string =>
  scope.nativeText ? part.label : targetName(scope, part);

/** Appends `text` to `host`, with its `{{fact}}` numbers filled and its links live. */
export function appendInline(host: HTMLElement, text: string, scope: ArticleScope): void {
  const filled = fillTokens(text, (name) => factText(name, scope.context.base));
  for (const part of parseInline(filled)) {
    if ('text' in part) host.append(part.text);
    else host.append(goLink(`${part.kind}:${part.id}`, linkLabel(scope, part)));
  }
}

function textNode<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text: string,
  scope: ArticleScope,
): HTMLElementTagNameMap[K] {
  const node = element(tag, className);
  appendInline(node, text, scope);
  return node;
}

/** A good's link with its icon, for a table cell. */
export function goodCell({ art, base }: KnowledgeContext, id: string): HTMLElement {
  const link = goLink(`good:${id}`, base.goodById.get(id)?.name ?? id);
  link.insertAdjacentHTML('afterbegin', goodIconMarkup(GOOD_CELL_ICON_PX));
  const frame = link.querySelector<HTMLElement>('.on-good__frame');
  if (frame !== null) art.goodIcon(frame, id, GOOD_CELL_ICON_PX);
  return link;
}

export type PlainCell = HTMLElement | number | string;

/** A table of ready cells; a column of numbers aligns itself. */
export function plainTable(
  head: readonly string[],
  rows: readonly (readonly PlainCell[])[],
  foot = '',
): HTMLElement {
  const numeric = head.map((_, i) => i > 0 && rows.every((row) => typeof row[i] === 'number'));
  const table = element('table', 'kn-table');
  const headRow = element('tr', '');
  head.forEach((label, i) => {
    const cell = element('th', numeric[i] === true ? 'kn-num' : '');
    write(cell, label);
    headRow.append(cell);
  });
  const thead = element('thead', '');
  thead.append(headRow);
  const body = element('tbody', '');
  for (const row of rows) {
    const line = element('tr', '');
    row.forEach((value, i) => {
      const cell = element('td', numeric[i] === true ? 'kn-num' : '');
      cell.append(typeof value === 'number' ? String(value) : value);
      line.append(cell);
    });
    body.append(line);
  }
  table.append(thead, body);
  const host = element('div', 'kn-block');
  host.append(table);
  if (foot !== '') {
    const note = element('p', 'kn-foot');
    write(note, foot);
    host.append(note);
  }
  return host;
}

function tableBody(table: ArticleTable, scope: ArticleScope): HTMLTableElement {
  const { head, rows, num = [] } = table;
  const align = (i: number): string => (num.includes(i) ? 'kn-num' : '');
  const node = element('table', 'kn-table');
  const headRow = element('tr', '');
  head.forEach((label, i) => {
    headRow.append(textNode('th', align(i), label, scope));
  });
  const thead = element('thead', '');
  thead.append(headRow);
  const body = element('tbody', '');
  for (const row of rows) {
    const line = element('tr', '');
    row.forEach((value, i) => {
      const cell = textNode(i === 0 ? 'th' : 'td', align(i), String(value), scope);
      if (i === 0) cell.scope = 'row';
      line.append(cell);
    });
    body.append(line);
  }
  node.append(thead, body);
  return node;
}

/** The field over a `filter` table: it stays at the top of the page while the rows scroll under it. */
function filterField(table: HTMLTableElement, placeholder: string): HTMLElement {
  const copy = messages().knowledge.mechanics;
  const rows = [...table.tBodies].flatMap((body) => [...body.rows]);
  const texts = rows.map((row) => foldText(row.textContent ?? ''));
  const bar = element('label', 'kn-filter');
  const input = quietTextField(element('input', 'kn-filter__input'));
  input.type = 'search';
  input.placeholder = placeholder === '' ? copy.filterPlaceholder : placeholder;
  input.setAttribute('aria-label', input.placeholder);
  const count = element('span', 'kn-filter__count');
  count.setAttribute('aria-live', 'polite');
  const empty = element('p', 'kn-empty');
  write(empty, copy.filterEmpty);
  setHidden(empty, true);
  const apply = (): void => {
    const words = searchWords(input.value);
    let shown = 0;
    rows.forEach((row, i) => {
      const hit = hasWords(texts[i] ?? '', words);
      row.hidden = !hit;
      if (hit) shown += 1;
    });
    write(count, `${shown} / ${rows.length}`);
    setHidden(empty, shown > 0);
  };
  input.addEventListener('input', apply);
  bar.append(input, count);
  apply();
  table.after(empty);
  return bar;
}

function tableBlock(table: ArticleTable, scope: ArticleScope): HTMLElement {
  const host = element('div', 'kn-block');
  const node = tableBody(table, scope);
  host.append(node);
  if (table.filter !== undefined && table.filter !== false) {
    host.classList.add('kn-block--filter');
    host.prepend(filterField(node, table.filter === true ? '' : table.filter));
  }
  if (table.foot !== undefined) host.append(textNode('p', 'kn-foot', table.foot, scope));
  return host;
}

function faqBlock(rows: readonly (readonly [string, string])[], scope: ArticleScope): HTMLElement {
  const host = element('div', 'kn-block');
  for (const [question, answer] of rows) {
    const details = element('details', 'kn-faq');
    details.append(textNode('summary', '', question, scope), textNode('p', '', answer, scope));
    host.append(details);
  }
  return host;
}

function listBlock(
  tag: 'ol' | 'ul',
  className: string,
  items: readonly string[],
  scope: ArticleScope,
): HTMLElement {
  const list = element(tag, className);
  for (const item of items) list.append(textNode('li', '', item, scope));
  return list;
}

export function renderBlock(block: ArticleBlock, scope: ArticleScope): HTMLElement {
  if ('h' in block) return textNode('h3', 'kn-h', block.h, scope);
  if ('p' in block) return textNode('p', '', block.p, scope);
  if ('table' in block) return tableBlock(block.table, scope);
  if ('list' in block) return listBlock('ul', 'kn-steps', block.list, scope);
  if ('steps' in block) return listBlock('ol', 'kn-formula', block.steps, scope);
  if ('faq' in block) return faqBlock(block.faq, scope);
  if ('data' in block) return scope.dataBlock(block.data);
  return renderFigure(scope.context, block.figure.id, block.figure.caption ?? '');
}
