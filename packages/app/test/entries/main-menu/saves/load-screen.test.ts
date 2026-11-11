// @vitest-environment jsdom
import { exportSaveGame, serializeSaveGame } from '@open-northland/sim';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadScreen } from '../../../../src/entries/main-menu/saves/load-screen.js';
import { runDemoWorld } from '../../../../src/game/world/index.js';
import { messages } from '../../../../src/i18n/index.js';
import * as storeBrowser from '../../../../src/view/runtime/save-load/store-browser.js';
import * as worldNames from '../../../../src/view/runtime/save-load/world-names.js';

// jsdom lays nothing out, so it has no scrolling to do.
const scrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it('refuses a save of another content version before handing it to its entry', async () => {
  const save = exportSaveGame(runDemoWorld(7, 2), { mapId: 'forest', entry: '?map=forest' });
  const older = { ...save, header: { ...save.header, irVersion: save.header.irVersion - 1 } };
  // A plain JSON save loads as a gzipped one does; jsdom's Blob cannot stream into a compressor.
  const bytes = new TextEncoder().encode(serializeSaveGame(older));
  vi.spyOn(storeBrowser, 'browserSaveStore').mockReturnValue({
    list: async () => [
      {
        id: 'old',
        name: 'old',
        mapId: 'forest',
        tick: 0,
        entry: null,
        savedAt: 1,
        seed: 1,
        thumbnail: null,
      },
    ],
    read: async () => bytes,
    write: async () => undefined,
    remove: async () => undefined,
  });
  vi.spyOn(worldNames, 'worldNameIndex').mockResolvedValue(() => null);
  const launch = vi.fn();
  const screen = loadScreen(() => undefined, launch);
  document.body.append(screen.element);
  const load = [...screen.element.querySelectorAll('button')].find(
    (button) => button.textContent === messages().saveList.load,
  );
  await vi.waitFor(() => expect(load?.disabled).toBe(false));
  load?.click();
  const status = screen.element.querySelector('.on-saves__status');
  await vi.waitFor(() => expect(status?.textContent).toBe(messages().hud.loadErrors.wrongContent));
  expect(launch).not.toHaveBeenCalled();
  screen.dispose?.();
});
