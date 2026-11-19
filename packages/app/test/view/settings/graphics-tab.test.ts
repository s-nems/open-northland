// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { messages } from '../../../src/i18n/index.js';
import { FILTER_CHOICES, filterChoiceOf, filterPatchFor } from '../../../src/view/settings/graphics-tab.js';
import { createSettingsPage, initialSettingsMemory } from '../../../src/view/settings/page.js';
import { defaultSettings, type MenuSettings } from '../../../src/view/settings/store.js';

afterEach(() => document.body.replaceChildren());

// The control is built from these two, so they carry its whole contract without needing a DOM.
describe('original art filter control', () => {
  it('shows Off while the filter is off, whatever scaler is stored', () => {
    expect(filterChoiceOf({ enhancedSampling: false, pixelArtScaler: 'xbrz' })).toBe('off');
    expect(filterChoiceOf({ enhancedSampling: true, pixelArtScaler: 'xbrz' })).toBe('xbrz');
  });

  it('keeps the stored scaler when the player picks Off, so turning it back on restores their choice', () => {
    const stored = { ...defaultSettings(), enhancedSampling: true, pixelArtScaler: 'xbrz' } as const;
    const off = { ...stored, ...filterPatchFor('off') };
    expect(off.pixelArtScaler).toBe('xbrz');
    expect(off.enhancedSampling).toBe(false);
    expect(filterChoiceOf({ ...off, ...filterPatchFor('xbrz') })).toBe('xbrz');
  });

  it('round-trips every choice through the patch it writes', () => {
    for (const choice of FILTER_CHOICES) {
      const next = { ...defaultSettings(), ...filterPatchFor(choice) };
      expect(filterChoiceOf(next)).toBe(choice);
    }
  });
});

/** A graphics tab of the settings page, with a store that records every patch it is asked to write. */
function graphicsTab(patches: Partial<MenuSettings>[]): void {
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
    memory: { ...initialSettingsMemory(), tab: 'graphics' },
    signal: new AbortController().signal,
  });
  document.body.append(page.el);
  page.render();
}

describe('the hidden-unit fill and outline rows', () => {
  it('sit directly under Post-processing, the last rows of the world group', () => {
    const text = messages().mainMenu.settings;
    graphicsTab([]);
    const rowOf = (focus: string): Element | null =>
      document.querySelector(`[data-settings-focus="${focus}"]`)?.closest('.main-menu__settings-row') ?? null;
    const postFxRow = rowOf('post-fx');
    expect(postFxRow).not.toBeNull();
    const fillRow = postFxRow?.nextElementSibling;
    expect(fillRow).toBe(rowOf('occlusionFill'));
    expect(fillRow?.querySelector('.main-menu__settings-label')?.textContent).toBe(text.occlusionFill);
    const outlineRow = fillRow?.nextElementSibling;
    expect(outlineRow).toBe(rowOf('occlusionOutline'));
    expect(outlineRow?.querySelector('.main-menu__settings-label')?.textContent).toBe(text.occlusionOutline);
    const nextHeading = outlineRow?.nextElementSibling;
    expect(nextHeading?.tagName).toBe('H3');
    expect(nextHeading?.textContent).toBe(text.accessibilityHeading);
  });

  it('start off, and each pill patches its own setting on', async () => {
    const patches: Partial<MenuSettings>[] = [];
    graphicsTab(patches);
    for (const key of ['occlusionFill', 'occlusionOutline'] as const) {
      const pill = document.querySelector<HTMLButtonElement>(`[data-settings-focus="${key}"]`);
      expect(pill?.getAttribute('aria-checked')).toBe('false');
      pill?.click();
      await Promise.resolve();
      expect(pill?.getAttribute('aria-checked')).toBe('true');
    }
    expect(patches).toEqual([{ occlusionFill: true }, { occlusionOutline: true }]);
  });
});
