import { describe, expect, it } from 'vitest';
import {
  NEWS_MAX_ENTRIES,
  NEWS_TITLE_MAX_CHARS,
  type NewsEntry,
  validateNewsDocument,
  validateReleaseFeed,
  validateServedNewsDocument,
} from '../../src/index.js';

const ENTRY = {
  title: { eng: ' Showmatch tonight ', pol: 'Showmatch dziś wieczorem' },
  text: { eng: 'Two clans, one island.', pol: 'Dwa klany, jedna wyspa.' },
  link: { url: 'https://example.org/stream', label: { eng: 'Watch', pol: 'Oglądaj' } },
  startsAt: '2026-11-25T19:00+01:00',
  until: '2026-11-25T23:00:00.000Z',
};

const document = (...entries: readonly unknown[]) => ({ schema: 1, entries });
const withEntry = (change: Readonly<Record<string, unknown>>) => document({ ...ENTRY, ...change });

describe('news document', () => {
  it('accepts a full entry and trims its texts', () => {
    const result = validateNewsDocument(document(ENTRY, { title: { eng: 'Undated', pol: 'Bez daty' } }));
    expect(result.ok).toBe(true);
    const first: NewsEntry | undefined = result.ok ? result.value.entries[0] : undefined;
    expect(first?.title.eng).toBe('Showmatch tonight');
  });

  it('refuses each malformed field with its path', () => {
    const cases: readonly [unknown, string][] = [
      [withEntry({ title: { pol: 'Tylko po polsku' } }), 'entries.0.title.eng'],
      [withEntry({ title: { eng: 'English only' } }), 'entries.0.title.pol'],
      [withEntry({ titel: { eng: 'Typo', pol: 'Literówka' } }), 'entries.0'],
      [withEntry({ title: { eng: 'x', pol: 'x', fra: 'y' } }), 'entries.0.title'],
      [withEntry({ title: { eng: '   ', pol: 'x' } }), 'entries.0.title.eng'],
      [withEntry({ title: { eng: 'x'.repeat(NEWS_TITLE_MAX_CHARS + 1), pol: 'x' } }), 'entries.0.title.eng'],
      [withEntry({ startsAt: '2026-11-25T19:00:00' }), 'entries.0.startsAt'],
      [withEntry({ startsAt: '2026-02-30T19:00+01:00' }), 'entries.0.startsAt'],
      [withEntry({ until: '2026-11-25T18:00:00Z' }), 'entries.0.until'],
      [withEntry({ link: { url: 'http://example.org/stream' } }), 'entries.0.link.url'],
      [withEntry({ link: { url: '/stream' } }), 'entries.0.link.url'],
      [document(...Array.from({ length: NEWS_MAX_ENTRIES + 1 }, () => ENTRY)), 'entries'],
      [{ schema: 2, entries: [] }, 'schema'],
    ];
    for (const [raw, path] of cases) {
      const result = validateNewsDocument(raw);
      expect(result.ok ? 'accepted' : result.reason.split(': ', 1)[0]).toBe(path);
    }
  });

  it('reads a served document that grew a field or a language, without them', () => {
    const grown = document({
      ...ENTRY,
      image: 'https://example.org/a.png',
      title: { ...ENTRY.title, fra: 'Ce soir' },
    });
    expect(validateNewsDocument(grown).ok).toBe(false);
    const served = validateServedNewsDocument(grown);
    expect(served.ok && served.value.entries[0]).toEqual({
      ...ENTRY,
      title: { eng: 'Showmatch tonight', pol: 'Showmatch dziś wieczorem' },
    });
  });
});

describe('release feed', () => {
  it('reads the site feed and drops keys a newer site adds', () => {
    const result = validateReleaseFeed({
      schema: 1,
      download: { en: 'https://opennorthland.org/download/', pl: 'https://opennorthland.org/pl/download/' },
      releases: [
        {
          version: '0.7.0',
          date: '2026-11-14',
          url: { en: 'https://opennorthland.org/releases/0.7.0/' },
          title: 'added later',
        },
      ],
    });
    expect(result.ok && result.value.releases[0]).toEqual({
      version: '0.7.0',
      date: '2026-11-14',
      url: { en: 'https://opennorthland.org/releases/0.7.0/' },
    });
  });

  it('refuses a release without an English page or with a bad date', () => {
    const feed = (release: unknown) => ({
      schema: 1,
      download: { en: 'https://opennorthland.org/download/' },
      releases: [release],
    });
    expect(validateReleaseFeed(feed({ version: '0.7.0', date: '2026-11-14', url: {} })).ok).toBe(false);
    expect(
      validateReleaseFeed(feed({ version: '0.7.0', date: '14.11.2026', url: { en: 'https://a.org/' } })).ok,
    ).toBe(false);
  });
});
