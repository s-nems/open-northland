// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createRevealKey, type RevealKey } from '../../src/view/reveal-key.js';

let reveal: RevealKey | undefined;
afterEach(() => {
  reveal?.dispose();
  document.body.replaceChildren();
});

const press = (
  type: 'keydown' | 'keyup',
  key: string,
  code: string,
  target: EventTarget = window,
  repeat = false,
): KeyboardEvent => {
  const event = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, repeat });
  target.dispatchEvent(event);
  return event;
};

describe('the reveal toggle key', () => {
  it('toggles on Space, keeps the page from scrolling with the press, and ignores a keyup', () => {
    reveal = createRevealKey();
    const down = press('keydown', ' ', 'Space');
    expect(reveal.toggled()).toBe(true);
    expect(down.defaultPrevented).toBe(true);
    press('keyup', ' ', 'Space');
    expect(reveal.toggled()).toBe(true);
    // The toggle survives a window blur: a held fade would stick, a toggle is meant to.
    window.dispatchEvent(new Event('blur'));
    expect(reveal.toggled()).toBe(true);
    // The second press turns it back off.
    press('keydown', ' ', 'Space');
    expect(reveal.toggled()).toBe(false);
  });

  it("ignores other keys, a held key's repeats, and typing in a field or a focused control", () => {
    reveal = createRevealKey();
    press('keydown', 't', 'KeyT');
    expect(reveal.toggled()).toBe(false);
    // A held Space repeats its keydown: the repeats must not flip the toggle back and forth.
    press('keydown', ' ', 'Space');
    expect(reveal.toggled()).toBe(true);
    press('keydown', ' ', 'Space', window, true);
    expect(reveal.toggled()).toBe(true);
    // A text field keeps Space for its own typing, and a focused control keeps it for its click.
    const field = document.createElement('input');
    const button = document.createElement('button');
    document.body.append(field, button);
    press('keydown', ' ', 'Space', field);
    expect(reveal.toggled()).toBe(true);
    press('keydown', ' ', 'Space', button);
    expect(reveal.toggled()).toBe(true);
    press('keydown', ' ', 'Space');
    expect(reveal.toggled()).toBe(false);
  });
});
