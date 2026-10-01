import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isOrderHotkey } from '../src/hud/hotkeys.js';
import { DEFAULT_KEY_BINDINGS, type KeyBindings } from '../src/hud/keybindings.js';

/** An order key answers with Shift held, so arming it keeps a Shift-queue going. */

const press = (code: string, shiftKey: boolean): KeyboardEvent =>
  ({
    code,
    shiftKey,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    target: null,
  }) as KeyboardEvent;

beforeEach(() => {
  for (const name of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLElement']) {
    vi.stubGlobal(name, class {});
  }
});
afterEach(() => vi.unstubAllGlobals());

describe('isOrderHotkey', () => {
  it('arms the attack-move with or without Shift', () => {
    const key = DEFAULT_KEY_BINDINGS.attackMove ?? '';
    expect(isOrderHotkey(press(key, false), DEFAULT_KEY_BINDINGS, 'attackMove')).toBe(true);
    expect(isOrderHotkey(press(key, true), DEFAULT_KEY_BINDINGS, 'attackMove')).toBe(true);
  });

  it('leaves a chord another action is bound to exactly to that action', () => {
    const bindings: KeyBindings = {
      ...DEFAULT_KEY_BINDINGS,
      roadTool: `Shift+${DEFAULT_KEY_BINDINGS.attackMove}`,
    };
    expect(isOrderHotkey(press(DEFAULT_KEY_BINDINGS.attackMove ?? '', true), bindings, 'attackMove')).toBe(
      false,
    );
  });
});
