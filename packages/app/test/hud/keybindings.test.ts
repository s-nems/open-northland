import { describe, expect, it } from 'vitest';
import {
  assignBinding,
  bindingAllowedFor,
  bindingFromKeyboardEvent,
  bindingFromMouseEvent,
  bindingsConflict,
  DEFAULT_KEY_BINDINGS,
  isBindableBinding,
  isBindableCode,
  KEYBINDING_ACTIONS,
  keyDisplayLabel,
  matchesKeyboardBindingUnderShift,
  matchesMouseBinding,
  parseKeyBindings,
} from '../../src/hud/keybindings.js';

describe('parseKeyBindings', () => {
  it('falls back to all defaults for a missing or non-object blob', () => {
    expect(parseKeyBindings(undefined)).toEqual(DEFAULT_KEY_BINDINGS);
    expect(parseKeyBindings(null)).toEqual(DEFAULT_KEY_BINDINGS);
    expect(parseKeyBindings('KeyA')).toEqual(DEFAULT_KEY_BINDINGS);
    expect(parseKeyBindings(42)).toEqual(DEFAULT_KEY_BINDINGS);
  });

  it('keeps valid stored codes and defaults the missing actions', () => {
    // Settings store only the changed bindings, so an action left out reads its default.
    expect(parseKeyBindings({ pauseToggle: 'KeyU' })).toEqual({
      ...DEFAULT_KEY_BINDINGS,
      pauseToggle: 'KeyU',
    });
  });

  it('keeps modifier chords distinct from their plain base key', () => {
    const parsed = parseKeyBindings({ pauseToggle: 'Ctrl+KeyU', actionRing: 'KeyU' });
    expect(parsed.pauseToggle).toBe('Ctrl+KeyU');
    expect(parsed.actionRing).toBe('KeyU');
  });

  it('drops an invalid or unbindable code to the default', () => {
    expect(parseKeyBindings({ pauseToggle: 7 }).pauseToggle).toBe('KeyP');
    expect(parseKeyBindings({ pauseToggle: 'Escape' }).pauseToggle).toBe('KeyP');
    expect(parseKeyBindings({ pauseToggle: 'F11' }).pauseToggle).toBe('KeyP');
  });

  it('preserves an explicit null as unbound', () => {
    expect(parseKeyBindings({ attackMove: null }).attackMove).toBeNull();
  });

  it("keeps a player's chord over a default that claims the same key", () => {
    const earlier = parseKeyBindings({ panLeft: 'KeyP' });
    expect(earlier.panLeft).toBe('KeyP');
    expect(earlier.pauseToggle).toBeNull();
    // Subjects comes first in action order, yet its default must not take the player's F2.
    const later = parseKeyBindings({ attackMove: 'F2' });
    expect(later.attackMove).toBe('F2');
    expect(later.residents).toBeNull();
  });

  it('lets a spectator key share a control group chord, never another chord', () => {
    const parsed = parseKeyBindings({ jumpToFight: 'Digit2', watchSeat1: 'KeyB' });
    expect(parsed.jumpToFight).toBe('Digit2');
    expect(parsed.controlGroup2).toBe('Digit2');
    expect(parsed.watchSeat2).toBeNull();
    expect(parsed.watchSeat1).toBe('KeyB');
    expect(parsed.construction).toBeNull();
  });

  it('gives a chord stored twice to the earlier action and unbinds the later one', () => {
    const parsed = parseKeyBindings({ panLeft: 'KeyU', attackMove: 'KeyU' });
    expect(parsed.panLeft).toBe('KeyU');
    expect(parsed.attackMove).toBeNull();
  });
});

describe('defaults', () => {
  it('gives no default chord to two conflicting actions', () => {
    const clashes = KEYBINDING_ACTIONS.flatMap((a) =>
      KEYBINDING_ACTIONS.filter(
        (b) => a < b && DEFAULT_KEY_BINDINGS[a] === DEFAULT_KEY_BINDINGS[b] && bindingsConflict(a, b),
      ).map((b) => `${a}/${b}`),
    );
    expect(clashes).toEqual([]);
  });
});

