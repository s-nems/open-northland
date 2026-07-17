import { describe, expect, it } from 'vitest';
import {
  GUI_ATLAS_FRAME_COUNT,
  GUI_FRAME,
  GUI_FRAMES,
  type GuiFrameMeta,
  type GuiFrameName,
  guiFrameIndex,
} from '../src/content/gui-atlas-map.js';
import { GUI_PALETTES } from '../src/content/gui-gfx.js';

const UNKNOWN_NAME = /^unknown_(\d{3})$/;
const VALID_PALETTES = new Set<string>(GUI_PALETTES);
/** The table at its declared shape: `GUI_FRAMES` is `as const`, so a row that authors no `states`
 *  has no such property to read — these assertions are about the interface, not one row's literal. */
const FRAMES: readonly GuiFrameMeta[] = GUI_FRAMES;

describe('gui-atlas-map', () => {
  it('is total over the atlas: one entry per frame, matching the sheet frame count', () => {
    expect(GUI_FRAMES).toHaveLength(GUI_ATLAS_FRAME_COUNT);
  });

  it('names every frame (a real name or an unknown_NNN placeholder), no gaps', () => {
    for (const frame of GUI_FRAMES) {
      expect(frame.name.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate names across the sheet', () => {
    const names = GUI_FRAMES.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('names any placeholder exactly unknown_<zero-padded index> (no mis-padded/typo placeholders slip through)', () => {
    GUI_FRAMES.forEach((frame, index) => {
      // Guard BOTH directions: a real name never starts with "unknown", and anything that does must be the
      // exact canonical placeholder for its index — so a mis-padded `unknown_42` can't masquerade as identified.
      if (!frame.name.startsWith('unknown')) return; // an identified name — nothing to check here
      expect(frame.name).toBe(`unknown_${String(index).padStart(3, '0')}`);
      // An unknown_NNN name may carry a montage best-guess role, but a manually mapped frame is named.
      expect(frame.source).not.toBe('manual');
    });
  });

  it('gives every identified (non-unknown) frame a manual or montage source', () => {
    for (const frame of GUI_FRAMES) {
      if (UNKNOWN_NAME.test(frame.name)) continue;
      expect(frame.source === 'manual' || frame.source === 'montage').toBe(true);
    }
  });

  it('assigns every frame a valid GUI palette row', () => {
    for (const frame of GUI_FRAMES) {
      expect(VALID_PALETTES.has(frame.palette)).toBe(true);
    }
  });

  it('references only existing frame names from every state list', () => {
    const names = new Set<string>(FRAMES.map((f) => f.name));
    for (const frame of FRAMES) {
      for (const state of frame.states ?? []) {
        expect(names.has(state)).toBe(true);
      }
    }
  });

  it('keeps the GUI_FRAME named constants in lock-step with the catalog', () => {
    for (const [name, index] of Object.entries(GUI_FRAME)) {
      expect(GUI_FRAMES[index]?.name).toBe(name);
      expect(guiFrameIndex(name as GuiFrameName)).toBe(index);
    }
  });

  it('resolves a name to its index and throws on an unknown name', () => {
    expect(guiFrameIndex('overview_toggle_button')).toBe(145);
    // The runtime backstop for a caller that reached here with an unchecked string — the cast is
    // what such a caller looks like, since a typed one cannot compile.
    expect(() => guiFrameIndex('does_not_exist' as GuiFrameName)).toThrow(/no frame named/);
  });
});
