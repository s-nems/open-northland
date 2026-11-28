// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSystemMenu, type SystemMenu } from '../../../../src/hud/dom/system/menu.js';
import { currentLocale, formatMessage, messages, setActiveLocale } from '../../../../src/i18n/index.js';
import type { GameSettingsRuntime } from '../../../../src/view/runtime/game-settings.js';
import type { SaveLoadSession } from '../../../../src/view/runtime/save-load/index.js';
import type { SaveSlotInfo } from '../../../../src/view/runtime/save-load/store.js';
import {
  defaultSettings,
  patchStoredSettings,
  readStoredSettings,
} from '../../../../src/view/settings/store.js';

const HERE = 'here';
const ELSEWHERE = 'elsewhere';

let menu: SystemMenu | null = null;
const locale = currentLocale();
beforeEach(() => {
  setActiveLocale('eng');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback, 0));
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(() => {
  menu?.dispose();
  menu = null;
  document.body.replaceChildren();
  localStorage.clear();
  setActiveLocale(locale);
  vi.unstubAllGlobals();
});

const SEED = 7;
/** The window redraws after async list reads; poll every millisecond, not Vitest's default 50. */
const POLL_MS = 1;
const settle = <T>(check: () => T): Promise<T> => vi.waitFor(check, { interval: POLL_MS });

function slot(name: string, savedAt: number, mapId = HERE, seed = SEED): SaveSlotInfo {
  return { id: name, name, mapId, tick: 600, entry: null, savedAt, seed, thumbnail: null };
}

function mount(initial: SaveSlotInfo[], settingsOverride?: GameSettingsRuntime) {
  let slots = [...initial];
  let clock = 1000;
  const saveLoad: SaveLoadSession = {
    canSaveReplay: false,
    listReplays: async () => [],
    saveReplay: async () => ({ kind: 'failed' }),
    worldToken: HERE,
    worldSeed: SEED,
    listSaves: async () => [...slots].sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0)),
    saveGame: vi.fn(async (name: string) => {
      slots = [...slots.filter((s) => s.name !== name), slot(name, ++clock)];
      return { kind: 'saved' } as const;
    }),
    stageForReload: async () => undefined,
    loadSave: vi.fn(async () => ({ kind: 'loading' }) as const),
    loadFromFile: async () => ({ kind: 'cancelled' }),
    exportSave: vi.fn(async () => ({ kind: 'saved' }) as const),
    deleteSave: vi.fn(async (id: string) => {
      slots = slots.filter((s) => s.id !== id);
    }),
    forcePause: () => undefined,
    releaseForcedPause: () => undefined,
  };
  const settings: GameSettingsRuntime = {
    current: defaultSettings,
    pinnedUiScale: null,
    bootOwnedChangesDeferred: true,
    inGame: true,
    effectiveUiScaleFor: (factor) => factor,
    update: async () => true,
  };
  menu = createSystemMenu({
    saveLoad,
    settings: settingsOverride ?? settings,
    hud: { element: document.createElement('div'), currentScale: () => 1 },
    onQuit: () => undefined,
    setCameraSuspended: () => undefined,
  });
  return { menu, saveLoad };
}

function button(label: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(
    (el) => el.textContent?.trim() === label || el.getAttribute('aria-label') === label,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return found;
}
const page = (modifier: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`.on-saves--${modifier}`);
  if (found === null) throw new Error(`Missing ${modifier} window`);
  return found;
};
/** Rows the player can see: matched by the search, in an open game. */
const rowNames = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLElement>('.on-saves__row')]
    .filter((row) => row.closest('[hidden]') === null)
    .map((row) => row.querySelector('.on-saves__name')?.textContent ?? '');
const groupHeads = (root: HTMLElement): HTMLButtonElement[] => [
  ...root.querySelectorAll<HTMLButtonElement>('.on-saves__group-head'),
];
const press = (target: Element | null | undefined, key: string): void => {
  target?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};
const selectedName = (root: HTMLElement): string | null =>
  root.querySelector('.on-saves__row.is-selected .on-saves__name')?.textContent ?? null;
const question = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[role="alertdialog"]');
  if (found === null) throw new Error('Missing confirmation');
  return found;
};

