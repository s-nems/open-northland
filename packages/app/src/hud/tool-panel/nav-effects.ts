import type { ToolWindowId } from './windows.js';

/** The seven direct entries of the navigation beam, in beam order. */
export const NAV_ENTRY_IDS = [
  'build',
  'residents',
  'assistant',
  'statistics',
  'mission',
  'diplomacy',
  'knowledge',
] as const;

export type NavEntryId = (typeof NAV_ENTRY_IDS)[number];

export interface NavEntryEffect {
  /** The central window the entry toggles. */
  readonly window: ToolWindowId;
  /** Cancel an active placement or held paper first: the window starts a pick of its own, or (the
   *  mission book) covers the map it holds still. Informational windows leave a placement running. */
  readonly cancelsHeld: boolean;
}

const EFFECTS: Readonly<Record<NavEntryId, NavEntryEffect>> = {
  build: { window: 'menu', cancelsHeld: true },
  residents: { window: 'residents', cancelsHeld: false },
  assistant: { window: 'assistant', cancelsHeld: false },
  statistics: { window: 'stats', cancelsHeld: false },
  mission: { window: 'mission', cancelsHeld: true },
  diplomacy: { window: 'diplomacy', cancelsHeld: false },
  knowledge: { window: 'knowledge', cancelsHeld: false },
};

export const navEntryEffect = (id: NavEntryId): NavEntryEffect => EFFECTS[id];

/** The beam entry that owns a central window; null for one the beam does not open (the network
 *  window, which its hotkey and the game menu open). */
export function navEntryForWindow(window: ToolWindowId): NavEntryId | null {
  return NAV_ENTRY_IDS.find((id) => EFFECTS[id].window === window) ?? null;
}

export interface NavSurfaces {
  readonly windows: Readonly<Record<ToolWindowId, { isOpen(): boolean; toggle(): void; close(): void }>>;
  readonly cancelHeld: () => void;
}

/** Apply a beam entry: one central window at a time, so every other window closes before this one
 *  toggles. `open` replaces the toggle for a caller that opens the window on something of its own (a
 *  script's briefing page) and still wants the rest of the effect. A cancelled placement brings the
 *  construction window back by itself; when that is the entry's own window, the press is done. */
export function applyNavEntry(surfaces: NavSurfaces, id: NavEntryId, open?: () => void): void {
  const effect = navEntryEffect(id);
  const target = surfaces.windows[effect.window];
  const wasOpen = target.isOpen();
  if (effect.cancelsHeld) surfaces.cancelHeld();
  for (const [window, surface] of Object.entries(surfaces.windows)) {
    if (window !== effect.window) surface.close();
  }
  if (open !== undefined) open();
  else if (wasOpen || !target.isOpen()) target.toggle();
}
