import { type KeyBindings, type KeybindingAction, matchesKeyboardBinding } from './keybindings.js';

/** True when a keydown originated in a text-entry element - a game hotkey must not fire while typing. */
export const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable);

/** True for an exact, non-repeating action chord outside a text field. */
export function isActionHotkey(e: KeyboardEvent, bindings: KeyBindings, action: KeybindingAction): boolean {
  return !e.repeat && !isTypingTarget(e.target) && matchesKeyboardBinding(e, bindings[action]);
}
