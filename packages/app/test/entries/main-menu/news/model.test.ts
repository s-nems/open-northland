import type { NewsEntry, ReleaseFeed } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  compareReleaseVersions,
  EVENT_DEFAULT_SHOWN_MS,
  hasUnseen,
  MAX_SHOWN_ENTRIES,
  MAX_SHOWN_RELEASES,
  newsColumnMarks,
  newsPanelModel,
  panelIsEmpty,
  pickText,
  siteLink,
  updateNotice,
  versionsColumnMarks,
  visibleEntries,
} from '../../../../src/entries/main-menu/news/model.js';

const NOW = Date.parse('2026-11-25T18:00:00Z');
const MINUTE_MS = 60_000;
const DESKTOP = { version: '0.6.0', browser: false };

const entry = (title: string, dates: Pick<NewsEntry, 'startsAt' | 'until'> = {}): NewsEntry => ({
  title: { eng: title },
  ...dates,
});
const titles = (entries: readonly NewsEntry[], nowMs = NOW): readonly string[] =>
  visibleEntries(entries, nowMs).map(({ entry: shown }) => shown.title.eng);

const release = (version: string, date: string) => ({
  version,
  date,
  url: { en: `https://site.test/releases/${version}/`, pl: `https://site.test/pl/releases/${version}/` },
});
const FEED: ReleaseFeed = {
  schema: 1,
  download: { en: 'https://site.test/download/', pl: 'https://site.test/pl/download/' },
  releases: [release('0.7.0', '2026-11-14'), release('0.6.0', '2026-11-05'), release('0.5.0', '2026-10-29')],
};

describe('news entry visibility', () => {
  it('shows an event until its end, or for the default window after its start', () => {
    const start = '2026-11-25T17:00:00Z';
    expect(titles([entry('ended', { startsAt: start, until: '2026-11-25T17:30:00Z' })])).toEqual([]);
    expect(titles([entry('running', { startsAt: start, until: '2026-11-25T19:00:00Z' })])).toEqual([
      'running',
    ]);
    const openEnded = [entry('open', { startsAt: start })];
    expect(titles(openEnded)).toEqual(['open']);
    expect(titles(openEnded, Date.parse(start) + EVENT_DEFAULT_SHOWN_MS)).toEqual([]);
  });

  it('shows an undated note until its end, or always', () => {
    expect(titles([entry('expired', { until: '2026-11-25T17:59:00Z' })])).toEqual([]);
    expect(titles([entry('note', { until: '2026-11-26T00:00:00Z' }), entry('forever')])).toEqual([
      'note',
      'forever',
    ]);
  });

  it('puts dated entries first by start, then undated ones in file order, capped', () => {
    const shown = titles([
      entry('undated A'),
      entry('later', { startsAt: '2026-11-27T19:00:00+01:00' }),
      entry('undated B'),
      entry('sooner', { startsAt: '2026-11-26T19:00:00+01:00' }),
    ]);
    expect(shown).toEqual(['sooner', 'later', 'undated A']);
    expect(shown).toHaveLength(MAX_SHOWN_ENTRIES);
  });
});

describe('news text and links', () => {
  it('reads the game language, its fallbacks, then English', () => {
    const text = { eng: 'Showmatch', pol: 'Pokaz', chs: '表演赛' };
    expect(pickText(text, 'pol')).toBe('Pokaz');
    expect(pickText(text, 'ger')).toBe('Showmatch');
    expect(pickText(text, 'cht')).toBe('表演赛');
  });

  it('picks the site page for the language tag, else English', () => {
    const links = FEED.download;
    expect(siteLink(links, 'pol')).toBe('https://site.test/pl/download/');
    expect(siteLink(links, 'rus')).toBe('https://site.test/download/');
  });
});

