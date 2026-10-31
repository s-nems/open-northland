import { formatMessage, messages } from '../../../i18n/index.js';
import type { KnowledgeBuilding, KnowledgeGood } from '../../knowledge/base.js';
import { amountText, statusText } from '../../knowledge/entry-format.js';
import type { EntryRef } from '../../knowledge/model.js';
import { goodIconMarkup } from '../good-art.js';
import { button, element, setStyleVar, write } from '../parts/dom.js';
import type { KnowledgeClip, KnowledgeContext, KnowledgeStatus } from './context.js';
import { treeHolds } from './tree-view.js';

const LINK_ICON_PX = 22;
const HEAD_ICON_PX = 48;
const HEAD_THUMB_PX = 84;

export type Child = Node | string | null;

/** One block of a page. `side` puts it in the narrow column on a wide page; a page under the container
 *  width runs every block in the order given. */
export interface EntryBlock {
  readonly node: HTMLElement;
  readonly side?: boolean;
  /** Frees what the block holds once its page leaves the document. */
  readonly release?: () => void;
}

const copy = () => messages().knowledge.entry;

export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  ...children: readonly Child[]
): HTMLElementTagNameMap[K] {
  const made = element(tag, className);
  made.append(...children.filter((child) => child !== null));
  return made;
}

export function section(title: string | null, ...children: readonly Child[]): HTMLElement {
  return node('section', 'kn-block', title === null ? null : node('h3', 'kn-h', title), ...children);
}

export const paragraph = (...children: readonly Child[]): HTMLElement => node('p', '', ...children);
export const foot = (text: string): HTMLElement => node('p', 'kn-foot', text);

function link(go: string, ...children: readonly Child[]): HTMLButtonElement {
  const made = button('kn-link');
  made.dataset.go = go;
  made.append(...children.filter((child) => child !== null));
  return made;
}

export const textLink = (go: string, text: string): HTMLButtonElement => link(go, node('span', '', text));

export function goodIcon(context: KnowledgeContext, good: KnowledgeGood, boxPx: number): HTMLElement {
  const holder = element('span', 'kn-icon', goodIconMarkup(boxPx));
  const frame = holder.querySelector<HTMLElement>('.on-good__frame');
  if (frame !== null) context.art.goodIcon(frame, good.id, boxPx);
  return holder;
}

/** A good with its amount: the icon, a gap, `x3`, the name. */
export function goodLink(context: KnowledgeContext, good: KnowledgeGood, amount?: number): HTMLElement {
  return link(
    `good:${good.id}`,
    goodIcon(context, good, LINK_ICON_PX),
    amount === undefined ? null : node('b', 'kn-amount', amountText(amount)),
    node('span', '', good.name),
  );
}

/** The goods of a bill by type; a type the reference hides drops out. */
export function goodLinks(
  context: KnowledgeContext,
  rows: readonly { readonly goodType: number; readonly amount: number }[],
): readonly HTMLElement[] {
  return rows.flatMap((row) => {
    const good = context.base.goodByType.get(row.goodType);
    return good === undefined ? [] : [goodLink(context, good, row.amount)];
  });
}

export const buildingLink = (building: KnowledgeBuilding): HTMLElement =>
  textLink(`building:${building.id}`, building.name);

/** A trade's name, a link when it has a page. */
export function jobLink(context: KnowledgeContext, jobType: number, name: string): HTMLElement {
  const job = context.base.jobByType.get(jobType);
  return job === undefined ? node('span', '', name) : textLink(`job:${job.id}`, job.name);
}

export const links = (items: readonly Child[]): HTMLElement => node('div', 'kn-links', ...items);

export function fold(summary: string, ...children: readonly Child[]): HTMLElement {
  return node('details', 'kn-fold', node('summary', '', summary), ...children);
}

