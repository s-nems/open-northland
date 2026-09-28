import type {
  HypertextBlock,
  HypertextParagraph,
  HypertextPicture,
  HypertextUserIcon,
} from '@open-northland/data';

/**
 * A hypertext page as the book sets it: the flat block stack read into headings, narration, spoken
 * lines, pictures, world views and the author's signature, so the book can typeset them. The reading
 * is this book's approximation; the original stacks the blocks line by line.
 */
export type BookSegment =
  | { readonly kind: 'heading'; readonly text: string }
  | {
      readonly kind: 'para';
      readonly text: string;
      readonly align: 'left' | 'center' | 'right';
      /** The book page a click opens, for a paragraph that links one. */
      readonly link: string | null;
    }
  | {
      readonly kind: 'speech';
      /** From a "Name: text" line; null for a quote the picture before it introduces. */
      readonly speaker: string | null;
      readonly text: string;
      /** The picture right before a quote, drawn beside it as the speaker's portrait. */
      readonly portrait: HypertextPicture | null;
    }
  | { readonly kind: 'picture'; readonly picture: HypertextPicture }
  /** User icons of consecutive rows, which the book sets side by side. */
  | { readonly kind: 'icons'; readonly icons: readonly HypertextUserIcon[] }
  | { readonly kind: 'signature'; readonly text: string };

export interface BookPage {
  /** The page's first title line; null for a page the author left untitled, which gets none. */
  readonly title: string | null;
  readonly segments: readonly BookSegment[];
}

/** A tilde-framed line or a "by …" credit closes a map's page as its author's signature. */
const SIGNATURE = /^(~+.*~+|by\s+\S.*|made by\s+\S.*)$/iu;
const SIGNATURE_TILDES = /^~+\s*|\s*~+$/gu;
/** A speaker is one or two capitalised words before a colon ("Ares:", "Pan Proszak:"). */
const SPEAKER = /^(\p{Lu}[\p{L}'-]{0,20}(?: \p{Lu}[\p{L}'-]{0,20})?):\s+(.+)$/su;
const QUOTED = /^["„”«»]/u;
const QUOTE_MARKS = /^["„”«»]+|["„”«»]+$/gu;

/** Where a paragraph is set. A page that centres most of its prose was centred as a whole for the
 *  original's narrow sheet, so the book sets its prose flush left; a page that centres a few lines
 *  (captions, a table's entries, links) keeps them centred. */
function alignOf(p: HypertextParagraph, centredPage: boolean): 'left' | 'center' | 'right' {
  if (p.align === 'right') return 'right';
  if (p.align !== 'center') return 'left';
  return centredPage && p.link === undefined ? 'left' : 'center';
}

/** True when more than half of the page's unlinked prose is centred. */
function centresProse(blocks: readonly HypertextBlock[]): boolean {
  let prose = 0;
  let centred = 0;
  for (const b of blocks) {
    if (b.kind !== 'text' || b.style !== 'body' || b.link !== undefined) continue;
    prose++;
    if (b.align === 'center') centred++;
  }
  return centred * 2 > prose;
}

export function pageSegments(blocks: readonly HypertextBlock[]): BookPage {
  const segments: BookSegment[] = [];
  const centredPage = centresProse(blocks);
  let title: string | null = null;
  for (const b of blocks) {
    switch (b.kind) {
      case 'blank':
        break;
      case 'picture':
        segments.push({ kind: 'picture', picture: b });
        break;
      case 'icons': {
        const last = segments.at(-1);
        if (last?.kind === 'icons')
          segments[segments.length - 1] = { kind: 'icons', icons: [...last.icons, ...b.icons] };
        else segments.push({ kind: 'icons', icons: b.icons });
        break;
      }
      case 'text':
        if (b.style === 'title' && title === null && b.text.trim() !== '') title = b.text.trim();
        else textSegment(b, segments, centredPage);
        break;
    }
  }
  return { title, segments };
}

/** Read one paragraph into `segments`; a title line after the page's title is a heading. */
function textSegment(p: HypertextParagraph, segments: BookSegment[], centredPage: boolean): void {
  const text = p.text.trim();
  if (text === '') return;
  if (p.style === 'title') {
    segments.push({ kind: 'heading', text });
    return;
  }
  if (p.link === undefined && SIGNATURE.test(text)) {
    segments.push({ kind: 'signature', text: text.replace(SIGNATURE_TILDES, '') });
    return;
  }
  const spoken = p.link === undefined ? SPEAKER.exec(text) : null;
  if (spoken?.[1] !== undefined && spoken[2] !== undefined) {
    segments.push({ kind: 'speech', speaker: spoken[1], text: spoken[2].trim(), portrait: null });
    return;
  }
  const last = segments.at(-1);
  if (p.link === undefined && QUOTED.test(text) && last?.kind === 'picture') {
    segments[segments.length - 1] = {
      kind: 'speech',
      speaker: null,
      text: text.replace(QUOTE_MARKS, ''),
      portrait: last.picture,
    };
    return;
  }
  segments.push({ kind: 'para', text, align: alignOf(p, centredPage), link: p.link ?? null });
}

/** Words the table of contents shows for an untitled page, marked apart from a real title. */
const OPENING_WORDS = 5;
const TRAILING_PUNCTUATION = /[.,:;!?]+$/u;

/** The opening words of the page's first narration or speech, or null for a page without text. */
export function openingWords(page: BookPage): string | null {
  for (const s of page.segments) {
    if (s.kind !== 'para' && s.kind !== 'speech') continue;
    const words = s.text.split(/\s+/u).slice(0, OPENING_WORDS).join(' ').replace(TRAILING_PUNCTUATION, '');
    return `${words}…`;
  }
  return null;
}

/** A title the corpus wrote in capitals reads in title case; any other stays as written. */
export function displayTitle(text: string, locale: string): string {
  if (text !== text.toLocaleUpperCase(locale)) return text;
  return text
    .toLocaleLowerCase(locale)
    .replace(
      /(^|[\s:(„-])(\p{L})/gu,
      (_, before: string, letter: string) => before + letter.toLocaleUpperCase(locale),
    );
}
