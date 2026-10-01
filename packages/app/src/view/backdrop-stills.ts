/** The bundled stills the menu rotates and the boot card draws from, as fingerprinted URLs. */
export const BACKDROP_STILLS: readonly string[] = Object.values(
  import.meta.glob<string>('../assets/menu-backdrops/*.jpg', {
    eager: true,
    query: '?url',
    import: 'default',
  }),
);

/** A still drawn at random from `pool`, never `avoid` while the pool holds anything else. */
export function randomStill(
  pool: readonly string[],
  avoid: string | null,
  random: () => number,
): string | null {
  const others = pool.filter((file) => file !== avoid);
  const choices = others.length > 0 ? others : pool;
  return choices[Math.floor(random() * choices.length)] ?? null;
}

/** The URL of the still the menu last showed; it outlives the page load from the menu into a game. */
const LAST_SHOWN_KEY = 'open-northland.backdrop.lastShown';

export function rememberStill(url: string): void {
  try {
    window.localStorage.setItem(LAST_SHOWN_KEY, url);
  } catch {
    // Storage denied (private mode): the handover is skipped, not an error.
  }
}

export function lastShownStill(): string | null {
  try {
    return window.localStorage.getItem(LAST_SHOWN_KEY);
  } catch {
    return null;
  }
}
