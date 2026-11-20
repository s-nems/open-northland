/**
 * The reveal toggle: while it is on, the world's standing sprites draw translucent, so a look past
 * them costs no click — the scan fades every tree, wall and house on the screen at once, whether or
 * not a unit hides behind one. The key is the settings' `revealToggle` binding, Tab by default, read
 * per press so a rebind in the controls settings applies at once; a text field's typing never
 * triggers it.
 */

import { matchesKeyboardBinding } from '../hud/keybindings.js';

/** The toggle's state: {@link toggled} reads it, {@link dispose} uninstalls the listener. */
export interface RevealKey {
  readonly toggled: () => boolean;
  readonly dispose: () => void;
}

/** `binding` reads the settings' `revealToggle` chord each press — `null` is unbound, no press
 *  toggles. The game view hands its in-place-updated key bindings, so a rebind needs no re-create. */
export function createRevealKey(binding: () => string | null): RevealKey {
  let toggled = false;
  // A chat box, a modal dialog or a focused control takes the key for itself: the world behind it
  // must not shimmer, and the control's own activation - a button's click, a select's open - stays
  // theirs.
  const typing = (e: KeyboardEvent): boolean =>
    e.target instanceof Element &&
    e.target.closest('input, textarea, select, button, [contenteditable="true"], [aria-modal="true"]') !==
      null;
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!matchesKeyboardBinding(e, binding()) || typing(e)) return;
    // The press must not reach the page: a Space would scroll it, and a Tab would walk the focus
    // out of the game. A held key's repeats keep neither going.
    e.preventDefault();
    if (e.repeat) return;
    toggled = !toggled;
  };
  window.addEventListener('keydown', onKeyDown);
  return {
    toggled: () => toggled,
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
