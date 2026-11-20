/**
 * The reveal toggle: while it is on, the world's standing sprites draw translucent, so a look past
 * them costs no click — the scan fades every tree, wall and house on the screen at once, whether or
 * not a unit hides behind one. View state only - the key runs no command, so it keeps no keybindings
 * entry - and a text field's typing never triggers it.
 */

/** The reveal toggles on Space, by its code: no modifier combos share it, and a hold-to-fade key
 *  asks for a hand the camera and the orders already take. The key name is the code, not the key -
 *  a Space press's `key` is the bare character. */
const REVEAL_KEY_CODE = 'Space';

/** The toggle's state: {@link toggled} reads it, {@link dispose} uninstalls the listener. */
export interface RevealKey {
  readonly toggled: () => boolean;
  readonly dispose: () => void;
}

export function createRevealKey(): RevealKey {
  let toggled = false;
  // A chat box, a modal dialog or a focused control takes the key for itself: the world behind it
  // must not shimmer, and the control's own Space activation - a button's click, a select's open -
  // stays theirs.
  const typing = (e: KeyboardEvent): boolean =>
    e.target instanceof Element &&
    e.target.closest('input, textarea, select, button, [contenteditable="true"], [aria-modal="true"]') !==
      null;
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== REVEAL_KEY_CODE || typing(e)) return;
    // A bare Space press would otherwise scroll the page, and its repeat would keep the scroll going.
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
