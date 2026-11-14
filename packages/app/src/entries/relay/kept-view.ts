import { type SavedView, savedViewOf } from '../../view/runtime/save-load/view-state.js';

const KEY_PREFIX = 'open-northland.relay-view:';
const MEMORY_KEY_PREFIX = 'open-northland.relay-memory:';
const NICKS_KEY_PREFIX = 'open-northland.relay-nicks:';

/** A seat and the nick last seen in it. */
export type SeatNick = readonly [player: number, nick: string];

/**
 * The control groups, the fog memory and the seats' nicks a relayed game keeps across a rebuilt world:
 * a relay snapshot carries no view of this client's, so a resync would wipe them, and a reload of this
 * tab reads them back from session storage. Keyed by relay and room; storage denial keeps them for
 * this document only.
 */
export interface KeptView {
  get(): SavedView | null;
  /** `view` null forgets them, the memory and the nicks, as leaving the game does. */
  set(view: SavedView | null): void;
  /** The presentation memory, as a save keeps it. */
  memory(): string | null;
  setMemory(memory: string | null): void;
  seatNicks(): readonly SeatNick[];
  setSeatNicks(nicks: readonly SeatNick[]): void;
}

export function keptView(relayUrl: string, roomId: string): KeptView {
  const key = `${KEY_PREFIX}${relayUrl}#${roomId}`;
  const memoryKey = `${MEMORY_KEY_PREFIX}${relayUrl}#${roomId}`;
  const nicksKey = `${NICKS_KEY_PREFIX}${relayUrl}#${roomId}`;
  let current = stored(key);
  let memory = storedText(memoryKey);
  let nicks: readonly SeatNick[] = storedNicks(nicksKey);
  const setMemory = (text: string | null): void => {
    memory = text;
    storeText(memoryKey, text);
  };
  const setSeatNicks = (next: readonly SeatNick[]): void => {
    nicks = next;
    storeText(nicksKey, next.length === 0 ? null : JSON.stringify(next));
  };
  return {
    get: () => current,
    set(view): void {
      current = view;
      try {
        if (view === null) window.sessionStorage.removeItem(key);
        else window.sessionStorage.setItem(key, JSON.stringify(view));
      } catch {
        // Unavailable storage leaves the groups to this document.
      }
      if (view === null) {
        setMemory(null);
        setSeatNicks([]);
      }
    },
    memory: () => memory,
    setMemory,
    seatNicks: () => nicks,
    setSeatNicks,
  };
}

function storeText(key: string, text: string | null): void {
  try {
    if (text === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, text);
  } catch {
    // Unavailable or full storage leaves the text to this document; an older copy must not outlive it.
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Unavailable storage holds no older copy either.
    }
  }
}

function storedNicks(key: string): SeatNick[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isSeatNick) : [];
  } catch {
    return [];
  }
}

function isSeatNick(entry: unknown): entry is SeatNick {
  return (
    Array.isArray(entry) && entry.length === 2 && Number.isInteger(entry[0]) && typeof entry[1] === 'string'
  );
}

function storedText(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function stored(key: string): SavedView | null {
  try {
    const text = window.sessionStorage.getItem(key);
    return text === null ? null : savedViewOf(JSON.parse(text));
  } catch {
    return null;
  }
}
