// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type MenuNews,
  newsPanelModel,
  versionsColumnMarks,
} from '../../../../src/entries/main-menu/news/model.js';
import { mountNewsPanel, type NewsColumnStore } from '../../../../src/entries/main-menu/news/panel.js';
import type { MenuNewsColumns } from '../../../../src/view/settings/store.js';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const NEWS: MenuNews = {
  news: {
    schema: 1,
    entries: [
      { title: { eng: 'Notes' } },
      {
        title: { eng: 'Showmatch', pol: 'Pokaz' },
        link: { url: 'https://stream.test/' },
        startsAt: '2026-11-25T19:00:00+01:00',
      },
    ],
  },
  feed: {
    schema: 1,
    download: { en: 'https://site.test/download/' },
    releases: [{ version: '0.7.0', date: '2026-11-14', url: { en: 'https://site.test/releases/0.7.0/' } }],
  },
};

class NoResizes {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => vi.stubGlobal('ResizeObserver', NoResizes));
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const EXPANDED: MenuNewsColumns = {
  news: { collapsed: false, seen: [] },
  versions: { collapsed: false, seen: [] },
};

function memoryStore(initial: MenuNewsColumns): NewsColumnStore & { columns: MenuNewsColumns } {
  const store = {
    columns: initial,
    read: () => store.columns,
    write: (columns: MenuNewsColumns) => {
      store.columns = columns;
    },
  };
  return store;
}

async function mounted(
  news: MenuNews,
  store = memoryStore(EXPANDED),
): Promise<{ host: HTMLElement; dispose: () => void }> {
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = mountNewsPanel(host, Promise.resolve(news), () => NOW, store);
  await Promise.resolve();
  return { host, dispose };
}

function heading(host: HTMLElement, column: string): HTMLButtonElement {
  const button = host.querySelector(`.main-menu__news-${column} > .main-menu__news-heading`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`no ${column} heading`);
  return button;
}

const dotShown = (button: HTMLElement): boolean =>
  button.querySelector<HTMLElement>('.main-menu__news-unseen')?.hidden === false;

describe('news panel', () => {
  it('lists the entries and the releases under their headings and opens every link outside the game', async () => {
    const { host, dispose } = await mounted(NEWS);
    const titles = [...host.querySelectorAll('.main-menu__news-title')].map((node) => node.textContent);
    expect(titles).toEqual(['Pokaz', 'Notes']);
    const headings = [...host.querySelectorAll('.main-menu__news-column > .main-menu__news-heading')];
    expect(headings.map((shown) => shown.textContent)).toEqual(['Nowości', 'Ostatnie wersje']);
    const links = [...host.querySelectorAll('a')];
    expect(links.map((link) => link.textContent)).toEqual(['Więcej', 'Lista zmian']);
    for (const link of links) expect([link.target, link.rel]).toEqual(['_blank', 'noopener noreferrer']);
    dispose();
  });

  it('shows nothing without anything to show, or after the screen left', async () => {
    const empty = await mounted({ news: null, feed: null });
    expect(empty.host.childElementCount).toBe(0);
    const host = document.createElement('div');
    mountNewsPanel(host, Promise.resolve(NEWS), () => NOW, memoryStore(EXPANDED))();
    await Promise.resolve();
    expect(host.childElementCount).toBe(0);
  });

  it('folds a column from its heading and remembers it, keeping what the player saw', async () => {
    const store = memoryStore(EXPANDED);
    const { host, dispose } = await mounted(NEWS, store);
    const news = heading(host, 'entries');
    const body = document.getElementById(news.getAttribute('aria-controls') ?? '');
    expect([news.getAttribute('aria-expanded'), body?.hidden]).toEqual(['true', false]);
    const seen = store.columns.news.seen;
    expect(seen).toHaveLength(NEWS.news?.entries.length ?? 0);

    news.click();
    expect([news.getAttribute('aria-expanded'), body?.hidden, news.title]).toEqual(['false', true, 'Pokaż']);
    expect(store.columns.news).toEqual({ collapsed: true, seen });
    expect(store.columns.versions.collapsed).toBe(false);
    expect(dotShown(news)).toBe(false);
    news.click();
    expect([body?.hidden, store.columns.news.collapsed]).toEqual([false, false]);
    dispose();
  });

  it('marks a folded column that holds something the player has not seen', async () => {
    const olderFeed = {
      schema: 1 as const,
      download: { en: 'https://site.test/download/' },
      releases: [{ version: '0.6.0', date: '2026-11-05', url: { en: 'https://site.test/releases/0.6.0/' } }],
    };
    const seenBefore = versionsColumnMarks(
      newsPanelModel({ news: null, feed: olderFeed }, NOW, 'pol', { version: '0.6.0', browser: true }),
    );
    const store = memoryStore({ ...EXPANDED, versions: { collapsed: true, seen: seenBefore } });
    const { host, dispose } = await mounted(NEWS, store);
    const versions = heading(host, 'versions');
    expect(dotShown(versions)).toBe(true);
    expect(versions.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Nowe');
    versions.click();
    expect(dotShown(versions)).toBe(false);
    expect(store.columns.versions.seen).not.toEqual(seenBefore);
    dispose();
  });
});
