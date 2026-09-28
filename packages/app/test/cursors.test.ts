import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_HOTSPOTS } from '../src/view/cursors/hotspots.js';
import { CURSOR_SIZES, CURSOR_STATES, CURSOR_THEMES } from '../src/view/cursors/model.js';
import { placementPointer } from '../src/view/cursors/placement.js';
import { cursorCss, cursorImage } from '../src/view/cursors/theme.js';
import {
  defaultSettings,
  onStoredSettingsChange,
  parseStoredSettings,
  patchStoredSettings,
  persistSettings,
} from '../src/view/settings-store.js';
import { pickCursor } from '../src/view/unit-controls/pick-cursor.js';
import { createSelectionCursor } from '../src/view/unit-controls/selection-cursor.js';
import { snapshotOf } from './support/snapshot.js';

afterEach(() => vi.unstubAllGlobals());

it('waits for drawn targets and refreshes a paused view when its camera or pointer claims change', () => {
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  const canvas = Object.assign(new EventTarget(), {
    getAttribute: (key: string) => attributes.get(key) ?? null,
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    removeAttribute: (key: string) => attributes.delete(key),
    style: {
      setProperty: (key: string, value: string) => properties.set(key, value),
      removeProperty: (key: string) => properties.delete(key),
    },
  });
  vi.stubGlobal('window', new EventTarget());
  const camera = { offsetX: 0, offsetY: 0, scale: 1 };
  let blocked = false;
  let drawnTarget: number | null = 7;
  const selectionAt = vi.fn(() => drawnTarget);
  const cursor = createSelectionCursor({
    canvas: canvas as unknown as HTMLCanvasElement,
    camera: () => camera,
    viewerVersion: () => 0,
    blocked: () => blocked,
    toWorld: (x, y) => ({ x, y }),
    selectionAt,
  });
  const snapshot = snapshotOf([]);
  try {
    canvas.dispatchEvent(
      Object.assign(new Event('pointermove'), { pointerType: 'mouse', clientX: 20, clientY: 30 }),
    );
    expect(selectionAt).not.toHaveBeenCalled();
    cursor.update(snapshot);
    expect(canvas.getAttribute('data-cursor-hover')).toBe('select');
    cursor.update(snapshot);
    expect(selectionAt).toHaveBeenCalledTimes(1);

    camera.offsetX = 20;
    drawnTarget = null;
    cursor.update(snapshot);
    expect(canvas.getAttribute('data-cursor-hover')).toBeNull();
    expect(properties.has('--world-cursor-hover')).toBe(false);

    blocked = true;
    cursor.update(snapshot);
    drawnTarget = 8;
    blocked = false;
    cursor.update(snapshot);
    expect(canvas.getAttribute('data-cursor-hover')).toBe('select');
    canvas.dispatchEvent(new Event('pointerleave'));
    expect(canvas.getAttribute('data-cursor-hover')).toBeNull();
  } finally {
    cursor.dispose();
  }
});

describe('cursor preferences', () => {
  it('retains the selected family through sequential patches when storage writes fail', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota');
        },
      },
    });
    const changed = vi.fn();
    const unsubscribe = onStoredSettingsChange(changed);
    try {
      patchStoredSettings({ cursorTheme: 'amber' });
      patchStoredSettings({ cursorSize: 32 });
      patchStoredSettings({ soundEnabled: false });
      expect(changed).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cursorTheme: 'amber',
          cursorSize: 32,
          soundEnabled: false,
        }),
      );
    } finally {
      unsubscribe();
    }
  });
  it('starts with small cold steel and rejects corrupt or unavailable choices', () => {
    expect(parseStoredSettings(null)).toMatchObject({ cursorTheme: 'steel', cursorSize: 28 });
    expect(parseStoredSettings('{"cursorTheme":"wood","cursorSize":128}')).toMatchObject({
      cursorTheme: 'steel',
      cursorSize: 28,
    });
    for (const cursorTheme of CURSOR_THEMES) {
      expect(parseStoredSettings(JSON.stringify({ cursorTheme, cursorSize: 32 }))).toMatchObject({
        cursorTheme,
        cursorSize: 32,
      });
    }
  });

  it('applies a preference even when persistence is denied and releases subscribers', () => {
    vi.stubGlobal('window', {
      localStorage: {
        setItem: () => {
          throw new Error('denied');
        },
      },
    });
    const changed = vi.fn();
    const unsubscribe = onStoredSettingsChange(changed);
    const chosen = { ...defaultSettings(), cursorTheme: 'bone' as const, cursorSize: 24 as const };
    try {
      persistSettings(chosen);
      expect(changed).toHaveBeenLastCalledWith(chosen);
      unsubscribe();
      persistSettings(defaultSettings());
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
});

describe('cursor deliveries', () => {
  it('resolves every selected family, state, size and pixel density with an in-bounds hotspot', () => {
    for (const theme of CURSOR_THEMES) {
      if (theme === 'system') continue;
      for (const size of CURSOR_SIZES) {
        for (const state of CURSOR_STATES) {
          expect(cursorImage(theme, state, size)).toContain('.png');
          expect(cursorImage(theme, state, size, 2)).toContain('@2x');
          for (const axis of CURSOR_HOTSPOTS[theme][size][state]) {
            expect(axis).toBeGreaterThanOrEqual(0);
            expect(axis).toBeLessThan(size);
          }
        }
        expect(CURSOR_HOTSPOTS[theme][size].pressed).toEqual(CURSOR_HOTSPOTS[theme][size].normal);
        expect(CURSOR_HOTSPOTS[theme][size].select).toEqual(CURSOR_HOTSPOTS[theme][size].normal);
      }
    }
    expect(cursorCss('iron', 'text', 28, true)).toMatch(/image-set\(.+ 1x,.+ 2x\).+, text$/);
    expect(cursorCss('iron', 'pointer', 24, false)).toMatch(/^url\(.+\) \d+ \d+, pointer$/);
  });
});

it('keeps order intent distinct and clears it when the pick is cancelled', () => {
  expect(pickCursor({ kind: 'destination', units: [1] })).toBe('move');
  expect(pickCursor({ kind: 'attack-building', units: [1] })).toBe('attack');
  expect(pickCursor({ kind: 'workplace-or-flag', units: [1] })).toBe('work');
  expect(pickCursor({ kind: 'home', units: [1] })).toBe('crosshair');
  expect(pickCursor(null)).toBeNull();
});

it('uses the placement verdict without mistaking a partly accepted wall for a blocked order', () => {
  expect(placementPointer(false, null)).toBeNull();
  expect(placementPointer(true, null)).toBe('not-allowed');
  expect(placementPointer(true, { kind: 'gate', col: 1, row: 2, gfxIndex: 0, ok: false })).toBe(
    'not-allowed',
  );
  expect(
    placementPointer(true, {
      kind: 'line',
      anchored: true,
      nodes: [
        { col: 1, row: 1, state: 'open' },
        { col: 2, row: 1, state: 'blocked' },
      ],
    }),
  ).toBe('build');
  expect(
    placementPointer(true, { kind: 'line', anchored: false, nodes: [{ col: 1, row: 1, state: 'blocked' }] }),
  ).toBe('not-allowed');
});
