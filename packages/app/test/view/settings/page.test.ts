// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createSettingsPage, initialSettingsMemory } from '../../../src/view/settings/page.js';
import { defaultSettings, type MenuSettings } from '../../../src/view/settings/store.js';

afterEach(() => document.body.replaceChildren());

/** A settings tab of a page, opened from a game or from the main menu. */
function settingsTab(tab: 'audio' | 'gameplay', inGame: boolean): void {
  const page = createSettingsPage({
    settings: {
      current: defaultSettings,
      update: async () => true,
      pinnedUiScale: null,
      effectiveUiScaleFor: (factor) => factor,
      ...(inGame ? { inGame: true } : {}),
    },
    memory: { ...initialSettingsMemory(), tab },
    signal: new AbortController().signal,
  });
  document.body.append(page.el);
  page.render();
}

describe('the music source choice', () => {
  it('shows in a game and not in the main menu', () => {
    settingsTab('audio', false);
    expect(document.querySelector('[data-settings-focus^="music-source"]')).toBeNull();
    document.body.replaceChildren();
    settingsTab('audio', true);
    expect(document.querySelector('[data-settings-focus^="music-source"]')).not.toBeNull();
  });
});

describe('the notice filters', () => {
  it('toggle in the gameplay tab, one row each for the soldier and the grown man and woman', () => {
    settingsTab('gameplay', false);
    for (const focus of ['notice-new-soldier', 'notice-adult-man', 'notice-adult-woman']) {
      const control = document.querySelector<HTMLButtonElement>(`[data-settings-focus="${focus}"]`);
      expect(control).not.toBeNull();
      expect(control?.getAttribute('aria-label')).not.toBeNull();
    }
  });

  it('patch only their own setting when pressed', async () => {
    const patches: Partial<MenuSettings>[] = [];
    const page = createSettingsPage({
      settings: {
        current: defaultSettings,
        update: async (patch) => {
          patches.push(patch);
          return true;
        },
        pinnedUiScale: null,
        effectiveUiScaleFor: (factor) => factor,
      },
      memory: { ...initialSettingsMemory(), tab: 'gameplay' },
      signal: new AbortController().signal,
    });
    document.body.append(page.el);
    page.render();
    const toggle = document.querySelector<HTMLButtonElement>('[data-settings-focus="notice-new-soldier"]');
    if (toggle === null) throw new Error('the notice-new-soldier toggle is missing');
    toggle.click();
    await Promise.resolve();
    expect(patches).toEqual([{ noticeNewSoldier: false }]);
  });
});

describe('the gameplay tab sections', () => {
  it('group the scroll rows under controls, then notices, then tools and reports', () => {
    settingsTab('gameplay', false);
    const headings = [...document.querySelectorAll('.main-menu__settings-heading')];
    expect(headings).toHaveLength(3);
    const [controls, notices, tools] = headings;
    if (controls === undefined || notices === undefined || tools === undefined) {
      throw new Error('the gameplay tab lacks one of its three section headings');
    }
    const row = (focus: string): Element => {
      const el = document.querySelector(`[data-settings-focus="${focus}"]`);
      if (el === null) throw new Error(`the ${focus} row is missing`);
      return el;
    };
    const follows = (first: Element, second: Element): boolean =>
      (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    // Controls opens the tab's scroll rows; notices begins below the last of them.
    expect(follows(controls, row('keyboard-scroll-speed'))).toBe(true);
    expect(follows(row('invert-drag-scroll'), notices)).toBe(true);
    expect(follows(notices, row('notice-new-soldier'))).toBe(true);
    expect(follows(row('notice-adult-woman'), tools)).toBe(true);
    // Tools and reports holds the debug tools, the error reports and the original game's row.
    expect(follows(tools, row('debug-tools'))).toBe(true);
    expect(follows(tools, row('auto-reports'))).toBe(true);
  });
});