describe('assignBinding', () => {
  it('assigns a free code without touching other actions', () => {
    const next = assignBinding(DEFAULT_KEY_BINDINGS, 'pauseToggle', 'KeyU');
    expect(next.pauseToggle).toBe('KeyU');
    expect(next.attackMove).toBe('KeyA');
  });

  it('takes a claimed code over and unbinds its previous owner', () => {
    const next = assignBinding(DEFAULT_KEY_BINDINGS, 'pauseToggle', 'KeyA');
    expect(next.pauseToggle).toBe('KeyA');
    expect(next.attackMove).toBeNull();
  });

  it('keeps a control group beside a spectator key given its chord, and unbinds both for another action', () => {
    const spectator = assignBinding(DEFAULT_KEY_BINDINGS, 'jumpToFight', 'Digit3');
    expect(spectator.controlGroup3).toBe('Digit3');
    expect(spectator.watchSeat3).toBeNull();
    const pause = assignBinding(DEFAULT_KEY_BINDINGS, 'pauseToggle', 'Digit3');
    expect(pause.controlGroup3).toBeNull();
    expect(pause.watchSeat3).toBeNull();
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

  it('never sticks to another action through storage', () => {
    const parsed = parseKeyBindings({ pauseToggle: 'Escape', gameMenu: 'KeyM' });
    expect(parsed.pauseToggle).toBe(DEFAULT_KEY_BINDINGS.pauseToggle);
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
    expect(bindingAllowedFor('workFlagOrder', 'Shift+Mouse2')).toBe(false); // the queued walk
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

describe('matchesKeyboardBindingUnderShift', () => {
  const press = (code: string, mods: { shiftKey?: boolean; ctrlKey?: boolean } = {}) => ({
    code,
    shiftKey: mods.shiftKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    altKey: false,
    metaKey: false,
  });

  it('takes an order key with Shift held, as a Shift-queue goes on', () => {
    expect(matchesKeyboardBindingUnderShift(press('KeyA'), 'KeyA')).toBe(true);
    expect(matchesKeyboardBindingUnderShift(press('KeyA', { shiftKey: true }), 'KeyA')).toBe(true);
  });

  it('still tells the other modifiers and a Shift binding apart', () => {
    expect(matchesKeyboardBindingUnderShift(press('KeyA', { shiftKey: true, ctrlKey: true }), 'KeyA')).toBe(
      false,
    );
    expect(matchesKeyboardBindingUnderShift(press('KeyA'), 'Shift+KeyA')).toBe(false);
    expect(matchesKeyboardBindingUnderShift(press('KeyB', { shiftKey: true }), 'KeyA')).toBe(false);
    expect(matchesKeyboardBindingUnderShift(press('KeyA', { shiftKey: true }), null)).toBe(false);
  });
});

describe('keyDisplayLabel', () => {
  const names = {
    space: 'Spacja',
    mouseLeft: 'lewy klik',
    mouseMiddle: 'środkowy klik',
    mouseRight: 'prawy klik',
  };

  it('renders key caps, not event codes', () => {
    expect(keyDisplayLabel('KeyA', names)).toBe('A');
    expect(keyDisplayLabel('Digit5', names)).toBe('5');
    expect(keyDisplayLabel('Numpad5', names)).toBe('Num 5');
    expect(keyDisplayLabel('ArrowLeft', names)).toBe('←');
    expect(keyDisplayLabel('Comma', names)).toBe(',');
    expect(keyDisplayLabel('Space', names)).toBe('Spacja');
    expect(keyDisplayLabel('Shift+Digit2', names)).toBe('Shift + 2');
    expect(keyDisplayLabel('Ctrl+Mouse2', names)).toBe('Ctrl + prawy klik');
    expect(keyDisplayLabel('Primary+Mouse2', names)).toBe('Ctrl/Cmd + prawy klik');
    expect(keyDisplayLabel('Mouse1', names)).toBe('środkowy klik');
    expect(keyDisplayLabel('Escape')).toBe('Esc');
  });

  it('leaves navigation keys as their code', () => {
    expect(keyDisplayLabel('PageUp', names)).toBe('PageUp');
  });
});
