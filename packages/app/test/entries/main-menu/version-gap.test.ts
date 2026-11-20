// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { versionGapCard } from '../../../src/entries/main-menu/version-gap.js';
import { messages } from '../../../src/i18n/index.js';
import { downloadPage } from '../../../src/update/outdated.js';

const pl = messages('pol');

it('sends an older desktop game to the download page, naming the version it needs', () => {
  const card = versionGapCard(
    { kind: 'outdated', required: '0.8.0' },
    'relay',
    { version: '0.7.0', web: false },
    pl,
  );
  expect([...card.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual(['0.7.0', '0.8.0']);
  const link = card.querySelector('a');
  expect(link?.textContent).toBe('Pobierz wersję 0.8.0');
  expect(link?.getAttribute('href')).toBe(downloadPage());
  expect(link?.target).toBe('_blank');
  expect(card.querySelector('button')).toBeNull();
});

it('offers no step to a game newer than its server, and words a version the server did not name', () => {
  const card = versionGapCard({ kind: 'ahead', server: null }, 'relay', { version: '0.8.0', web: true }, pl);
  expect(card.querySelector('h3')?.textContent).toBe(pl.versionGap.relayAheadTitle);
  expect([...card.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual([
    '0.8.0',
    pl.versionGap.older,
  ]);
  expect(card.querySelector('button, a')).toBeNull();
});

it('leaves the version out of the catalogue download link, whose release may trail the newest one', () => {
  const card = versionGapCard(
    { kind: 'outdated', required: '0.8.0' },
    'catalogue',
    { version: '0.7.0', web: false },
    pl,
  );
  expect(card.querySelector('a')?.textContent).toBe(pl.versionGap.downloadUnnamed);
});
