/**
 * The hold-to-reveal key: while it is down, the world's standing sprites that hide a resident draw
 * translucent, so a look behind them costs no click. View state only - the key runs no command, so it
 * keeps no keybindings entry - and a text field's typing never triggers it.
 */

/** The physical key the reveal holds on, wherever the layout maps it. */
const REVEAL_KEY = 'KeyT';

/** The held reveal key: {@link held} reads it, {@link dispose} uninstalls the listeners. */
export interface RevealKey {
  readonly held: () => boolean;
  readonly dispose: () => void;
}

export function createRevealKey(): RevealKey {
  let held = false;
  // A chat box or a modal dialog takes the key for itself: typing a t must not shimmer the world
  // behind it, and the dialog's own keys stay theirs.
  const typing = (e: KeyboardEvent): boolean =>
    e.target instanceof Element &&
    e.target.closest('input, textarea, [contenteditable="true"], [aria-modal="true"]') !== null;
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === REVEAL_KEY && !e.repeat && !typing(e)) held = true;
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === REVEAL_KEY) held = false;
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
