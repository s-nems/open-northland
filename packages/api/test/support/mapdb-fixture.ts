import { mapdbSearchUrl } from '../../src/upstream/mapdb.js';

/** The mapdb origin the tests sync from. */
export const MAPDB_UPSTREAM = 'https://www.wikinger-tommy.de';

/** The URL the mapdb list is posted to, for assertions. */
export const MAPDB_SEARCH_URL = mapdbSearchUrl(MAPDB_UPSTREAM);

/** The fields one map's three-row group carries, with the shape the site writes. */
export interface MapdbRow {
  readonly title: string;
  readonly author: string;
  readonly authorId: number;
  readonly downloadName: string | null;
  readonly screenshot: string;
  readonly campaignId: number | null;
  readonly language: 'DE' | 'EN';
  readonly players: 'M' | 'S';
  readonly genre: string;
  readonly description: string;
}

export function mapdbRow({
  title,
  author,
  authorId,
  downloadName,
  screenshot,
  campaignId,
  language,
  players,
  genre,
  description,
}: MapdbRow): string {
  const download =
    downloadName === null
      ? 'Bitte über die Kampagne laden'
      : `<a href="/mapdb/download.php?datei=${downloadName}">Download</a>`;
  const campaign =
    campaignId === null
      ? '<td class="mitte" height="40">&nbsp;</td>'
      : `<td class="mitte" height="40"><a href="./maps.php?modus=K&amp;Id=${campaignId}" title="Kampagne">K</a></td>`;
  return [
    `<tr><td rowspan="3"><img src="/femaps/Screens/${screenshot}.jpg" width="252" height="189" alt="Screenshot">`,
    `</td>${campaign}`,
    `<td class="mitte">${language}</td>`,
    `<td title="Editor" class="mitte">Int.</td>`,
    `<td title="${players === 'M' ? 'Multiplayer' : 'Singleplayer'}" class="mitte">${players}</td>`,
    `<td title="Spielversion" class="mitte">DAW</td>`,
    `<td class="titel">${title}</td>`,
    `<td width="150" class="mitte">${download}</td></tr>`,
    `<tr><td colspan="5" class="mittek" height="20">${genre}</td>`,
    `<td rowspan="2" colspan="2" class="kleiner">${description}</td></tr>`,
    `<tr><td colspan="5" class="mittek"><a href="maps.php?modus=A&amp;Id=${authorId}">${author}</a>&nbsp;</td></tr>`,
  ].join('');
}

const HEAD = [
  '<!DOCTYPE html><html><head><meta http-equiv="CONTENT-TYPE" content="text/html; charset=UTF-8">',
  '</head><body><form id="maps" action="./maps.php?modus=M" method="POST">',
  '<input type="hidden" name="order" value="ausgabe DESC"><input type="hidden" name="pos" value="0">',
  '<input type="hidden" name="bereich" value="20"><input type="text" name="titel" value="%"></form>',
  '<table>',
].join('');

/** One list page as the site writes it: the search form, then the table of three-row map groups. */
export function mapdbPage(rows: readonly string[]): string {
  return `${HEAD}${rows.join('')}</table></body></html>`;
}

/** The `datei` value for a map file name, encoded as the site's links write it. */
export function mapdbDatei(name: string): string {
  return encodeURIComponent(`/femaps/Maps/${name}`);
}

/** A full, downloadable map row with distinct names from its title. */
export function mapdbMapRow(overrides: Partial<MapdbRow> & { readonly title: string }): string {
  const name = overrides.downloadName ?? `${overrides.title.replace(/[^A-Za-z0-9]+/g, '')}_v2-1-0.exe`;
  return mapdbRow({
    author: 'DTFuchs',
    authorId: 178,
    downloadName: mapdbDatei(name),
    screenshot: name.replace(/\.exe$/, ''),
    campaignId: null,
    language: 'DE',
    players: 'S',
    genre: 'Kampf',
    description: 'Eine Testkarte.',
    ...overrides,
  });
}

/** `count` full map rows with distinct titles and downloads. */
export function mapdbMaps(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) =>
    mapdbMapRow({ title: `Testkarte ${index + 1}`, authorId: 300 + index }),
  );
}

/** A fake mapdb upstream: it answers the search form with the given pages and records requests. */
export class FakeMapdb {
  readonly requests: { readonly url: string; readonly body: URLSearchParams }[] = [];
  private cursor = 0;

  constructor(readonly pages: readonly (readonly string[])[]) {}

  /** Serves the pages from the start again, as a fresh sync would find them. */
  reset(): void {
    this.cursor = 0;
  }

  get fetch(): (url: string, init?: { readonly body?: string }) => Promise<Response> {
    return async (url, init) => {
      if (this.cursor >= this.pages.length) return new Response('', { status: 404 });
      const page = this.pages[this.cursor] ?? [];
      this.cursor += 1;
      this.requests.push({ url, body: new URLSearchParams(init?.body ?? '') });
      return new Response(mapdbPage(page), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    };
  }
}
