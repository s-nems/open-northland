// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createRevealKey, type RevealKey } from '../../src/view/reveal-key.js';

let reveal: RevealKey | undefined;
/** The chord the settings' revealToggle action holds; the test rebinds it like the controls tab does. */
let binding: string | null = 'Tab';
afterEach(() => {
  reveal?.dispose();
  binding = 'Tab';
  document.body.replaceChildren();
});

const press = (
  type: 'keydown' | 'keyup',
  key: string,
  code: string,
  target: EventTarget = window,
  repeat = false,
  shiftKey = false,
): KeyboardEvent => {
  const event = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, repeat, shiftKey });
  target.dispatchEvent(event);
  return event;
};

describe('the reveal toggle key', () => {
  it('toggles on Tab, keeps the focus from walking off, and ignores a keyup', () => {
    reveal = createRevealKey(() => binding);
    const down = press('keydown', 'Tab', 'Tab');
    expect(reveal.toggled()).toBe(true);
    expect(down.defaultPrevented).toBe(true);
    press('keyup', 'Tab', 'Tab');
    expect(reveal.toggled()).toBe(true);
    // The toggle survives a window blur: a held fade would stick, a toggle is meant to.
    window.dispatchEvent(new Event('blur'));
    expect(reveal.toggled()).toBe(true);
    // The second press turns it back off.
    press('keydown', 'Tab', 'Tab');
    expect(reveal.toggled()).toBe(false);
  });

  it("ignores other keys, a held key's repeats, and typing in a field or a focused control", () => {
    reveal = createRevealKey(() => binding);
    press('keydown', ' ', 'Space');
    expect(reveal.toggled()).toBe(false);
    // A held Tab repeats its keydown: the repeats must not flip the toggle back and forth.
    press('keydown', 'Tab', 'Tab');
    expect(reveal.toggled()).toBe(true);
    press('keydown', 'Tab', 'Tab', window, true);
    expect(reveal.toggled()).toBe(true);
    // A text field keeps Tab for its own traversal, and a focused control keeps it for its activation.
    const field = document.createElement('input');
    const button = document.createElement('button');
    document.body.append(field, button);
    press('keydown', 'Tab', 'Tab', field);
    expect(reveal.toggled()).toBe(true);
    press('keydown', 'Tab', 'Tab', button);
    expect(reveal.toggled()).toBe(true);
    press('keydown', 'Tab', 'Tab');
    expect(reveal.toggled()).toBe(false);
  });

  it('reads the settings binding per press: a rebind applies at once, unbound never toggles', () => {
    reveal = createRevealKey(() => binding);
    press('keydown', 'KeyR', 'KeyR');
    expect(reveal.toggled()).toBe(false);
    // The controls settings move the toggle to a chord with a modifier: plain R stays plain.
    binding = 'Shift+KeyR';
    press('keydown', 'KeyR', 'KeyR');
    expect(reveal.toggled()).toBe(false);
    press('keydown', 'R', 'KeyR', window, false, true);
    expect(reveal.toggled()).toBe(true);
    // Unbound: no press answers, and the key keeps its page duty - the traversal it would start.
    binding = null;
    const unbound = press('keydown', 'Tab', 'Tab');
    expect(reveal.toggled()).toBe(true);
    expect(unbound.defaultPrevented).toBe(false);
  });
});