/** `items` up to `limit`, the rest folded behind a count. */
export function foldedLinks(items: readonly HTMLElement[], limit: number): readonly HTMLElement[] {
  const rest = items.slice(limit);
  return [
    links(items.slice(0, limit)),
    ...(rest.length === 0
      ? []
      : [fold(formatMessage(copy().good.moreOf, { count: rest.length }), links(rest))]),
  ];
}

export function factList(rows: readonly (readonly [label: string, value: Child])[]): HTMLElement {
  const list = element('dl', 'kn-facts');
  for (const [label, value] of rows) {
    list.append(node('dt', '', label), node('dd', '', value));
  }
  return list;
}

export interface TableColumn {
  readonly title: string;
  /** Left out under the container width until the reader opens the rest. */
  readonly extra?: boolean;
}

export interface TableCell {
  readonly text: string;
  /** The cell's own value; the column shades against its peak, so a colour always means its column. */
  readonly heat?: number;
}

export interface TableRow {
  readonly label: Child;
  readonly cells: readonly TableCell[];
}

/** A table whose first column names the row. Extra columns stay reachable under the width through a fold. */
export function dataTable(columns: readonly TableColumn[], rows: readonly TableRow[]): HTMLElement {
  const peaks = columns
    .slice(1)
    .map((_, column) => Math.max(1, ...rows.map((row) => row.cells[column]?.heat ?? 0)));
  const extra = (column: number): string => (columns[column]?.extra === true ? ' kn-col-extra' : '');
  const head = node(
    'tr',
    '',
    ...columns.map((column, index) =>
      node('th', `${index === 0 ? '' : 'kn-num'}${extra(index)}`, column.title),
    ),
  );
  const body = rows.map((row) =>
    node(
      'tr',
      '',
      node('th', '', row.label),
      ...row.cells.map((cell, index) => {
        const data = node('td', `kn-num${extra(index + 1)}`, cell.text);
        if (cell.heat !== undefined && rows.length > 1) {
          data.classList.add('kn-heat');
          setStyleVar(data, '--heat', (cell.heat / (peaks[index] ?? 1)).toFixed(2));
        }
        return data;
      }),
    ),
  );
  const table = node('table', 'kn-table', node('thead', '', head), node('tbody', '', ...body));
  if (!columns.some((column) => column.extra === true)) return table;
  const more = node('details', 'kn-fold kn-fold--columns', node('summary', '', copy().table.moreColumns));
  return node('div', 'kn-table-wrap', table, more);
}

export interface EntryFilm {
  readonly clip: KnowledgeClip;
  /** Played when `clip` has no record. */
  readonly fallback?: KnowledgeClip;
  readonly name: string;
  readonly text: string;
}

/** The looping previews of an entry. No motion, or no clip that plays, makes no block at all. */
export function filmBlock(
  context: KnowledgeContext,
  films: readonly EntryFilm[],
  side = false,
): EntryBlock | null {
  const motion = context.art.motion;
  if (motion === null) return null;
  const stops: (() => void)[] = [];
  const figure = element('figure', 'kn-motion');
  for (const { clip, fallback, name, text } of films) {
    const stage = element('div', 'kn-motion__stage');
    const stop = motion.play(stage, clip) ?? (fallback === undefined ? null : motion.play(stage, fallback));
    if (stop === null) continue;
    stops.push(stop);
    figure.append(node('div', 'kn-motion__clip', stage, node('figcaption', '', node('b', '', name), text)));
  }
  if (stops.length === 0) return null;
  return {
    node: figure,
    side,
    release: () => {
      for (const stop of stops) stop();
    },
  };
}

/** The status chip; a plain "available" says something only about a building. */
export function statusChip(status: KnowledgeStatus, sayAvailable: boolean): HTMLElement | null {
  const text = statusText(status);
  if (status.kind === 'available') {
    return sayAvailable ? node('p', 'kn-chip kn-chip--ok', copy().status.available) : null;
  }
  return node('p', `kn-chip kn-chip--${status.kind === 'locked' ? 'locked' : 'map'}`, text ?? '');
}

