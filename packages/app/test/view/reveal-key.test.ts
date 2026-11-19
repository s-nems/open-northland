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
): KeyboardEvent => {
  const event = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe('the hold-to-reveal key', () => {
  it('holds while either Alt key is down, and keeps the browser menu from taking the press', () => {
    reveal = createRevealKey();
    const down = press('keydown', 'Alt', 'AltLeft');
    expect(reveal.held()).toBe(true);
    expect(down.defaultPrevented).toBe(true);
    press('keyup', 'Alt', 'AltLeft');
    expect(reveal.held()).toBe(false);
    press('keydown', 'Alt', 'AltRight');
    expect(reveal.held()).toBe(true);
  });

  it('ignores other keys, typing in a text field, and lets go when the window loses focus', () => {
    reveal = createRevealKey();
    press('keydown', 't', 'KeyT');
    expect(reveal.held()).toBe(false);
    const field = document.createElement('input');
    document.body.append(field);
    press('keydown', 'Alt', 'AltLeft', field);
    expect(reveal.held()).toBe(false);
    press('keydown', 'Alt', 'AltLeft');
    window.dispatchEvent(new Event('blur'));
    expect(reveal.held()).toBe(false);
  });
});
