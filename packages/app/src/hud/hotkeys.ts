/** True when a keydown originated in a text-entry element - a game hotkey must not fire while typing. */
const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable);

/**
 * Whether `e` is a plain, non-repeating press of `code` outside a text field: modifier combos stay with
 * the browser, and a held key must not repeat the action.
 */
export function isPlainHotkey(e: KeyboardEvent, code: string): boolean {
  return e.code === code && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target);
}