describe('release versions', () => {
  it('compares by number, a prerelease before its release', () => {
    expect(compareReleaseVersions('0.10.0', '0.9.3')).toBeGreaterThan(0);
    expect(compareReleaseVersions('0.7.0', '0.7.0')).toBe(0);
    expect(compareReleaseVersions('0.8.0-rc.1', '0.8.0')).toBeLessThan(0);
    expect(compareReleaseVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });

  it('offers the newest version to an older desktop build only', () => {
    expect(updateNotice(FEED, DESKTOP, 'pol')).toEqual({
      version: '0.7.0',
      url: 'https://site.test/pl/download/',
    });
    expect(updateNotice(FEED, { version: '0.6.0', browser: true }, 'pol')).toBeNull();
    expect(updateNotice(FEED, { version: '0.7.0', browser: false }, 'pol')).toBeNull();
    expect(updateNotice(FEED, { version: '0.8.0', browser: false }, 'pol')).toBeNull();
    expect(updateNotice(FEED, { version: 'dev', browser: false }, 'pol')).toBeNull();
    expect(updateNotice({ ...FEED, releases: [] }, DESKTOP, 'pol')).toBeNull();
  });
});

describe('news panel model', () => {
  it('lists the first releases with the language page and leaves out a part that failed', () => {
    const feed = { ...FEED, releases: [release('0.8.0', '2026-11-30'), ...FEED.releases] };
    const model = newsPanelModel({ news: null, feed }, NOW, 'eng', DESKTOP);
    expect(model.releases.map((shown) => shown.version)).toEqual(['0.8.0', '0.7.0', '0.6.0']);
    expect(model.releases).toHaveLength(MAX_SHOWN_RELEASES);
    expect(model.releases[0]?.url).toBe('https://site.test/releases/0.8.0/');
    expect(model.entries).toEqual([]);
  });

  it('carries an entry in the language with its link and start', () => {
    const startsAt = new Date(NOW + 30 * MINUTE_MS).toISOString();
    const news = {
      schema: 1 as const,
      entries: [
        {
          title: { eng: 'Showmatch', pol: 'Pokaz' },
          link: { url: 'https://stream.test/', label: { eng: 'Watch' } },
          startsAt,
        },
      ],
    };
    expect(newsPanelModel({ news, feed: null }, NOW, 'pol', DESKTOP).entries).toEqual([
      {
        key: 0,
        title: 'Pokaz',
        text: null,
        link: { url: 'https://stream.test/', label: 'Watch' },
        startsAt: Date.parse(startsAt),
        identity: expect.any(String),
      },
    ]);
  });

  it('is empty when nothing loaded or nothing shows', () => {
    expect(panelIsEmpty(newsPanelModel({ news: null, feed: null }, NOW, 'eng', DESKTOP))).toBe(true);
    const ended = { schema: 1 as const, entries: [entry('ended', { until: '2026-11-01T00:00:00Z' })] };
    expect(panelIsEmpty(newsPanelModel({ news: ended, feed: null }, NOW, 'eng', DESKTOP))).toBe(true);
  });
});

describe('unseen column content', () => {
  const news = (...entries: readonly NewsEntry[]) => ({ schema: 1 as const, entries });
  const newsMarks = (entries: readonly NewsEntry[], lang: 'eng' | 'pol' = 'eng') =>
    newsColumnMarks(newsPanelModel({ news: news(...entries), feed: null }, NOW, lang, DESKTOP));
  const versionMarks = (feed: ReleaseFeed, build = DESKTOP) =>
    versionsColumnMarks(newsPanelModel({ news: null, feed }, NOW, 'eng', build));

  it('counts a new entry, not one that left or another language', () => {
    const seen = newsMarks([entry('Patch'), entry('Cup', { startsAt: '2026-11-26T18:00:00Z' })]);
    const translated = { title: { eng: 'Patch', pol: 'Łatka' } };
    expect(hasUnseen(newsMarks([translated], 'pol'), seen)).toBe(false);
    expect(
      hasUnseen(newsMarks([entry('Patch'), entry('Cup', { startsAt: '2026-11-27T18:00:00Z' })]), seen),
    ).toBe(true);
    expect(hasUnseen(newsMarks([entry('Patch'), entry('Survey')]), seen)).toBe(true);
  });

  it('counts a newer release or update notice, not an older release leaving', () => {
    const seen = versionMarks(FEED);
    expect(hasUnseen(versionMarks({ ...FEED, releases: FEED.releases.slice(0, 1) }), seen)).toBe(false);
    expect(
      hasUnseen(
        versionMarks({ ...FEED, releases: [release('0.8.0', '2026-11-30'), ...FEED.releases] }),
        seen,
      ),
    ).toBe(true);
    expect(hasUnseen(versionMarks(FEED, { version: '0.7.0', browser: false }), seen)).toBe(false);
  });
});
