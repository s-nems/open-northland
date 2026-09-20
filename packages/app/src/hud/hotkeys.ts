import { type KeyBindings, type KeybindingAction, matchesKeyboardBinding } from './keybindings.js';

/**
 * True when a keydown belongs to the focused control rather than the game: a text field being typed
 * into, or a `<select>`, whose own type-ahead jumps to an option by its letters.
 */
export const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

/** True for an exact, non-repeating action chord outside a text field. */
export function isActionHotkey(e: KeyboardEvent, bindings: KeyBindings, action: KeybindingAction): boolean {
  return !e.repeat && !isTypingTarget(e.target) && matchesKeyboardBinding(e, bindings[action]);
}
