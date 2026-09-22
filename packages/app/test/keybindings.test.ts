import { describe, expect, it } from 'vitest';
import {
  assignBinding,
  bindingAllowedFor,
  bindingFromKeyboardEvent,
  bindingFromMouseEvent,
  CONTROL_GROUP_BINDING_ACTIONS,
  DEFAULT_KEY_BINDINGS,
  isBindableBinding,
  isBindableCode,
  keyDisplayLabel,
  matchesMouseBinding,
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
    expect(parsed.professionPicker).toBe('KeyC');
  });

  it('keeps modifier chords distinct from their plain base key', () => {
    const parsed = parseKeyBindings({ pauseToggle: 'Ctrl+KeyO', actionRing: 'KeyO' });
    expect(parsed.pauseToggle).toBe('Ctrl+KeyO');
    expect(parsed.actionRing).toBe('KeyO');
  });

  it('drops an invalid or unbindable code to the default', () => {
    expect(parseKeyBindings({ pauseToggle: 7 }).pauseToggle).toBe('KeyP');
    expect(parseKeyBindings({ pauseToggle: 'Escape' }).pauseToggle).toBe('KeyP');
    expect(parseKeyBindings({ pauseToggle: 'F11' }).pauseToggle).toBe('KeyP');
  });

  it('preserves an explicit null as unbound', () => {
    expect(parseKeyBindings({ attackMove: null }).attackMove).toBeNull();
  });

  it('gives a doubly-claimed code to the earlier action and unbinds the later one', () => {
    const parsed = parseKeyBindings({ panLeft: 'KeyP' });
    expect(parsed.panLeft).toBe('KeyP');
    expect(parsed.pauseToggle).toBeNull();
  });

  it('fills older stored settings with the default 1-0 control-group bindings', () => {
    const parsed = parseKeyBindings({ pauseToggle: 'KeyO' });
    expect([
      parsed.controlGroup1,
      parsed.controlGroup1Replace,
      parsed.controlGroup1Add,
      parsed.controlGroup2,
      parsed.controlGroup3,
      parsed.controlGroup4,
      parsed.controlGroup5,
      parsed.controlGroup6,
      parsed.controlGroup7,
      parsed.controlGroup8,
      parsed.controlGroup9,
      parsed.controlGroup0,
    ]).toEqual([
      'Digit1',
      'Ctrl+Digit1',
      'Shift+Digit1',
      'Digit2',
      'Digit3',
      'Digit4',
      'Digit5',
      'Digit6',
      'Digit7',
      'Digit8',
      'Digit9',
      'Digit0',
    ]);
  });
});

describe('control-group settings order', () => {
  it('lists all recalls, then replacements, then steal-add bindings', () => {
    expect(CONTROL_GROUP_BINDING_ACTIONS).toEqual([
      ...Array.from({ length: 10 }, (_, index) => `controlGroup${index === 9 ? 0 : index + 1}`),
      ...Array.from({ length: 10 }, (_, index) => `controlGroup${index === 9 ? 0 : index + 1}Replace`),
      ...Array.from({ length: 10 }, (_, index) => `controlGroup${index === 9 ? 0 : index + 1}Add`),
    ]);
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
    for (const code of ['KeyA', 'Digit5', 'Numpad0', 'ArrowLeft', 'Space', 'Comma', 'Home', 'F1', 'F10']) {
      expect(isBindableCode(code), code).toBe(true);
    }
  });

  it('rejects modifiers and browser-owned keys', () => {
    for (const code of ['ShiftLeft', 'ControlLeft', 'AltRight', 'MetaLeft', 'Tab', 'Enter', 'F11', 'F12']) {
      expect(isBindableCode(code), code).toBe(false);
    }
  });
});

describe('Escape', () => {
  it('is bindable, but only plain and only to the game menu', () => {
    expect(isBindableCode('Escape')).toBe(true);
    expect(isBindableBinding('Escape')).toBe(true);
    expect(isBindableBinding('Shift+Escape')).toBe(false);
    expect(bindingAllowedFor('gameMenu', 'Escape')).toBe(true);
    expect(bindingAllowedFor('gameMenu', 'KeyM')).toBe(true);
    for (const action of ['pauseToggle', 'construction', 'actionRing', 'controlGroup1'] as const) {
      expect(bindingAllowedFor(action, 'Escape'), action).toBe(false);
    }
  });

  it('opens the game menu by default, with B on the construction window', () => {
    expect(DEFAULT_KEY_BINDINGS.gameMenu).toBe('Escape');
    expect(DEFAULT_KEY_BINDINGS.construction).toBe('KeyB');
    expect(keyDisplayLabel('Escape', { space: 'Space' })).toBe('Esc');
  });

  it('never sticks to another action through storage', () => {
    const parsed = parseKeyBindings({ pauseToggle: 'Escape', gameMenu: 'KeyM' });
    expect(parsed.pauseToggle).toBe('KeyP');
    expect(parsed.gameMenu).toBe('KeyM');
  });
});

describe('input chords', () => {
  it('accepts normalized keyboard and mouse chords', () => {
    for (const binding of ['Shift+Digit2', 'Ctrl+KeyG', 'Ctrl+Shift+KeyG', 'Ctrl+Mouse2', 'Primary+Mouse2']) {
      expect(isBindableBinding(binding), binding).toBe(true);
    }
    for (const binding of [
      'ShiftLeft+Digit2',
      'Shift+Shift+Digit2',
      'Shift+Ctrl+KeyG',
      'Ctrl+Primary+Mouse2',
      'Mouse4',
      'Ctrl+Escape',
    ]) {
      expect(isBindableBinding(binding), binding).toBe(false);
    }
  });

  it('keeps work-flag bindings modified and away from the camera button', () => {
    expect(bindingAllowedFor('workFlagOrder', 'Ctrl+Mouse2')).toBe(true);
    expect(bindingAllowedFor('workFlagOrder', 'Mouse2')).toBe(false);
    expect(bindingAllowedFor('workFlagOrder', 'Shift+Mouse1')).toBe(false);
    expect(bindingAllowedFor('workFlagOrder', 'Shift+Mouse0')).toBe(false);
  });

  it('matches the primary mouse modifier to Ctrl or Cmd', () => {
    const event = (overrides: Partial<MouseEvent>) =>
      ({
        button: 2,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        ...overrides,
      }) as MouseEvent;
    expect(matchesMouseBinding(event({ ctrlKey: true }), 'Primary+Mouse2')).toBe(true);
    expect(matchesMouseBinding(event({ metaKey: true }), 'Primary+Mouse2')).toBe(true);
    expect(matchesMouseBinding(event({ shiftKey: true }), 'Primary+Mouse2')).toBe(false);
  });

  it('normalizes event modifiers in a stable order', () => {
    expect(
      bindingFromKeyboardEvent({
        code: 'Digit2',
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
      } as KeyboardEvent),
    ).toBe('Ctrl+Shift+Digit2');
    expect(
      bindingFromMouseEvent({
        button: 2,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      } as MouseEvent),
    ).toBe('Ctrl+Mouse2');
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
    expect(keyDisplayLabel('Shift+Digit2', names)).toBe('Shift + 2');
    expect(keyDisplayLabel('Ctrl+Mouse2', { ...names, mouseRight: 'prawy klik' })).toBe('Ctrl + prawy klik');
    expect(keyDisplayLabel('Primary+Mouse2', { ...names, mouseRight: 'prawy klik' })).toBe(
      'Ctrl/Cmd + prawy klik',
    );
  });

  it('leaves navigation keys as their code', () => {
    expect(keyDisplayLabel('PageUp', names)).toBe('PageUp');
  });
});
