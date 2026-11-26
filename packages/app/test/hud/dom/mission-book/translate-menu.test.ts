// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissionPage } from '../../../../src/game/map/mission-brief.js';
import { type BookWindowDeps, createBookWindow } from '../../../../src/hud/dom/mission-book/book-window.js';
import { messages } from '../../../../src/i18n/index.js';
import type { TranslateChoice } from '../../../../src/i18n/translate/mission-translate.js';

beforeEach(() => {
  // jsdom lays out nothing and ships neither observer nor font set.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Mounts the book window on a bare plane, recording what its translate menu picks. */
function mount(choice: TranslateChoice = 'auto') {
  const plane = document.createElement('div');
  document.body.append(plane);
  const picks: TranslateChoice[] = [];
  let chosen: TranslateChoice = choice;
  const deps: BookWindowDeps = {
    plane,
    chapters: () => [null],
    page: (): MissionPage => ({ title: 'Wyspy', blocks: [], lang: 'pol' }),
    goals: () => [],
    infoRows: () => [],
    missionName: 'Wyspy',
    history: null,
    missionHuman: () => null,
    pictureUrl: () => '',
    onShowOnMap: () => undefined,
    onCallback: () => undefined,
    voice: null,
    takeGoalMarks: () => new Map(),
    onDismiss: () => undefined,
    translateTarget: () => chosen,
    onTranslateTarget: (picked) => {
      picks.push(picked);
      chosen = picked;
    },
    cue: () => undefined,
  };
  const book = createBookWindow(deps);
  const scene = book.element;
  const button = scene.querySelector<HTMLButtonElement>('.on-book__translate');
  const menu = scene.querySelector<HTMLElement>('.on-book__translate-menu');
  if (button === null || menu === null) throw new Error('translate menu: markup');
  return { book, scene, button, menu, picks, chosen: () => chosen };
}

const open = (book: ReturnType<typeof mount>['book']): void => {
  book.open({
    reading: { tab: 'brief', chapter: 0, spread: 0, table: null, pick: 0 },
    arrival: false,
    paused: false,
  });
};

const click = (element: Element): void => {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

describe('the mission book translate menu', () => {
  it("sits on the book quiet and closed, with a row for the reader's language, every language and the original", () => {
    const { book, button, menu } = mount();
    open(book);
    expect(button.getAttribute('aria-label')).toBe(messages().hud.missionBook.translate);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(menu.hidden).toBe(true);
    const rows = [...menu.querySelectorAll<HTMLButtonElement>('[data-translate-choice]')];
    expect(rows.map((row) => row.dataset.translateChoice)).toEqual([
      'auto',
      'pol',
      'eng',
      'ger',
      'rus',
      'ita',
      'chs',
      'cht',
      'original',
    ]);
    // Each language names itself, as the settings' language list does.
    expect(rows[3]?.textContent).toBe(messages().mainMenu.settings.languageNames.ger);
    // Opening marks the reader's own language as the choice until a pick says otherwise.
    click(button);
    expect(rows[0]?.getAttribute('aria-checked')).toBe('true');
    expect(rows[8]?.getAttribute('aria-checked')).toBe('false');
  });

  it('opens on the icon, marks the current choice, and stores a pick', () => {
    const { book, button, menu, picks, chosen } = mount('pol');
    open(book);
    click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(menu.hidden).toBe(false);
    expect(menu.querySelector('[data-translate-choice="pol"]')?.getAttribute('aria-checked')).toBe('true');

    const german = menu.querySelector<HTMLButtonElement>('[data-translate-choice="ger"]');
    if (german === null) throw new Error('translate menu: german row');
    click(german);
    expect(picks).toEqual(['ger']);
    expect(chosen()).toBe('ger');
    expect(menu.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');

    // The menu marks the stored choice the next time it opens, original included.
    click(button);
    expect(menu.querySelector('[data-translate-choice="ger"]')?.getAttribute('aria-checked')).toBe('true');
    click(button);
    const original = menu.querySelector<HTMLButtonElement>('[data-translate-choice="original"]');
    if (original === null) throw new Error('translate menu: original row');
    click(original);
    expect(picks).toEqual(['ger', 'original']);
    click(button);
    expect(menu.querySelector('[data-translate-choice="original"]')?.getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('stores both Chinese choices like any other language', () => {
    const { book, button, menu, picks, chosen } = mount('auto');
    open(book);
    click(button);
    const simplified = menu.querySelector<HTMLButtonElement>('[data-translate-choice="chs"]');
    const traditional = menu.querySelector<HTMLButtonElement>('[data-translate-choice="cht"]');
    if (simplified === null || traditional === null) throw new Error('translate menu: chinese rows');
    // Each names itself, as the settings' language list does.
    expect(simplified.textContent).toBe(messages().mainMenu.settings.languageNames.chs);
    expect(traditional.textContent).toBe(messages().mainMenu.settings.languageNames.cht);
    click(simplified);
    expect(picks).toEqual(['chs']);
    expect(chosen()).toBe('chs');
    click(button);
    click(traditional);
    expect(picks).toEqual(['chs', 'cht']);
    expect(chosen()).toBe('cht');
    expect(menu.hidden).toBe(true);
  });

  it('closes on a click outside the menu, and stays open on a click inside it', () => {
    const { book, button, menu } = mount();
    open(book);
    click(button);
    expect(menu.hidden).toBe(false);
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(menu.hidden).toBe(true);
    click(button);
    menu
      .querySelector('[data-translate-choice="eng"]')
      ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(menu.hidden).toBe(false);
    click(button); // the icon toggles it closed again
    expect(menu.hidden).toBe(true);
  });
});
