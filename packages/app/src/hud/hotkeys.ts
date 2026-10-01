import {
  isFunctionKeyCode,
  KEYBINDING_ACTIONS,
  type KeyBindings,
  type KeybindingAction,
  matchesKeyboardBinding,
  matchesKeyboardBindingUnderShift,
} from './keybindings.js';

/**
 * True when a keydown belongs to the focused control rather than the game: a text field being typed
 * into, or a `<select>`, whose own type-ahead jumps to an option by its letters.
 */
const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

/** True when the focused control keeps this keydown. No field types an F-key, so an F-row press stays
 *  the game's even from inside one. */
export const isFieldKey = (e: KeyboardEvent): boolean =>
  isTypingTarget(e.target) && !isFunctionKeyCode(e.code);

/** True for an exact, non-repeating action chord the focused control does not keep. */
export function isActionHotkey(e: KeyboardEvent, bindings: KeyBindings, action: KeybindingAction): boolean {
  return !e.repeat && !isFieldKey(e) && matchesKeyboardBinding(e, bindings[action]);
}

/** {@link isActionHotkey} for an order key, which also answers with Shift held, so arming it does not
 *  break a chain of Shift-queued orders; a chord another action is bound to exactly stays that action's. */
export function isOrderHotkey(e: KeyboardEvent, bindings: KeyBindings, action: KeybindingAction): boolean {
  if (e.repeat || isFieldKey(e)) return false;
  if (matchesKeyboardBinding(e, bindings[action])) return true;
  return (
    !KEYBINDING_ACTIONS.some((other) => matchesKeyboardBinding(e, bindings[other])) &&
    matchesKeyboardBindingUnderShift(e, bindings[action])
  );
}
