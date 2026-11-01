/**
 * The wikinger-tommy.de mapdb list page, as its own search form (`maps.php?modus=M`) renders it:
 * one screenshot cell spanning three table rows per map — flags, title and download, then genre
 * and description, then the author. The page is a plain server-rendered table, so a row-walking
 * parser with no HTML dependency reads it.
 */

/** One map of the mapdb, as its list page's table rows state it. */
export interface MapdbRecord {
  readonly title: string;
  /** The author name as the page writes it, empty when the row group names none. */
  readonly author: string;
  /** The author page's numeric id, null when the row group links none. */
  readonly authorId: number | null;
  /** The download link as the page writes it (`/mapdb/download.php?datei=…`), or null for a
   *  campaign part the page tells a player to load from its campaign. */
  readonly downloadPath: string | null;
  /** The screenshot path on the upstream, null when the row group carries none. */
  readonly screenshotPath: string | null;
  /** The campaign page's numeric id the map belongs to, null for a standalone map. */
  readonly campaignId: number | null;
  /** The text language the row names, null when the row names none the parser knows. */
  readonly language: 'de' | 'en' | null;
  /** What the row says about seats, null when its cell is unreadable. */
  readonly players: 'single' | 'multi' | null;
  /** The genre as written, empty when the row gives none. */
  readonly genre: string;
  /** The description as written, empty when the row gives none. */
  readonly description: string;
}

/** A record while its three rows are being read. */
interface MapdbDraft {
  title: string;
  author: string;
  authorId: number | null;
  downloadPath: string | null;
  screenshotPath: string | null;
  campaignId: number | null;
  language: 'de' | 'en' | null;
  players: 'single' | 'multi' | null;
  genre: string;
  description: string;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

/** Decodes the entities the site writes into text and attribute values, leaving others as written. */
function unescapeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** A cell's text: its markup dropped, its entities decoded, its whitespace collapsed. */
function cellText(html: string): string {
  return unescapeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const ROW = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
const TITLE_CELL = /<td\b[^>]*class="titel"[^>]*>([\s\S]*?)<\/td>/i;
const SCREENSHOT = /<img\b[^>]*alt="Screenshot"[^>]*>/i;
const IMG_SOURCE = /\bsrc="([^"]+)"/i;
const CAMPAIGN_LINK = /\bhref="[^"]*modus=K&(?:amp;)?Id=(\d+)"/i;
const LANGUAGE_CELL = /<td\s+class="mitte">(DE|EN)<\/td>/i;
const MULTIPLAYER_CELL = /<td\s+title="Multiplayer"/i;
const SINGLEPLAYER_CELL = /<td\s+title="Singleplayer"/i;
const DOWNLOAD_LINK = /\bhref="([^"]*\/mapdb\/download\.php\?datei=[^"]*)"[^>]*>\s*Download\s*<\/a>/i;
const INFO_CELL = /<td\b[^>]*class="mittek"[^>]*>([\s\S]*?)<\/td>/gi;
const DESCRIPTION_CELL = /<td\b[^>]*class="kleiner"[^>]*>([\s\S]*?)<\/td>/i;
const AUTHOR_LINK = /\bhref="[^"]*modus=A&(?:amp;)?Id=(\d+)"[^>]*>([\s\S]*?)<\/a>/i;

function numberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const number = Number.parseInt(value, 10);
  return Number.isSafeInteger(number) ? number : null;
}

/** The title row of a map: flags, title and its download, under a screenshot spanning three rows. */
function titleRecord(row: string): MapdbDraft | null {
  const title = TITLE_CELL.exec(row);
  if (title === null) return null;
  const language = LANGUAGE_CELL.exec(row);
  const image = SCREENSHOT.exec(row);
  const source = image === null ? null : IMG_SOURCE.exec(image[0]);
  const download = DOWNLOAD_LINK.exec(row);
  return {
    title: cellText(title[1] ?? ''),
    author: '',
    authorId: null,
    downloadPath: download === null ? null : unescapeEntities(download[1] ?? ''),
    screenshotPath: source === null ? null : unescapeEntities(source[1] ?? ''),
    campaignId: numberOrNull(CAMPAIGN_LINK.exec(row)?.[1]),
    language: language === null ? null : language[1] === 'EN' ? 'en' : 'de',
    players: MULTIPLAYER_CELL.test(row) ? 'multi' : SINGLEPLAYER_CELL.test(row) ? 'single' : null,
    genre: '',
    description: '',
  };
}

/** The rows that follow a title row: genre and description, then the author. */
function readInfoRows(draft: MapdbDraft, following: readonly string[]): void {
  for (const row of following) {
    const description = DESCRIPTION_CELL.exec(row);
    if (description !== null && draft.description === '') draft.description = cellText(description[1] ?? '');
    INFO_CELL.lastIndex = 0;
    for (const match of row.matchAll(INFO_CELL)) {
      const cell = match[1] ?? '';
      if (draft.author === '' && !cell.includes('<a ')) draft.genre = cellText(cell);
      const author = AUTHOR_LINK.exec(cell);
      if (author !== null && draft.authorId === null) {
        draft.authorId = numberOrNull(author[1]);
        draft.author = cellText(author[2] ?? '');
      }
    }
  }
}

/** Every map one list page states, in its order. Rows a page keeps outside the three-row shape are
 *  ignored, so a site redesign degrades to a short page rather than to invented records. */
export function parseMapdbPage(html: string): readonly MapdbRecord[] {
  const rows: string[] = [];
  let row = ROW.exec(html);
  while (row !== null) {
    rows.push(row[0]);
    row = ROW.exec(html);
  }
  const records: MapdbRecord[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] ?? '';
    if (!TITLE_CELL.test(row)) continue;
    const draft = titleRecord(row);
    if (draft === null) continue;
    readInfoRows(draft, rows.slice(index + 1, index + 3));
    records.push({ ...draft });
  }
  return records;
}
