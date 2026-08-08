import { describe, expect, it } from 'vitest';
import {
  assignBinding,
  DEFAULT_KEY_BINDINGS,
  isBindableCode,
  keyDisplayLabel,
  parseKeyBindings,
} from '../src/hud/keybindings.js';

describe('parseKeyBindings', () => {
  it('falls back to all defaults for a missing or non-object blob', () => {
    expect(parseKeyBindings(undefined)).toEqual(DEFAULT_KEY_BINDINGS);
    expect(parseKeyBindings(null)).toEqual(DEFAULT_KEY_BINDINGS);
    expect(parseKeyBindings('KeyA')).toEqual(DEFAULT_KEY_BINDINGS);
    expect(parseKeyBindings(42)).toEqual(DEFAULT_KEY_BINDINGS);
  });

  it('keeps valid stored codes and defaults the missing actions', () => {
    const parsed = parseKeyBindings({ pauseToggle: 'KeyO' });
    expect(parsed.pauseToggle).toBe('KeyO');
    expect(parsed.panLeft).toBe('ArrowLeft');
    expect(parsed.actionRing).toBe('Space');
  });

  it('drops an invalid or unbindable code to the default', () => {
    expect(parseKeyBindings({ pauseToggle: 7 }).pauseToggle).toBe('KeyP');
    expect(parseKeyBindings({ pauseToggle: 'Escape' }).pauseToggle).toBe('KeyP');
    expect(parseKeyBindings({ pauseToggle: 'F5' }).pauseToggle).toBe('KeyP');
  });

  it('preserves an explicit null as unbound', () => {
    expect(parseKeyBindings({ attackMove: null }).attackMove).toBeNull();
  });

  it('gives a doubly-claimed code to the earlier action and unbinds the later one', () => {
    const parsed = parseKeyBindings({ panLeft: 'KeyP' });
    expect(parsed.panLeft).toBe('KeyP');
    expect(parsed.pauseToggle).toBeNull();
  });
});

describe('assignBinding', () => {
  it('assigns a free code without touching other actions', () => {
    const next = assignBinding(DEFAULT_KEY_BINDINGS, 'pauseToggle', 'KeyO');
    expect(next.pauseToggle).toBe('KeyO');
    expect(next.attackMove).toBe('KeyA');
  });

  it('takes a claimed code over and unbinds its previous owner', () => {
    const next = assignBinding(DEFAULT_KEY_BINDINGS, 'pauseToggle', 'KeyA');
    expect(next.pauseToggle).toBe('KeyA');
    expect(next.attackMove).toBeNull();
  });

  it('reassigning an action its own code is a no-op', () => {
    expect(assignBinding(DEFAULT_KEY_BINDINGS, 'attackMove', 'KeyA')).toEqual(DEFAULT_KEY_BINDINGS);
  });
});

describe('isBindableCode', () => {
  it('accepts plain game keys', () => {
    for (const code of ['KeyA', 'Digit5', 'Numpad0', 'ArrowLeft', 'Space', 'Comma', 'Home']) {
      expect(isBindableCode(code), code).toBe(true);
    }
  });

  it('rejects modifiers, Escape, and browser-owned keys', () => {
    for (const code of ['Escape', 'ShiftLeft', 'ControlLeft', 'AltRight', 'MetaLeft', 'Tab', 'Enter', 'F5']) {
      expect(isBindableCode(code), code).toBe(false);
    }
  });
});

describe('keyDisplayLabel', () => {
  const names = { space: 'Spacja' };

  it('renders key caps, not event codes', () => {
    expect(keyDisplayLabel('KeyA', names)).toBe('A');
    expect(keyDisplayLabel('Digit5', names)).toBe('5');
    expect(keyDisplayLabel('Numpad5', names)).toBe('Num 5');
    expect(keyDisplayLabel('ArrowLeft', names)).toBe('←');
    expect(keyDisplayLabel('Comma', names)).toBe(',');
    expect(keyDisplayLabel('Space', names)).toBe('Spacja');
  });

  it('leaves navigation keys as their code', () => {
    expect(keyDisplayLabel('PageUp', names)).toBe('PageUp');
  });
});
