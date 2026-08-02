/** True when a keydown originated in a text-entry element - a game hotkey must not fire while typing. */
const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable);

/**
 * Whether `e` is a plain press of `code` that a game hotkey should act on: a modifier combo stays the
 * browser's (Cmd/Ctrl+A is select-all, Cmd/Ctrl+P is print), a held key must not repeat the action, and
 * typing into a field must never issue an order.
 */
export function isPlainHotkey(e: KeyboardEvent, code: string): boolean {
  return e.code === code && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target);
}
