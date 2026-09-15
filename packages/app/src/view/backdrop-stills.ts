/** Names a still under `content/backdrops/`, and outlives the page load from the menu into a game. */
const LAST_SHOWN_KEY = 'open-northland.backdrop.lastShown';
/** The pool a visit fetched, so the next launch can paint a still before any network round trip. */
const POOL_KEY = 'open-northland.backdrop.pool';

export function stillUrl(file: string): string {
  return `/backdrops/${encodeURIComponent(file)}`;
}

/** An array of file names; any other payload reads as absent. */
export function parseStillList(payload: unknown): readonly string[] | null {
  if (!Array.isArray(payload)) return null;
  const files = payload.filter((entry): entry is string => typeof entry === 'string');
  return files.length === payload.length ? files : null;
}

export function rememberStill(file: string): void {
  try {
    window.localStorage.setItem(LAST_SHOWN_KEY, file);
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

export function rememberPool(files: readonly string[]): void {
  try {
    window.localStorage.setItem(POOL_KEY, JSON.stringify(files));
  } catch {
    // Storage denied (private mode): every launch opens on the static art.
  }
}

/** Empty until a visit has cached a pool, and after one that found `content/backdrops/` gone. */
export function cachedPool(): readonly string[] {
  try {
    const raw = window.localStorage.getItem(POOL_KEY);
    return (raw === null ? null : parseStillList(JSON.parse(raw))) ?? [];
  } catch {
    return [];
  }
}
