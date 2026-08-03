/** Pure state for the menu flow. */

export type MenuScreen = 'main' | 'newGame' | 'lobby' | 'load' | 'settings' | 'credits';

/** Shown verbatim under the home logo; the credits legal line opens with the same text. */
export const VERSION_LINE = 'pre-alpha 0.1 · GPL-3.0';

export type MainNavItem =
  | { readonly id: Extract<MenuScreen, 'newGame' | 'settings' | 'credits'>; readonly kind: 'open' }
  | { readonly id: 'loadGame' | 'multiplayer'; readonly kind: 'comingSoon' }
  | { readonly id: 'exit'; readonly kind: 'exit' };

/** Main-screen nav in design order. An `open` row's id is the screen it opens;
 *  `comingSoon` rows render a badge and take no input. */
export const MAIN_NAV: readonly MainNavItem[] = [
  { id: 'newGame', kind: 'open' },
  { id: 'loadGame', kind: 'comingSoon' },
  { id: 'multiplayer', kind: 'comingSoon' },
  { id: 'settings', kind: 'open' },
  { id: 'credits', kind: 'open' },
  { id: 'exit', kind: 'exit' },
];

/** Where Esc / the back link leads; `null` on the main screen (Esc does nothing there). */
export function backTarget(screen: MenuScreen): MenuScreen | null {
  if (screen === 'main') return null;
  if (screen === 'lobby') return 'newGame';
  return 'main';
}

/**
 * Arrow-key focus move over the nav: from `from` by `delta` (+1 down, -1 up), skipping
 * `comingSoon` rows, wrapping at the ends. Returns `from` when nothing is interactive.
 */
export function moveFocus(items: readonly MainNavItem[], from: number, delta: 1 | -1): number {
  for (let step = 1; step <= items.length; step += 1) {
    const index = (((from + delta * step) % items.length) + items.length) % items.length;
    const item = items[index];
    if (item !== undefined && item.kind !== 'comingSoon') return index;
  }
  return from;
}