export function originBlock(help: string | null): EntryBlock | null {
  if (help === null) return null;
  return {
    node: node(
      'blockquote',
      'kn-origin',
      node('span', 'kn-origin__text', help),
      node('cite', '', copy().original),
    ),
  };
}

export function articleLinks(
  context: KnowledgeContext,
  ref: EntryRef | null,
  articles: readonly (keyof ReturnType<typeof copy>['articles'])[],
): EntryBlock | null {
  const tree =
    ref === null ? null : (['goods', 'buildings'] as const).find((t) => treeHolds(context.base, t, ref));
  const items: HTMLElement[] = [];
  if (tree !== undefined && tree !== null) {
    const show = button('kn-link');
    show.append(node('span', '', copy().showInTree));
    show.addEventListener('click', () => context.go({ tree, pin: ref }));
    items.push(show);
  }
  for (const id of articles) items.push(textLink(`article:${id}`, copy().articles[id]));
  if (items.length === 0) return null;
  return { node: section(copy().good.seeAlso, links(items)), side: true };
}

export interface EntryHead {
  readonly picture: Node | null;
  readonly title: string;
  readonly kicker: string;
}

function goodPicture(context: KnowledgeContext, good: KnowledgeGood): HTMLElement {
  return goodIcon(context, good, HEAD_ICON_PX);
}

export const goodHead = (context: KnowledgeContext, good: KnowledgeGood, kicker: string): EntryHead => ({
  picture: goodPicture(context, good),
  title: good.name,
  kicker,
});

/** A building's picture for `context`'s tribe at `boxPx`, or nothing where the art has none. */
export function buildingPicture(
  context: KnowledgeContext,
  building: KnowledgeBuilding,
  boxPx = HEAD_THUMB_PX,
): HTMLImageElement | null {
  const image = element('img', 'kn-thumb');
  image.alt = '';
  return context.art.buildingThumb(image, building.typeId, boxPx, context.tribe()) ? image : null;
}

/** Stops `release` once `root` leaves the document; an entry has no dispose of its own to call. */
function releaseWhenRemoved(root: HTMLElement, release: () => void): void {
  const observer = new IntersectionObserver(() => {
    if (root.isConnected) return;
    observer.disconnect();
    release();
  });
  observer.observe(root);
}

/**
 * One entry page: `blocks` in reading order. A wide page splits them into a main and a side column; a
 * narrow one dissolves the columns, and each block's `order` keeps the sequence.
 */
export function entryPage(head: EntryHead, blocks: readonly (EntryBlock | null)[]): HTMLElement {
  const present = blocks.filter((block) => block !== null);
  const body = present.filter((block) => !(block.node instanceof HTMLQuoteElement));
  const main = element('div', 'kn-entry__main');
  const side = element('div', 'kn-entry__side');
  body.forEach((block, index) => {
    block.node.style.order = String(index);
    (block.side === true ? side : main).append(block.node);
  });
  const columns = element('div', 'kn-entry__cols');
  columns.append(main);
  if (side.childElementCount > 0) columns.append(side);
  else columns.classList.add('kn-entry__cols--single');
  const root = node(
    'article',
    'kn-entry',
    node(
      'header',
      'kn-entry__head',
      head.picture,
      node('div', 'kn-entry__title', node('h2', '', head.title), node('p', '', head.kicker)),
    ),
    columns,
    ...present.filter((block) => block.node instanceof HTMLQuoteElement).map((block) => block.node),
  );
  const releases = present.flatMap((block) => block.release ?? []);
  if (releases.length > 0) {
    releaseWhenRemoved(root, () => {
      for (const release of releases) release();
    });
  }
  return root;
}

export const emptyEntry = (text: string): HTMLElement => {
  const page = element('p', 'kn-empty');
  write(page, text);
  return page;
};