describe('save window', () => {
  it('edits the global autosave interval in Save Game and remembers it when reopened', async () => {
    const settings: GameSettingsRuntime = {
      current: readStoredSettings,
      update: async (patch) => {
        patchStoredSettings(patch);
        return true;
      },
      pinnedUiScale: null,
      bootOwnedChangesDeferred: true,
      inGame: true,
      effectiveUiScaleFor: (factor) => factor,
    };
    const first = mount([], settings);
    first.menu.openPage('save');
    const save = page('save');
    const options = [
      ...save.querySelectorAll<HTMLButtonElement>(
        '.on-saves__auto-options:not(.on-saves__auto-count) button',
      ),
    ];
    expect(options).toHaveLength(5);
    expect(options[0]?.getAttribute('aria-pressed')).toBe('true');
    options[3]?.focus();
    options[3]?.click();
    await Promise.resolve();
    expect(readStoredSettings().autosaveMinutes).toBe(15);
    expect(options[3]?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(options[3]);
    first.menu.dispose();
    const next = mount([], settings);
    next.menu.openPage('save');
    expect(
      page('save').querySelector('.on-saves__auto-options:not(.on-saves__auto-count) [aria-pressed="true"]')
        ?.textContent,
    ).toBe(formatMessage(messages().saveList.autosaveEvery, { n: 15 }));
    const counts = [...page('save').querySelectorAll<HTMLButtonElement>('.on-saves__auto-count button')];
    expect(counts.map((choice) => choice.textContent)).toEqual(['1', '2', '3']);
    expect(counts[0]?.getAttribute('aria-pressed')).toBe('true');
    counts[2]?.click();
    await Promise.resolve();
    expect(readStoredSettings().autosaveCount).toBe(3);
    expect(counts[2]?.getAttribute('aria-pressed')).toBe('true');
    expect(counts[0]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('offers a free name, saves it, and exports the written slot from the same window', async () => {
    const copy = messages().saveList;
    const { menu, saveLoad } = mount([slot('here - Save 2', 5)]);
    menu.openPage('save');
    const save = page('save');
    const input = save.querySelector('input');
    await settle(() => expect(input?.value).toBe('here - Save 3'));
    expect(document.activeElement).toBe(button(copy.save, save));
    const exportButton = button(copy.export, save);
    expect(exportButton.disabled).toBe(true);

    button(copy.save, save).click();
    await settle(() =>
      expect(save.querySelector('.on-saves__status')?.textContent).toBe(
        formatMessage(copy.savedNamed, { name: 'here - Save 3' }),
      ),
    );
    expect(saveLoad.saveGame).toHaveBeenCalledWith('here - Save 3');
    expect(selectedName(save)).toBe('here - Save 3');
    expect(exportButton.disabled).toBe(false);
    expect(document.activeElement).toBe(exportButton);

    exportButton.click();
    await settle(() => expect(saveLoad.exportSave).toHaveBeenCalledWith('here - Save 3'));
  });

  it('warns before overwriting a listed name and asks with the overwrite focused', async () => {
    const copy = messages().saveList;
    const { menu, saveLoad } = mount([slot('Keep', 5)]);
    menu.openPage('save');
    const save = page('save');
    await settle(() => expect(rowNames(save)).toEqual(['Keep']));
    save.querySelector<HTMLButtonElement>('.on-saves__pick')?.click();
    expect(save.querySelector('input')?.value).toBe('Keep');
    expect(save.querySelector('.on-saves__hint')?.textContent).toBe(copy.overwriteHint);
    const input = save.querySelector('input');
    if (input === null) throw new Error('Missing name field');
    input.value = 'Fresh';
    input.dispatchEvent(new Event('input'));
    expect(selectedName(save)).toBeNull();
    expect(button(copy.export, save).disabled).toBe(true);
    input.value = 'Keep';
    input.dispatchEvent(new Event('input'));
    expect(selectedName(save)).toBe('Keep');

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    // Unhandled, the browser's keypress would click the overwrite button the question just focused.
    expect(enter.defaultPrevented).toBe(true);
    await settle(() => expect(document.activeElement).toBe(button(copy.overwrite, question())));
    button(copy.cancel, question()).click();
    await settle(() => expect(save.querySelector('.on-saves__status')?.textContent).toBe(copy.notSaved));
    expect(saveLoad.saveGame).not.toHaveBeenCalled();
  });

  it('overwrites the selected autosave even when a manual save has the same display name', async () => {
    const copy = messages().saveList;
    const autoId = '/autosave/"here"/1';
    const { menu, saveLoad } = mount([slot('Autosave 1', 9), { ...slot('Autosave 1', 5), id: autoId }]);
    menu.openPage('save');
    const save = page('save');
    await settle(() => expect(rowNames(save)).toEqual(['Autosave 1', 'Autosave 1']));
    save.querySelectorAll<HTMLButtonElement>('.on-saves__pick')[1]?.click();
    button(copy.save, save).click();
    await settle(() => question());
    button(copy.overwrite, question()).click();
    await settle(() => expect(saveLoad.saveGame).toHaveBeenCalledWith(autoId));
  });

  it('deletes through a bin without taking over the name field, then offers a fresh name', async () => {
    const copy = messages().saveList;
    const { menu } = mount([slot('Keep', 5), slot('Drop', 6)]);
    menu.openPage('save');
    const save = page('save');
    const input = save.querySelector('input');
    if (input === null) throw new Error('Missing name field');
    await settle(() => expect(rowNames(save)).toEqual(['Drop', 'Keep']));
    input.value = 'Mine';
    input.dispatchEvent(new Event('input'));
    const bin = button(formatMessage(copy.deleteNamed, { name: 'Keep' }), save);
    bin.focus();
    bin.click();
    await settle(() => question());
    expect(input.value).toBe('Mine');
    button(copy.del, question()).click();
    await settle(() => expect(rowNames(save)).toEqual(['Drop']));
    // The redraw removed the focused bin; focus stays in the window for the keyboard.
    expect(save.contains(document.activeElement)).toBe(true);
    expect(input.value).toBe('Mine');

    input.value = 'Drop';
    input.dispatchEvent(new Event('input'));
    button(formatMessage(copy.deleteNamed, { name: 'Drop' }), save).click();
    await settle(() => question());
    button(copy.del, question()).click();
    await settle(() => expect(rowNames(save)).toEqual([]));
    expect(input.value).toBe('here - Save 1');
  });
});

describe('load window', () => {
  it("preselects the running game's newest save and loads another map's from the same list", async () => {
    const copy = messages().saveList;
    const { menu, saveLoad } = mount([slot('Old', 1), slot('Away', 9, ELSEWHERE), slot('New', 5)]);
    menu.openPage('load');
    const load = page('load');
    // The running game opens first; another map's game stays closed under it.
    await settle(() => expect(rowNames(load)).toEqual(['New', 'Old']));
    expect(selectedName(load)).toBe('New');
    const [mine, away] = groupHeads(load);
    expect(mine?.textContent).toContain(copy.currentGame);
    expect(away?.getAttribute('aria-expanded')).toBe('false');
    expect(away?.querySelector('.on-saves__tag')?.textContent).toBe(copy.otherWorld);
    away?.click();
    expect(rowNames(load)).toEqual(['New', 'Old', 'Away']);

    const rowOf = (name: string) =>
      [...load.querySelectorAll<HTMLButtonElement>('.on-saves__pick')].find((pick) =>
        pick.textContent?.startsWith(name),
      );
    rowOf('Away')?.click();
    expect(button(copy.load, load).disabled).toBe(false);
    // The walk passes each game's head between its rows; a head moves focus, not the selection.
    rowOf('Away')?.focus();
    press(rowOf('Away'), 'ArrowUp');
    expect(document.activeElement).toBe(away);
    expect(selectedName(load)).toBe('Away');
    press(away, 'ArrowUp');
    expect(selectedName(load)).toBe('Old');
    expect(document.activeElement).toBe(rowOf('Old'));
    press(rowOf('Old'), 'Enter');
    await settle(() => question());
    button(copy.load, question()).click();
    await settle(() => expect(saveLoad.loadSave).toHaveBeenCalledWith('Old'));

    rowOf('Away')?.click();
    button(copy.load, load).click();
    await settle(() => question());
    button(copy.load, question()).click();
    await settle(() => expect(saveLoad.loadSave).toHaveBeenCalledWith('Away'));
  });

  it('filters by name or map and deletes a row through its bin after asking', async () => {
    const copy = messages().saveList;
    const { menu, saveLoad } = mount([slot('Harbour', 1), slot('Fjord', 2), slot('Away', 3, ELSEWHERE)]);
    menu.openPage('load');
    const load = page('load');
    await settle(() => expect(rowNames(load)).toEqual(['Fjord', 'Harbour']));
    const search = load.querySelector<HTMLInputElement>('input[type="search"]');
    if (search === null) throw new Error('Missing search');
    search.value = 'elsew';
    search.dispatchEvent(new Event('input'));
    expect(rowNames(load)).toEqual(['Away']);
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    expect(load.querySelector('.on-saves__empty')?.textContent).toContain(
      formatMessage(copy.noMatch, { query: 'zzz' }),
    );
    expect(button(copy.load, load).disabled).toBe(true);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    // The search hid the preselected row; clearing it brings the selection back.
    expect(selectedName(load)).toBe('Fjord');

    button(formatMessage(copy.deleteNamed, { name: 'Harbour' }), load).click();
    await settle(() => question());
    button(copy.del, question()).click();
    await settle(() => expect(rowNames(load)).toEqual(['Fjord']));
    expect(saveLoad.deleteSave).toHaveBeenCalledWith('Harbour');
    expect(load.querySelector('.on-saves__status')?.textContent).toBe(copy.deleted);
  });

  it('never selects a row the search hides, even after a delete under the search', async () => {
    const copy = messages().saveList;
    const { menu } = mount([slot('Harbour', 1), slot('Fjord', 2), slot('Away', 3, ELSEWHERE)]);
    menu.openPage('load');
    const load = page('load');
    await settle(() => expect(rowNames(load)).toEqual(['Fjord', 'Harbour']));
    const search = load.querySelector<HTMLInputElement>('input[type="search"]');
    if (search === null) throw new Error('Missing search');
    search.value = 'harb';
    search.dispatchEvent(new Event('input'));
    button(formatMessage(copy.deleteNamed, { name: 'Harbour' }), load).click();
    await settle(() => question());
    button(copy.del, question()).click();
    await settle(() => expect(rowNames(load)).toEqual([]));
    expect(selectedName(load)).toBeNull();
    expect(button(copy.load, load).disabled).toBe(true);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    expect(selectedName(load)).toBe('Fjord');
    expect(button(copy.load, load).disabled).toBe(false);
  });

  it('groups each game on a map, numbers them, and opens and closes them from the keyboard', async () => {
    const copy = messages().saveList;
    const OTHER_SEED = 9;
    const { menu } = mount([
      slot('Early', 1, HERE, OTHER_SEED),
      slot('Later', 4, HERE, OTHER_SEED),
      slot('Mine', 3),
    ]);
    menu.openPage('load');
    const load = page('load');
    await settle(() => expect(rowNames(load)).toEqual(['Mine']));
    const [mine, earlier] = groupHeads(load);
    expect(mine?.textContent).toContain(formatMessage(copy.playthrough, { n: 2 }));
    expect(earlier?.textContent).toContain(formatMessage(copy.playthrough, { n: 1 }));
    expect(earlier?.textContent).toContain(formatMessage(copy.saveCount.many, { count: 2 }));

    earlier?.focus();
    press(earlier, 'ArrowRight');
    expect(rowNames(load)).toEqual(['Mine', 'Later', 'Early']);
    press(mine, 'ArrowLeft');
    expect(rowNames(load)).toEqual(['Later', 'Early']);
    // The selection it closed over waits in the closed game and comes back when it opens.
    expect(selectedName(load)).toBeNull();
    expect(button(copy.load, load).disabled).toBe(true);
    mine?.click();
    expect(selectedName(load)).toBe('Mine');
  });

  it("walks and deletes from a row's bin as from its row", async () => {
    const copy = messages().saveList;
    const { menu, saveLoad } = mount([slot('A', 3), slot('B', 2), slot('C', 1)]);
    menu.openPage('load');
    const load = page('load');
    await settle(() => expect(selectedName(load)).toBe('A'));
    load.querySelectorAll<HTMLButtonElement>('.on-saves__pick')[1]?.click();
    const bin = button(formatMessage(copy.deleteNamed, { name: 'B' }), load);
    press(bin, 'ArrowDown');
    expect(selectedName(load)).toBe('C');
    const binC = button(formatMessage(copy.deleteNamed, { name: 'C' }), load);
    press(binC, 'Delete');
    await settle(() => question());
    button(copy.del, question()).click();
    await settle(() => expect(saveLoad.deleteSave).toHaveBeenCalledWith('C'));
  });

  it('keeps a game the player closed closed when the list redraws', async () => {
    const copy = messages().saveList;
    const { menu } = mount([slot('Mine', 3), slot('Away', 2, ELSEWHERE)]);
    menu.openPage('load');
    const load = page('load');
    await settle(() => expect(selectedName(load)).toBe('Mine'));
    const [mine, away] = groupHeads(load);
    mine?.click();
    away?.click();
    expect(rowNames(load)).toEqual(['Away']);
    button(formatMessage(copy.deleteNamed, { name: 'Away' }), load).click();
    await settle(() => question());
    button(copy.del, question()).click();
    await settle(() => expect(groupHeads(load)).toHaveLength(1));
    expect(rowNames(load)).toEqual([]);
    groupHeads(load)[0]?.click();
    expect(selectedName(load)).toBe('Mine');
  });

  it('says the list is empty and how to fill it', async () => {
    const copy = messages().saveList;
    const { menu } = mount([]);
    menu.openPage('load');
    const load = page('load');
    await settle(() => expect(load.querySelector('.on-saves__empty')?.textContent).toContain(copy.empty));
    expect(load.querySelector('.on-saves__empty')?.textContent).toContain(copy.emptyLoadHint);
  });
});
