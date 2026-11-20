// @vitest-environment jsdom
import { CATALOG_GAME_VERSION_HEADER, catalogBrowseEntry } from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as mapList from '../../../../src/content/map/maps-index.js';
import * as sources from '../../../../src/content/map-source/index.js';
import { CARDS_PER_BATCH } from '../../../../src/entries/main-menu/catalogue/card-batches.js';
import { catalogueView, initialCatalogueMemory } from '../../../../src/entries/main-menu/catalogue/view.js';
import { messages } from '../../../../src/i18n/index.js';
import { API, catalogEntry, catalogServer, memoryInstalledStorage } from '../../../support/catalog-maps.js';

const entries = Array.from({ length: 40 }, (_, i) => catalogEntry(`cn-${String(i).padStart(2, '0')}`));
const disposals: (() => void)[] = [];
async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(sources, 'installedMapStore').mockReturnValue(null);
  vi.spyOn(mapList, 'loadMapList').mockResolvedValue([]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v1/catalog') return Response.json(entries.map(catalogBrowseEntry));
      const entry = entries.find((entry) => path === `/v1/maps/${entry.id}`);
      return entry === undefined ? new Response(null, { status: 404 }) : Response.json(entry);
    }),
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function mounted(memory = initialCatalogueMemory()) {
  const view = catalogueView({ memory, purpose: 'play', onPick: () => {} });
  disposals.push(view.dispose);
  document.body.append(view.tabs, view.body);
  await settle();
  return { view, memory, grid: view.body.querySelector('.catalogue__grid') as HTMLElement };
}
it('yields between card batches and preserves keyboard selection of a card not yet rendered', async () => {
  const { grid, memory } = await mounted();
  expect(grid.children).toHaveLength(CARDS_PER_BATCH);
  expect(grid.getAttribute('aria-busy')).toBe('true');
  const first = grid.firstElementChild as HTMLElement;
  first.focus();
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  expect(memory.selectedId).toBe('cn-39');
  await vi.runAllTimersAsync();
  expect(grid.children).toHaveLength(entries.length);
  expect(grid.getAttribute('aria-busy')).toBe('false');
  expect(document.activeElement?.getAttribute('data-entry-id')).toBe('cn-39');
  expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
});
it('cancels obsolete query batches and stops rendering after disposal', async () => {
  const { view, grid } = await mounted();
  const input = view.body.querySelector('input[type="search"]') as HTMLInputElement;
  input.value = 'cn-39';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.runAllTimersAsync();
  expect([...grid.children].map((node) => node.getAttribute('data-entry-id'))).toEqual(['cn-39']);
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(grid.children).toHaveLength(CARDS_PER_BATCH);
  view.dispose();
  await vi.runAllTimersAsync();
  expect(grid.children).toHaveLength(CARDS_PER_BATCH);
});
it('ignores detail responses arriving after another entry is selected', async () => {
  let resolveFirst = (_response: Response) => {};
  const fetchEntry = vi.spyOn(sources, 'fetchCatalogEntry').mockImplementation(async (_api, id) => {
    if (id === 'cn-00')
      return new Promise((resolve) => {
        resolveFirst = async (response) => resolve(await response.json());
      });
    const entry = entries.find((entry) => entry.id === id);
    return entry ?? null;
  });
  const { view, grid } = await mounted();
  (grid.children[1] as HTMLElement).click();
  await settle();
  resolveFirst(Response.json({ ...entries[0], title: 'Obsolete title' }));
  await settle();
  expect(view.body.querySelector('.catalogue-detail__title')?.textContent).toBe('cn-01');
  (grid.firstElementChild as HTMLElement).click();
  await settle();
  expect(fetchEntry.mock.calls.filter(([, id]) => id === 'cn-00')).toHaveLength(2);
});
it('retries a failed detail load when the selected card is opened again', async () => {
  const fetchEntry = vi
    .spyOn(sources, 'fetchCatalogEntry')
    .mockRejectedValueOnce(new Error('detail temporarily unavailable'))
    .mockResolvedValue(entries[0] ?? null);
  const { view, grid } = await mounted();
  expect(view.body.querySelector('.catalogue-detail__status')?.textContent).toBe(
    'detail temporarily unavailable',
  );
  (grid.firstElementChild as HTMLElement).click();
  await settle();
  expect(fetchEntry).toHaveBeenCalledTimes(2);
  expect(view.body.querySelector('.catalogue-detail__status')?.textContent).not.toBe(
    'detail temporarily unavailable',
  );
});
it('cancels remaining browse batches when switching to the installed tab', async () => {
  const { view, grid } = await mounted();
  expect(grid.children).toHaveLength(CARDS_PER_BATCH);
  (view.tabs.children[1] as HTMLElement).click();
  await vi.runAllTimersAsync();
  expect(grid.children).toHaveLength(CARDS_PER_BATCH);
  expect(grid.getAttribute('aria-busy')).toBe('false');
});

