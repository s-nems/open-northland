import {
  type FeedRelease,
  LANGUAGE_INFO,
  type Language,
  type NewsDocument,
  type NewsEntry,
  type NewsText,
  RELEASE_VERSION,
  type ReleaseFeed,
  type SiteLinks,
} from '@open-northland/data';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** How long an event with a start and no end stays on the menu after it starts. */
export const EVENT_DEFAULT_SHOWN_MS = 3 * HOUR_MS;
export const MAX_SHOWN_ENTRIES = 3;
export const MAX_SHOWN_RELEASES = 3;

/** What the menu fetched this session; a part that failed to load is null. */
export interface MenuNews {
  readonly news: NewsDocument | null;
  readonly feed: ReleaseFeed | null;
}

export interface NewsEntryView {
  /** The entry's place in the document, which stays the same for one session. */
  readonly key: number;
  readonly title: string;
  readonly text: string | null;
  readonly link: { readonly url: string; readonly label: string | null } | null;
  /** Epoch ms; null for an undated entry. */
  readonly startsAt: number | null;
}

export interface ReleaseView {
  readonly version: string;
  /** `YYYY-MM-DD`, the release's calendar date. */
  readonly date: string;
  readonly url: string;
}

export interface UpdateNotice {
  readonly version: string;
  readonly url: string;
}

export interface NewsPanelModel {
  readonly notice: UpdateNotice | null;
  readonly entries: readonly NewsEntryView[];
  readonly releases: readonly ReleaseView[];
}

/** Where this build runs and what it is, for the update notice. */
export interface BuildFacts {
  readonly version: string;
  /** A browser always serves the newest build, so only the desktop shell can be behind. */
  readonly browser: boolean;
}

/** The last instant an entry shows, in epoch ms; Infinity for an undated entry without an end. */
function shownUntil(entry: NewsEntry): number {
  if (entry.until !== undefined) return Date.parse(entry.until);
  if (entry.startsAt !== undefined) return Date.parse(entry.startsAt) + EVENT_DEFAULT_SHOWN_MS;
  return Number.POSITIVE_INFINITY;
}

/** Entries still showing at `nowMs`: dated ones by start, then undated ones in file order, capped. */
export function visibleEntries(
  entries: readonly NewsEntry[],
  nowMs: number,
): readonly { readonly entry: NewsEntry; readonly key: number }[] {
  const showing = entries
    .map((entry, key) => ({ entry, key }))
    .filter(({ entry }) => nowMs < shownUntil(entry));
  const dated = showing
    .filter(({ entry }) => entry.startsAt !== undefined)
    .sort((a, b) => Date.parse(a.entry.startsAt ?? '') - Date.parse(b.entry.startsAt ?? ''));
  const undated = showing.filter(({ entry }) => entry.startsAt === undefined);
  return [...dated, ...undated].slice(0, MAX_SHOWN_ENTRIES);
}

/** The text in `lang`, else in a language its readers fall back to, else English. */
export function pickText(text: NewsText, lang: Language): string {
  for (const reading of [lang, ...(LANGUAGE_INFO[lang].fallbacks ?? [])]) {
    const found = text[reading];
    if (found !== undefined) return found;
  }
  return text.eng;
}

/** The site page for `lang`'s tag, else the English one. */
export function siteLink(links: SiteLinks, lang: Language): string {
  const tag = LANGUAGE_INFO[lang].tag;
  return Object.entries(links).find(([key]) => key === tag)?.[1] ?? links.en;
}

function versionParts(version: string): { readonly core: readonly number[]; readonly pre: string | null } {
  const dash = version.indexOf('-');
  const core = dash < 0 ? version : version.slice(0, dash);
  return { core: core.split('.').map(Number), pre: dash < 0 ? null : version.slice(dash + 1) };
}

/** Orders two release versions: negative when `a` is older. A prerelease precedes its release. */
export function compareReleaseVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < Math.max(left.core.length, right.core.length); i++) {
    const delta = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (delta !== 0) return delta;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre < right.pre ? -1 : 1;
}

/** The newest release when a desktop build older than it runs; never for a build without a release
 *  version, such as a development build. */
export function updateNotice(feed: ReleaseFeed, build: BuildFacts, lang: Language): UpdateNotice | null {
  const newest = feed.releases[0];
  if (build.browser || newest === undefined || !RELEASE_VERSION.test(build.version)) return null;
  if (compareReleaseVersions(build.version, newest.version) >= 0) return null;
  return { version: newest.version, url: siteLink(feed.download, lang) };
}

function releaseView(release: FeedRelease, lang: Language): ReleaseView {
  return { version: release.version, date: release.date, url: siteLink(release.url, lang) };
}

function entryView(entry: NewsEntry, key: number, lang: Language): NewsEntryView {
  const { link } = entry;
  return {
    key,
    title: pickText(entry.title, lang),
    text: entry.text === undefined ? null : pickText(entry.text, lang),
    link:
      link === undefined
        ? null
        : { url: link.url, label: link.label === undefined ? null : pickText(link.label, lang) },
    startsAt: entry.startsAt === undefined ? null : Date.parse(entry.startsAt),
  };
}

export function newsPanelModel(
  data: MenuNews,
  nowMs: number,
  lang: Language,
  build: BuildFacts,
): NewsPanelModel {
  return {
    notice: data.feed === null ? null : updateNotice(data.feed, build, lang),
    entries:
      data.news === null
        ? []
        : visibleEntries(data.news.entries, nowMs).map(({ entry, key }) => entryView(entry, key, lang)),
    releases:
      data.feed === null
        ? []
        : data.feed.releases.slice(0, MAX_SHOWN_RELEASES).map((release) => releaseView(release, lang)),
  };
}

export function panelIsEmpty(model: NewsPanelModel): boolean {
  return model.notice === null && model.entries.length === 0 && model.releases.length === 0;
}
