// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuNews } from '../../../../src/entries/main-menu/news/model.js';
import { mountNewsPanel } from '../../../../src/entries/main-menu/news/panel.js';

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

async function mounted(news: MenuNews): Promise<{ host: HTMLElement; dispose: () => void }> {
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = mountNewsPanel(host, Promise.resolve(news), () => NOW);
  await Promise.resolve();
  return { host, dispose };
}

describe('news panel', () => {
  it('lists the entries and the releases under their headings and opens every link outside the game', async () => {
    const { host, dispose } = await mounted(NEWS);
    const titles = [...host.querySelectorAll('.main-menu__news-title')].map((node) => node.textContent);
    expect(titles).toEqual(['Pokaz', 'Notes']);
    const headings = [...host.querySelectorAll('.main-menu__news-column > .main-menu__news-heading')];
    expect(headings.map((heading) => heading.textContent)).toEqual(['Nowości', 'Ostatnie wersje']);
    const links = [...host.querySelectorAll('a')];
    expect(links.map((link) => link.textContent)).toEqual(['Więcej', 'Lista zmian']);
    for (const link of links) expect([link.target, link.rel]).toEqual(['_blank', 'noopener noreferrer']);
    dispose();
  });

  it('shows nothing without anything to show, or after the screen left', async () => {
    const empty = await mounted({ news: null, feed: null });
    expect(empty.host.childElementCount).toBe(0);
    const host = document.createElement('div');
    mountNewsPanel(host, Promise.resolve(NEWS), () => NOW)();
    await Promise.resolve();
    expect(host.childElementCount).toBe(0);
  });
});
