import { describe, expect, it } from 'vitest';
import { loadMenuNews, type NewsSourceEnv } from '../../../../src/entries/main-menu/news/source.js';

const NEWS = { schema: 1, entries: [{ title: { eng: 'Showmatch' } }] };
const FEED = {
  schema: 1,
  download: { en: 'https://site.test/download/' },
  releases: [{ version: '0.7.0', date: '2026-11-14', url: { en: 'https://site.test/releases/0.7.0/' } }],
};
const HTTP_NOT_FOUND = 404;

function env(
  answers: Readonly<Record<string, () => Response>>,
  options: { readonly search?: string; readonly automated?: boolean } = {},
): NewsSourceEnv & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    search: options.search ?? '',
    automated: options.automated ?? false,
    fetch: async (input) => {
      const url = String(input);
      asked.push(url);
      const answer = Object.entries(answers).find(([suffix]) => url.endsWith(suffix))?.[1];
      if (answer === undefined) throw new TypeError('offline');
      return answer();
    },
  };
}

describe('menu news sources', () => {
  it('reads both sources from the URL overrides', async () => {
    const sources = env(
      { '/v1/news': () => Response.json(NEWS), '/releases/feed.json': () => Response.json(FEED) },
      { search: '?api=http://127.0.0.1:9/&site=http://127.0.0.1:8/' },
    );
    const loaded = await loadMenuNews(new AbortController().signal, sources);
    expect(sources.asked).toEqual(['http://127.0.0.1:9/v1/news', 'http://127.0.0.1:8/releases/feed.json']);
    expect(loaded.news?.entries).toHaveLength(1);
    expect(loaded.feed?.releases[0]?.version).toBe('0.7.0');
  });

  it('leaves out only the part that failed or did not validate', async () => {
    const missing = await loadMenuNews(
      new AbortController().signal,
      env({
        '/v1/news': () => new Response('', { status: HTTP_NOT_FOUND }),
        '/releases/feed.json': () => Response.json(FEED),
      }),
    );
    expect(missing.news).toBeNull();
    expect(missing.feed).not.toBeNull();
    const invalid = await loadMenuNews(
      new AbortController().signal,
      env({
        '/v1/news': () => Response.json(NEWS),
        '/releases/feed.json': () => Response.json({ schema: 2 }),
      }),
    );
    expect(invalid.news).not.toBeNull();
    expect(invalid.feed).toBeNull();
  });

  it('under automation asks only the sources the URL names', async () => {
    const unnamed = env({}, { automated: true });
    expect(await loadMenuNews(new AbortController().signal, unnamed)).toEqual({ news: null, feed: null });
    expect(unnamed.asked).toEqual([]);
    const apiOnly = env(
      { '/v1/news': () => Response.json(NEWS) },
      { automated: true, search: '?api=http://127.0.0.1:9' },
    );
    await loadMenuNews(new AbortController().signal, apiOnly);
    expect(apiOnly.asked).toEqual(['http://127.0.0.1:9/v1/news']);
  });
});
