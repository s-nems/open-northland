/**
 * The hold-to-reveal key: while it is down, the world's standing sprites that hide a resident draw
 * translucent, so a look behind them costs no click. View state only - the key runs no command, so it
 * keeps no keybindings entry - and a text field's typing never triggers it.
 */

/** The reveal holds on either Alt key: a bare modifier no binding takes on its own, where a letter key
 *  would share its press with a shortcut. */
const REVEAL_KEY = 'Alt';

/** The held reveal key: {@link held} reads it, {@link dispose} uninstalls the listeners. */
export interface RevealKey {
  readonly held: () => boolean;
  readonly dispose: () => void;
}

export function createRevealKey(): RevealKey {
  let held = false;
  // A chat box or a modal dialog takes the key for itself: the world behind it must not shimmer, and
  // the dialog's own keys stay theirs.
  const typing = (e: KeyboardEvent): boolean =>
    e.target instanceof Element &&
    e.target.closest('input, textarea, [contenteditable="true"], [aria-modal="true"]') !== null;
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== REVEAL_KEY || e.repeat || typing(e)) return;
    held = true;
    // A lone Alt press would otherwise hand focus to the browser's menu bar on release.
    e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key !== REVEAL_KEY) return;
    held = false;
    e.preventDefault();
  };
  // Losing focus mid-hold drops the keyup, which would leave the fade stuck on.
  const onBlur = (): void => {
    held = false;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return {
    held: () => held,
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
