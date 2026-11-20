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
  close: 'Close',
  hostOnly: 'Only the room creator changes these settings.',
};

function mount() {
  // jsdom lays nothing out; as a browser does, a hidden element and a closed list's rows draw no box.
  const proto = Element.prototype;
  const original = proto.getClientRects;
  proto.getClientRects = function (this: Element) {
    const drawn = this.closest('[hidden], [popover]') === null;
    return (drawn ? [new DOMRect()] : []) as unknown as DOMRectList;
  };
  // Nor does it implement popovers; a hidden list draws nothing either way.
  const popovers = HTMLElement.prototype as Partial<Pick<HTMLElement, 'hidePopover'>>;
  popovers.hidePopover = () => {};
  onTestFinished(() => {
    proto.getClientRects = original;
    delete popovers.hidePopover;
  });
  // A dropdown field with its choice list open inside the window, laid out as the dropdown does.
  const rule = document.createElement('button');
  rule.textContent = 'rule';
  const list = document.createElement('div');
  list.setAttribute('popover', '');
  const option = document.createElement('button');
  list.append(option);
  const field = document.createElement('div');
  field.append(rule, list);
  const advanced = advancedSettings({
    text: TEXT,
    groups: [{ title: TEXT.rulesGroup, rows: [field] }],
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
  const [entry, summary] = advanced.elements;
  if (!(entry instanceof HTMLButtonElement)) throw new Error('the entry is a button');
  const shade = (): Element | null => screen.querySelector('.main-menu__dialog-shade');
  const button = (label: string): HTMLButtonElement | undefined =>
    [...(shade()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === label);
  const key = (target: Element, name: string, shiftKey = false): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true }));
  };
  return { advanced, entry, summary, rule, option, shade, button, key };
}

describe('the advanced settings window', () => {
  it('opens on the entry, keeps Tab inside and closes on Escape back to the entry', () => {
    const { advanced, entry, summary, rule, option, shade, button, key } = mount();
    advanced.update(['Storage capacity: ×3'], false, '');
    expect(entry.textContent).toContain(TEXT.changed);
    expect(entry.getAttribute('aria-describedby')).toBe(summary?.id);
    entry.click();
    expect(shade()).not.toBeNull();
    expect(document.activeElement).toBe(rule);
    // Tab walks the drawn buttons and wraps: the rule, Restore defaults, Done, back to the rule.
    const done = button(TEXT.done);
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

  it('steps on from an open list as from its closed field, never out of the window', () => {
    const { advanced, entry, option, button, key } = mount();
    advanced.update([], false, '');
    entry.click();
    // Past the field, Restore defaults has nothing to restore: Done is next.
    key(option, 'Tab');
    expect(document.activeElement).toBe(button(TEXT.done));
  });

  it('moves the focus to Done when a reset leaves nothing to restore', () => {
    const { advanced, entry, button } = mount();
    advanced.update(['Storage capacity: ×3'], false, '');
    entry.click();
    button(TEXT.reset)?.focus();
    advanced.update([], false, '');
    expect(document.activeElement).toBe(button(TEXT.done));
  });

  it('shows a frozen window read-only with its reason and no reset', () => {
    const { advanced, entry, shade } = mount();
    advanced.update([], true, 'Only the room creator changes settings.');
    entry.click();
    const box = shade();
    expect(box?.querySelector('.main-menu__advanced-note')?.textContent).toBe(
      'Only the room creator changes settings.',
    );
    const buttons = [...(box?.querySelectorAll('button') ?? [])];
    expect(buttons.find((b) => b.textContent === TEXT.reset)?.hidden).toBe(true);
    expect(buttons.some((b) => b.textContent === TEXT.close)).toBe(true);
    expect(box?.querySelector('.main-menu__advanced')?.classList.contains('is-readonly')).toBe(true);
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
