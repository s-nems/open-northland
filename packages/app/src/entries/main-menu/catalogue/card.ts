import type { CatalogBrowseEntry, MapTextLanguage } from '@open-northland/data';
import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import { node } from '../dom.js';
import { hasClaimableSeat } from '../lobby/roster-state.js';
import { listedIn, mapItem } from '../map-select/model.js';
import type { CatalogueRow } from './model.js';

/** What the cards, the detail panel and the Installed tab ask of the view that owns the data. */
export interface CatalogueContext {
  /** `play` opens the lobby from the main menu; `choose` picks the map for a multiplayer room. */
  readonly purpose: 'play' | 'choose';
  /** False where the platform has no installed-map store: nothing downloads or removes. */
  readonly canStore: boolean;
  thumbnail(entry: CatalogBrowseEntry): string | null;
  /** The file the server kept, for a player to unpack by hand; null when it kept none. */
  fileUrl(entry: CatalogBrowseEntry): string | null;
  /** Download progress as a fraction while the entry downloads. */
  progress(entryId: string): number | undefined;
  /** The last download or removal error, shown until the next attempt. */
  failure(entryId: string): string | undefined;
  download(row: CatalogueRow): void;
  remove(entryId: string): void;
  pick(row: CatalogueRow): void;
  /** Shows the entry in the detail panel. */
  open(entryId: string): void;
}

const PERCENT = 100;

/** Short language codes as chips list them. */
export const LANGUAGE_CODES: Readonly<Record<MapTextLanguage, string>> = {
  pol: 'PL',
  eng: 'EN',
  ger: 'DE',
  rus: 'RU',
  ita: 'IT',
  chs: 'ZH',
  cht: 'ZH-T',
};

export function languageCodes(languages: readonly MapTextLanguage[]): string {
  return languages.map((language) => LANGUAGE_CODES[language]).join(' ');
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(bcp47Tag(), { dateStyle: 'medium' }).format(new Date(iso));
}

export function formatCount(count: number, compact = false): string {
  return new Intl.NumberFormat(bcp47Tag(), compact ? { notation: 'compact' } : {}).format(count);
}

/** "4 players", or "2-8 players" for a pack whose maps differ; null when no map lists seats. */
export function playersText(counts: readonly number[]): string | null {
  const min = counts[0];
  const max = counts.at(-1);
  if (min === undefined || max === undefined) return null;
  if (min !== max) return formatMessage(messages().mapCatalogue.playersRange, { min, max });
  return formatMessage(pluralForm(max, messages().mainMenu.mapSelect.players, bcp47Tag()), { count: max });
}

/** The kind as a card names it; an entry the keywords did not place shows its catalogue category. */
export function kindText(entry: CatalogBrowseEntry): string {
  return entry.kind === 'other' ? entry.categoryLabel : messages().mapCatalogue.kindChips[entry.kind];
}

function chipBox(parts: readonly string[]): HTMLElement {
  const box = node('div', 'catalogue-chips');
  box.append(...parts.filter((part) => part !== '').map((part) => node('span', 'catalogue-chip', part)));
  return box;
}

/** A card's one chip line: kind, seats, languages and the series, clipped where it runs out. */
export function cardChips(row: CatalogueRow): HTMLElement {
  const players = playersText(row.playerCounts);
  return chipBox([
    kindText(row.entry),
    ...(players === null ? [] : [players]),
    ...(row.languages.length > 0 ? [languageCodes(row.languages)] : []),
    ...(row.entry.series ? [messages().mapCatalogue.seriesChip] : []),
  ]);
}

/** The panel's chips: kind and series; its fact strip holds the rest. */
export function kindChips(row: CatalogueRow): HTMLElement {
  return chipBox([kindText(row.entry), ...(row.entry.series ? [messages().mapCatalogue.seriesChip] : [])]);
}

/** Whether a multiplayer room can take the installed map: listed for multiplayer, with a free seat. */
export function roomCanTake(row: CatalogueRow): boolean {
  const index = row.playableIndex;
  return index !== null && listedIn(mapItem(index), 'multiplayer') && hasClaimableSeat(index.players ?? []);
}

function button(className: string, label: string, action: () => void): HTMLButtonElement {
  const element = node('button', className, label);
  element.type = 'button';
  element.addEventListener('click', (event) => {
    // An Installed row opens its details on a click; its own buttons do only what they say.
    event.stopPropagation();
    action();
  });
  return element;
}

/** A link that opens in a new tab, or in the system browser on the desktop. */
export function pageLink(className: string, label: string, href: string): HTMLAnchorElement {
  const link = node('a', className, label);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.addEventListener('click', (event) => event.stopPropagation());
  return link;
}

/** A link that saves the server's kept file, opening like `pageLink` where the browser will not save. */
export function fileLink(className: string, href: string): HTMLAnchorElement {
  const link = pageLink(`${className} is-file`, messages().mapCatalogue.downloadFile, href);
  link.download = '';
  return link;
}

/** What an entry the player downloads by hand links to: its page on another site, or our kept file. */
export function manualLink(
  row: CatalogueRow,
  ctx: CatalogueContext,
  className: string,
): HTMLAnchorElement | null {
  const { file } = row.entry;
  if (file.kind === 'external')
    return pageLink(`${className} is-external`, messages().mapCatalogue.openPage, file.url);
  const href = row.status === 'manual' ? ctx.fileUrl(row.entry) : null;
  return href === null ? null : fileLink(className, href);
}