it('shows a first storage failure without claiming the library is empty, then retries', async () => {
  const store = sources.createInstalledMapStore(memoryInstalledStorage().storage, { budget: null });
  vi.spyOn(sources, 'installedMapStore').mockReturnValue(store);
  vi.spyOn(store, 'list').mockRejectedValueOnce(new Error('blocked'));
  const { view } = await mounted();
  (view.tabs.children[1] as HTMLElement).click();
  expect(view.tabs.textContent).toContain(messages().mapCatalogue.storage.installed);
  expect(view.tabs.textContent).not.toContain('(0)');
  expect(view.body.querySelector('.catalogue-installed')?.hasAttribute('hidden')).toBe(true);
  expect(view.body.querySelector('.catalogue__storage-notice')?.textContent).toContain(
    messages().mapCatalogue.storage.failed,
  );
  expect((view.body.querySelector('.catalogue__main') as HTMLElement).inert).toBe(true);
  (view.body.querySelector('.catalogue__storage-notice button') as HTMLButtonElement).click();
  await settle();
  expect(view.tabs.textContent).toContain('(0)');
  expect((view.body.querySelector('.catalogue__main') as HTMLElement).inert).toBe(false);
  expect(view.body.querySelector('.catalogue-installed')?.textContent).toContain(
    messages().mapCatalogue.installedView.none,
  );
});

it.each(['list', 'sources'] as const)(
  'keeps the previous library when %s fails after a removal and recovers on retry',
  async (method) => {
    const backing = memoryInstalledStorage();
    const store = sources.createInstalledMapStore(backing.storage, { budget: null });
    await sources.installCatalogEntry(catalogEntry('cn-00'), {
      api: API,
      store,
      fetchImpl: catalogServer(entries),
    });
    vi.spyOn(sources, 'installedMapStore').mockReturnValue(store);
    const { view } = await mounted();
    (view.tabs.children[1] as HTMLElement).click();
    expect(view.tabs.textContent).toContain('(1)');
    vi.spyOn(store, method).mockRejectedValueOnce(new Error('temporary read failure'));
    const remove = [...view.body.querySelectorAll<HTMLButtonElement>('.catalogue-installed button')].find(
      (button) => button.textContent === messages().mapCatalogue.remove,
    );
    expect(remove).toBeDefined();
    remove?.click();
    await settle();
    expect(view.tabs.textContent).toContain('(1)');
    expect(view.body.querySelector('.catalogue-installed__row')?.getAttribute('data-entry-id')).toBe('cn-00');
    expect((view.body.querySelector('.catalogue__main') as HTMLElement).inert).toBe(true);
    expect(view.body.querySelector('.catalogue__storage-notice')?.textContent).toContain(
      messages().mapCatalogue.storage.failedPrevious,
    );
    (view.body.querySelector('.catalogue__storage-notice button') as HTMLButtonElement).click();
    await settle();
    expect(view.tabs.textContent).toContain('(0)');
    expect((view.body.querySelector('.catalogue__main') as HTMLElement).inert).toBe(false);
  },
);

it('prevents dropped files from navigating away while storage is unavailable', async () => {
  const store = sources.createInstalledMapStore(memoryInstalledStorage().storage, { budget: null });
  vi.spyOn(sources, 'installedMapStore').mockReturnValue(store);
  vi.spyOn(store, 'list').mockRejectedValue(new Error('blocked'));
  const readSource = vi.spyOn(store, 'readSource');
  const { view } = await mounted();
  const transfer = { types: ['Files'], dropEffect: 'copy' };
  for (const type of ['dragenter', 'dragover', 'drop']) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    view.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  expect(transfer.dropEffect).toBe('none');
  expect(view.body.classList.contains('is-file-drop')).toBe(false);
  expect(view.body.querySelector('.catalogue-import')?.hasAttribute('hidden')).toBe(true);
  expect(readSource).not.toHaveBeenCalled();
});

it('keeps the remembered browse selection while catalogue and storage load', async () => {
  const memory = initialCatalogueMemory();
  memory.selectedId = 'cn-39';
  const { grid } = await mounted(memory);
  expect(memory.selectedId).toBe('cn-39');
  await vi.runAllTimersAsync();
  expect(grid.querySelector('.is-selected')?.getAttribute('data-entry-id')).toBe('cn-39');
});

it('keeps the remembered installed selection until the library loads', async () => {
  const store = sources.createInstalledMapStore(memoryInstalledStorage().storage, { budget: null });
  await sources.installCatalogEntry(catalogEntry('cn-01'), {
    api: API,
    store,
    fetchImpl: catalogServer(entries),
  });
  await sources.installCatalogEntry(catalogEntry('cn-00'), {
    api: API,
    store,
    fetchImpl: catalogServer(entries),
  });
  vi.spyOn(sources, 'installedMapStore').mockReturnValue(store);
  const memory = initialCatalogueMemory();
  memory.tab = 'installed';
  memory.selectedId = 'cn-01';
  const { view } = await mounted(memory);
  expect(memory.selectedId).toBe('cn-01');
  expect(view.body.querySelector('.catalogue-installed .is-selected')?.getAttribute('data-entry-id')).toBe(
    'cn-01',
  );
});
it('names the release the catalogue maps need when they were converted for a newer game', async () => {
  const newer = entries.slice(0, 2).map((entry) => {
    const browse = catalogBrowseEntry(entry);
    const conversion = browse.conversion;
    if (conversion?.verdict !== 'ok') throw new Error('fixture entry is not converted');
    return { ...browse, conversion: { ...conversion, irVersion: IR_VERSION + 1 } };
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(newer, { headers: { [CATALOG_GAME_VERSION_HEADER]: '0.9.0' } })),
  );
  const { view } = await mounted();
  const notice = view.body.querySelector('.catalogue__version-notice');
  expect(notice?.textContent).toContain('0.9.0');
  const button = notice?.querySelector('button');
  expect(button?.textContent).toBe(messages().versionGap.reload);
  // A search repaints the grid, not the unchanged notice the live region already read out.
  const input = view.body.querySelector('input[type="search"]') as HTMLInputElement;
  input.value = 'mapa';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(notice?.querySelector('button')).toBe(button);
});
