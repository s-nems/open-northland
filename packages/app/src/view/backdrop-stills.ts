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
