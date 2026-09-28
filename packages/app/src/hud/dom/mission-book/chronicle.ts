import type { HypertextBook } from '@open-northland/data';
import { formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import { escapeHtml } from '../parts/dom.js';
import { roman } from './markup.js';
import { type BookPage, displayTitle, openingWords, pageSegments } from './page-segments.js';

/** A chapter preview in the chronicle quotes this many characters. */
const EXCERPT_CHARS = 330;
const EXCERPT_CUT = /\s\S*$/u;

/** One chapter as the chronicle lists it: its page read into segments, and its title or none. */
export interface ChronicleChapter {
  readonly page: BookPage;
  readonly title: string | null;
}

export interface ChronicleInput {
  readonly chapters: readonly ChronicleChapter[];
  readonly pick: number;
  readonly history: HypertextBook | null;
  readonly pictureUrl: (file: string) => string;
  readonly locale: string;
}

function excerpt(page: BookPage): string {
  const text = page.segments
    .flatMap((s) =>
      s.kind === 'para'
        ? [s.text]
        : s.kind === 'speech'
          ? [s.speaker === null ? s.text : `${s.speaker}: ${s.text}`]
          : [],
    )
    .join(' ')
    .replace(/\s+/gu, ' ');
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS).replace(EXCERPT_CUT, '')}…` : text;
}

/** The chronicle: the chapters so far on the left page, the picked one's preview and the history
 *  tables on the right. An untitled chapter is listed by its opening words, set apart. */
export function chronicleSpread(input: ChronicleInput): string {
  const copy = messages().hud.missionBook;
  const { chapters, locale } = input;
  const count = chapters.length;
  const pick = Math.min(input.pick, count - 1);
  const rows = chapters
    .map(({ page, title }, i) => {
      const label =
        title !== null
          ? escapeHtml(displayTitle(title, locale))
          : `<i class="on-book__toc-derived">${escapeHtml(openingWords(page) ?? formatMessage(copy.chapter, { n: roman(i + 1) }))}</i>`;
      const latest =
        i === count - 1 && count > 1
          ? `<span class="on-book__toc-new">${escapeHtml(copy.latest)}</span>`
          : '';
      return `<li><button type="button" class="on-book__toc-row" data-pick="${i}" aria-current="${i === pick}"><span class="on-book__toc-num">${roman(i + 1)}</span><span class="on-book__toc-title">${label}${latest}</span></button></li>`;
    })
    .join('');
  const picked = chapters[pick];
  const art = picked?.page.segments.find((s) => s.kind === 'picture');
  const thumb =
    art?.kind === 'picture'
      ? `<span class="on-book__preview-art"><img src="${escapeHtml(input.pictureUrl(art.picture.file))}" alt=""></span>`
      : '';
  const { history } = input;
  const tablesTitle = history === null ? null : pageSegments(history.pages[history.start] ?? []).title;
  const tables =
    history === null
      ? ''
      : `<p class="on-book__tables"><button type="button" class="on-book__link" data-table="${escapeHtml(history.start)}">${escapeHtml(
          displayTitle(tablesTitle ?? copy.tabs.history, locale),
        )} ›</button></p>`;
  const chaptersLabel = formatMessage(pluralForm(count, copy.chapters, locale), { count });
  const pickedTitle =
    picked?.title === null || picked === undefined
      ? ''
      : `<h3 class="on-book__title">${escapeHtml(displayTitle(picked.title, locale))}</h3>`;
  return `<div class="on-book__page on-book__page--left"><div class="on-book__sheet">
      <p class="on-book__kicker">${escapeHtml(copy.chronicleKicker)}<small> · ${escapeHtml(chaptersLabel)}</small></p>
      <h3 class="on-book__title on-book__title--toc">${escapeHtml(copy.contents)}</h3>
      <ol class="on-book__toc">${rows}</ol>
    </div><p class="on-book__folio">${escapeHtml(copy.tabs.history)}</p></div>
    <div class="on-book__page on-book__page--right"><div class="on-book__sheet">
      <p class="on-book__kicker">${escapeHtml(formatMessage(copy.chapter, { n: roman(pick + 1) }))}</p>
      ${pickedTitle}
      <div class="on-book__preview">${thumb}<p class="on-book__p">${escapeHtml(picked === undefined ? '' : excerpt(picked.page))}</p></div>
      <button type="button" class="on-button on-button--accent on-book__read" data-read="${pick}">${escapeHtml(
        formatMessage(copy.read, { n: roman(pick + 1) }),
      )}</button>
      ${tables}
    </div><p class="on-book__folio">${escapeHtml(copy.tabs.history)}</p></div>`;
}
