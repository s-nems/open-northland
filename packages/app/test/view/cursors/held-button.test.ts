import { expect, it } from 'vitest';
import {
  createHeldButtonMark,
  HELD_BUTTON_ATTRIBUTE,
  HELD_INHERITS_ATTRIBUTE,
  heldButton,
} from '../../../src/view/cursors/held-button.js';

interface FakeElement {
  readonly parentElement: FakeElement | null;
  readonly attributes: Map<string, string>;
  readonly ownCursor: string | null;
}

const DEFAULT = 'default-cursor';
const PRESSED = 'pressed-cursor';

function element(parentElement: FakeElement | null, ownCursor: string | null = null): FakeElement & Element {
  const attributes = new Map<string, string>();
  const fake = {
    parentElement,
    attributes,
    ownCursor,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  };
  return fake as unknown as FakeElement & Element;
}

/** The stylesheet's outcome: a marked default cursor turns, and an undeclared one inherits. */
function cursorOf(target: FakeElement): string {
  const own = target.ownCursor ?? (target.parentElement === null ? DEFAULT : null);
  if (own === null) {
    const inherited = cursorOf(target.parentElement as FakeElement);
    return target.attributes.has(HELD_INHERITS_ATTRIBUTE) ? PRESSED : inherited;
  }
  return own === DEFAULT && target.attributes.has(HELD_BUTTON_ATTRIBUTE) ? PRESSED : own;
}

it('reads the held button off the buttons mask, the secondary one first', () => {
  expect(heldButton(0)).toBeNull();
  expect(heldButton(1)).toBe('primary');
  expect(heldButton(3)).toBe('secondary');
  expect(heldButton(4)).toBeNull();
});

it('marks only the element under the pointer and moves the mark with it', () => {
  const body = element(null);
  const panel = element(body);
  const label = element(panel);
  const button = element(panel, 'pointer-cursor');
  const icon = element(button);
  const mark = createHeldButtonMark({ body: () => body, cursorOf: (e) => cursorOf(e as never) });

  mark.set(panel, 'primary');
  expect(cursorOf(panel)).toBe(PRESSED);
  expect(body.attributes.size).toBe(0);

  // The panel's mark must be gone before its child asks what it inherits.
  mark.set(label, 'primary');
  expect(panel.attributes.size).toBe(0);
  expect(label.attributes.has(HELD_INHERITS_ATTRIBUTE)).toBe(true);

  mark.set(icon, 'secondary');
  expect(label.attributes.size).toBe(0);
  expect(icon.getAttribute(HELD_BUTTON_ATTRIBUTE)).toBe('secondary');
  expect(icon.attributes.has(HELD_INHERITS_ATTRIBUTE)).toBe(false);
  expect(cursorOf(icon)).toBe('pointer-cursor');

  mark.set(icon, null);
  expect(icon.attributes.size).toBe(0);
});
