export type HeldButton = 'primary' | 'secondary';

/** Carries the held button; `cursors.css` turns the element's default and selection cursors with it. */
export const HELD_BUTTON_ATTRIBUTE = 'data-cursor-button';
/** Set when the element's parent shows the default cursor, which an element without its own rule inherits. */
export const HELD_INHERITS_ATTRIBUTE = 'data-cursor-inherits';

const PRIMARY_BUTTON = 1;
const SECONDARY_BUTTON = 2;

/** The button a mouse holds, from a pointer event's `buttons` mask; the secondary one wins. */
export function heldButton(buttons: number): HeldButton | null {
  if ((buttons & SECONDARY_BUTTON) !== 0) return 'secondary';
  return (buttons & PRIMARY_BUTTON) !== 0 ? 'primary' : null;
}

export interface HeldButtonMark {
  /** Move the mark to `target`, or drop it when no button is held or nothing is under the pointer. */
  set(target: Element | null, button: HeldButton | null): void;
}

/**
 * Marks the one element under the pointer, since only its cursor shows: a mark on the document root
 * would restyle every element that inherits the cursor variables on each press and release.
 */
export function createHeldButtonMark(defaults: {
  readonly body: () => Element;
  readonly cursorOf: (element: Element) => string;
}): HeldButtonMark {
  let marked: Element | null = null;
  const clear = (): void => {
    marked?.removeAttribute(HELD_BUTTON_ATTRIBUTE);
    marked?.removeAttribute(HELD_INHERITS_ATTRIBUTE);
    marked = null;
  };
  return {
    set(target, button) {
      if (target === null || button === null) return clear();
      if (target === marked && target.getAttribute(HELD_BUTTON_ATTRIBUTE) === button) return;
      // The old mark goes first: it may sit on the new target's parent and change what that inherits.
      clear();
      const parent = target.parentElement;
      if (parent !== null && defaults.cursorOf(parent) === defaults.cursorOf(defaults.body())) {
        target.setAttribute(HELD_INHERITS_ATTRIBUTE, '');
      }
      target.setAttribute(HELD_BUTTON_ATTRIBUTE, button);
      marked = target;
    },
  };
}
