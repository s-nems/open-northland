export type MenuScreen = 'main' | 'multiplayer' | 'newGame' | 'lobby' | 'load' | 'settings' | 'credits';

declare const __GAME_VERSION__: string;

const GAME_VERSION = typeof __GAME_VERSION__ === 'string' ? __GAME_VERSION__ : 'dev';

export const VERSION_LINE = `pre-alpha ${GAME_VERSION} · AGPL-3.0`;

export type MainNavItem =
  | {
      readonly id: Extract<MenuScreen, 'newGame' | 'load' | 'multiplayer' | 'settings' | 'credits'>;
      readonly kind: 'open';
    }
  | { readonly id: 'exit'; readonly kind: 'exit' };

/** Main-screen nav in display order. The credits row is hidden until its screen has real content. */
export const MAIN_NAV: readonly MainNavItem[] = [
  { id: 'newGame', kind: 'open' },
  { id: 'load', kind: 'open' },
  { id: 'multiplayer', kind: 'open' },
  { id: 'settings', kind: 'open' },
  { id: 'exit', kind: 'exit' },
];

/** Where Esc and the back link lead; `null` on the main screen. */
export function backTarget(screen: MenuScreen): MenuScreen | null {
  if (screen === 'main') return null;
  if (screen === 'lobby') return 'newGame';
  return 'main';
}

/** Moves focus by `delta` (+1 down, -1 up) over the rows, wrapping at the ends. */
export function moveFocus(items: readonly MainNavItem[], from: number, delta: 1 | -1): number {
  if (items.length === 0) return from;
  return (((from + delta) % items.length) + items.length) % items.length;
}
