import { describe, expect, it } from 'vitest';
import { GUI_ATLAS_FRAME_COUNT, GUI_FRAME, GUI_FRAMES, guiFrameIndex } from '../src/content/gui-atlas-map.js';
import { GUI_PALETTES } from '../src/content/gui-gfx.js';

const UNKNOWN_NAME = /^unknown_(\d{3})$/;
const VALID_PALETTES = new Set<string>(GUI_PALETTES);

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

  it('zero-pads every unknown_NNN placeholder to its own frame index', () => {
    GUI_FRAMES.forEach((frame, index) => {
      const m = UNKNOWN_NAME.exec(frame.name);
      if (m === null) return; // a real (identified) name — nothing to check here
      expect(Number.parseInt(m[1], 10)).toBe(index);
      // an unknown_NNN name may carry a 'montage' best-guess role, but a code-pinned frame is always named
      expect(frame.source).not.toBe('openvikings');
    });
  });

  it('gives every identified (non-unknown) frame a source of openvikings or montage', () => {
    for (const frame of GUI_FRAMES) {
      if (UNKNOWN_NAME.test(frame.name)) continue;
      expect(frame.source === 'openvikings' || frame.source === 'montage').toBe(true);
    }
  });

  it('assigns every frame a valid GUI palette row', () => {
    for (const frame of GUI_FRAMES) {
      expect(VALID_PALETTES.has(frame.palette)).toBe(true);
    }
  });

  it('references only existing frame names from every state list', () => {
    const names = new Set(GUI_FRAMES.map((f) => f.name));
    for (const frame of GUI_FRAMES) {
      for (const state of frame.states ?? []) {
        expect(names.has(state)).toBe(true);
      }
    }
  });

  it('keeps the GUI_FRAME named constants in lock-step with the catalog', () => {
    for (const [name, index] of Object.entries(GUI_FRAME)) {
      expect(GUI_FRAMES[index]?.name).toBe(name);
      expect(guiFrameIndex(name)).toBe(index);
    }
  });

  it('resolves a name to its index and throws on an unknown name', () => {
    expect(guiFrameIndex('overview_toggle_button')).toBe(145);
    expect(() => guiFrameIndex('does_not_exist')).toThrow(/no frame named/);
  });
});
