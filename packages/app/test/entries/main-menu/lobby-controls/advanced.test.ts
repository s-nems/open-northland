// @vitest-environment jsdom
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  type AdvancedText,
  advancedSettings,
} from '../../../../src/entries/main-menu/lobby-controls/advanced.js';

const TEXT: AdvancedText = {
  label: 'Advanced',
  title: 'Advanced settings',
  standard: 'Standard',
  changed: 'Changed',
  rulesGroup: 'Game rules',
  worldGroup: 'World',
  reset: 'Restore defaults',
  done: 'Done',
};

function mount() {
  // jsdom lays nothing out; as a browser does, a hidden element and a closed list's rows draw no box.
  const proto = Element.prototype;
  const original = proto.getClientRects;
  proto.getClientRects = function (this: Element) {
    const drawn = this.closest('[hidden], [popover]') === null;
    return (drawn ? [new DOMRect()] : []) as unknown as DOMRectList;
  };
  onTestFinished(() => {
    proto.getClientRects = original;
  });
  const rule = document.createElement('button');
  rule.textContent = 'rule';
  // An open choice list inside the window, as the dropdown's popover is.
  const list = document.createElement('div');
  list.setAttribute('popover', '');
  const option = document.createElement('button');
  list.append(option);
  const advanced = advancedSettings({
    text: TEXT,
    groups: [{ title: TEXT.rulesGroup, rows: [rule, list] }],
    reset: () => undefined,
  });
  const screen = document.createElement('div');
  screen.className = 'main-menu__screen';
  screen.append(...advanced.elements);
  document.body.append(screen);
  onTestFinished(() => {
    advanced.dispose();
    screen.remove();
  });
  const [entry] = advanced.elements;
  if (!(entry instanceof HTMLButtonElement)) throw new Error('the entry is a button');
  const shade = (): Element | null => screen.querySelector('.main-menu__dialog-shade');
  const key = (target: Element, name: string, shiftKey = false): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true }));
  };
  return { advanced, entry, rule, option, shade, key };
}

describe('the advanced settings window', () => {
  it('opens on the entry, keeps Tab inside and closes on Escape back to the entry', () => {
    const { advanced, entry, rule, option, shade, key } = mount();
    advanced.update(['Storage capacity: ×3'], false, '');
    expect(entry.textContent).toContain(TEXT.changed);
    entry.click();
    expect(shade()).not.toBeNull();
    expect(document.activeElement).toBe(rule);
    // Tab walks the drawn buttons and wraps: the rule, Restore defaults, Done, back to the rule.
    const done = [...(shade()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === TEXT.done);
    key(rule, 'Tab', true);
    expect(document.activeElement).toBe(done);
    if (done !== undefined) key(done, 'Tab');
    expect(document.activeElement).toBe(rule);
    // Escape in an open list closes the list, not the window.
    key(option, 'Escape');
    expect(shade()).not.toBeNull();
    key(rule, 'Escape');
    expect(shade()).toBeNull();
    expect(document.activeElement).toBe(entry);
  });

  it('shows a frozen window read-only with its reason and no reset', () => {
    const { advanced, entry, shade } = mount();
    advanced.update([], true, 'Only the room creator changes settings.');
    entry.click();
    const box = shade();
    expect(box?.querySelector('.main-menu__advanced-note')?.textContent).toBe(
      'Only the room creator changes settings.',
    );
    const reset = [...(box?.querySelectorAll('button') ?? [])].find((b) => b.textContent === TEXT.reset);
    expect(reset?.hidden).toBe(true);
  });

  it('leaves nothing behind when its screen is torn down while open', () => {
    const { advanced, entry, shade, key } = mount();
    advanced.update([], false, '');
    entry.click();
    advanced.dispose();
    expect(shade()).toBeNull();
    // The listener is gone: an Escape on the page reaches the page again.
    let reached = false;
    window.addEventListener('keydown', () => (reached = true), { once: true });
    key(entry, 'Escape');
    expect(reached).toBe(true);
  });
});