export function downloadLabel(row: CatalogueRow, ctx: CatalogueContext): string {
  const text = messages().mapCatalogue;
  const progress = ctx.progress(row.entry.id);
  if (progress !== undefined)
    return formatMessage(text.downloading, { percent: Math.round(progress * PERCENT) });
  switch (row.status) {
    case 'updatable':
      return text.update;
    case 'redownload':
      return text.redownload;
    case 'inGameChanged':
      return text.downloadCatalogueVersion;
    default:
      return text.download;
  }
}

/** Play or Choose for a playable entry; disabled in a room for a map without a free seat. */
export function pickButton(row: CatalogueRow, ctx: CatalogueContext, className: string): HTMLButtonElement {
  const text = messages().mapCatalogue;
  const pick = button(className, ctx.purpose === 'choose' ? text.choose : text.play, () => ctx.pick(row));
  if (ctx.purpose === 'choose' && !roomCanTake(row)) {
    pick.disabled = true;
    pick.title = text.notMultiplayer;
  }
  return pick;
}

export function downloadButton(
  row: CatalogueRow,
  ctx: CatalogueContext,
  className: string,
): HTMLButtonElement {
  const download = button(className, downloadLabel(row, ctx), () => ctx.download(row));
  download.disabled = ctx.progress(row.entry.id) !== undefined;
  return download;
}

export function removeButton(entryId: string, ctx: CatalogueContext): HTMLButtonElement {
  const remove = button('main-menu__ghost', messages().mapCatalogue.remove, () => ctx.remove(entryId));
  remove.disabled = ctx.progress(entryId) !== undefined;
  return remove;
}

export function thumbImage(url: string | null): HTMLImageElement | null {
  if (url === null) return null;
  const img = node('img');
  img.src = url;
  img.alt = '';
  img.loading = 'lazy';
  // A missing screenshot leaves the frame's gradient instead of a broken-image glyph.
  img.addEventListener('error', () => img.remove());
  return img;
}

/** What the entry's state means for the player, in one sentence; null where the state says nothing
 *  beyond the buttons (downloadable, installed). */
export function statusLine(row: CatalogueRow): string | null {
  const text = messages().mapCatalogue;
  const conversion = row.entry.conversion;
  const message = conversion?.verdict === 'failed' ? conversion.message : '';
  switch (row.status) {
    case 'available':
    case 'installed':
      return null;
    case 'manual':
      return formatMessage(text.status.manual, { message });
    case 'failed':
      return `${text.status.failed}. ${formatMessage(text.failedReason, { message })}`;
    default:
      return text.status[row.status];
  }
}

/** A state worth a badge, its meaning a hover away; a plain downloadable entry carries none. */
export function badge(row: CatalogueRow): HTMLElement | null {
  if (row.status === 'available') return null;
  const element = node(
    'span',
    `catalogue-badge is-${row.status}`,
    messages().mapCatalogue.badges[row.status],
  );
  element.title = statusLine(row) ?? messages().mapCatalogue.status[row.status];
  return element;
}

/** Which date a card's meta line shows in place of the downloads: the publication or the update date
 *  while the grid sorts by it, else none. */
export type CardDate = 'published' | 'updated' | null;

/** One grid card: picture, title, one meta line and one chip line. The detail panel holds the actions. */
export function catalogueCard(row: CatalogueRow, ctx: CatalogueContext, dateOf: CardDate) {
  const text = messages().mapCatalogue;
  const { entry } = row;
  const card = node('article', 'catalogue-card');
  card.dataset.entryId = entry.id;
  card.tabIndex = -1;
  card.setAttribute('aria-label', entry.title);
  const picture = node('div', 'catalogue-card__picture');
  const img = thumbImage(ctx.thumbnail(entry));
  if (img !== null) picture.append(img);
  const state = badge(row);
  if (state !== null) picture.append(state);
  const progress = node('div', 'catalogue-card__progress');
  picture.append(progress);
  const body = node('div', 'catalogue-card__body');
  const title = node('div', 'catalogue-card__title', entry.title);
  title.title = entry.title;
  const meta = node('div', 'catalogue-card__meta');
  const likes = node('span', 'catalogue-stat is-likes', formatCount(entry.likeCount, true));
  likes.title = text.details.likes;
  const tail =
    dateOf === null
      ? node('span', 'catalogue-stat is-downloads', formatCount(entry.downloadCount, true))
      : node(
          'span',
          'catalogue-stat',
          formatDate(dateOf === 'updated' ? entry.updatedAt : entry.publishedAt),
        );
  tail.title =
    dateOf === null
      ? text.details.downloads
      : dateOf === 'updated'
        ? text.details.updated
        : text.details.published;
  meta.append(node('span', 'catalogue-card__author', entry.author), likes, tail);
  meta.title = entry.author;
  body.append(title, meta, cardChips(row));
  card.append(picture, body);
  const paintProgress = (): void => {
    const fraction = ctx.progress(entry.id);
    progress.hidden = fraction === undefined;
    progress.style.setProperty('--progress', String(fraction ?? 0));
  };
  paintProgress();
  card.addEventListener('click', () => ctx.open(entry.id));
  return { element: card, paintProgress };
}
