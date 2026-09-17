import type { ToolWindowId } from './windows.js';

/** The seven direct entries of the navigation beam, in beam order (FOUNDATION.md). */
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
   *  mission sheet) pauses the game under it. Informational windows leave a placement running. */
  readonly cancelsHeld: boolean;
}

const EFFECTS: Readonly<Record<NavEntryId, NavEntryEffect>> = {
  build: { window: 'menu', cancelsHeld: true },
  residents: { window: 'residents', cancelsHeld: false },
  assistant: { window: 'extras', cancelsHeld: true },
  statistics: { window: 'stats', cancelsHeld: false },
  mission: { window: 'mission', cancelsHeld: true },
  diplomacy: { window: 'diplomacy', cancelsHeld: false },
  knowledge: { window: 'knowledge', cancelsHeld: false },
};

export const navEntryEffect = (id: NavEntryId): NavEntryEffect => EFFECTS[id];

/** The beam entry that owns a central window. */
export function navEntryForWindow(window: ToolWindowId): NavEntryId {
  const entry = NAV_ENTRY_IDS.find((id) => EFFECTS[id].window === window);
  if (entry === undefined) throw new Error(`nav-effects: no beam entry owns window "${window}"`);
  return entry;
}

export interface NavSurfaces {
  readonly windows: Readonly<Record<ToolWindowId, { toggle(): void; close(): void }>>;
  readonly cancelHeld: () => void;
}

/** Apply a beam entry: one central window at a time, so every other window closes before this one
 *  toggles. `open` replaces the toggle for a caller that opens the window on something of its own (a
 *  script's briefing page) and still wants the rest of the effect. */
export function applyNavEntry(surfaces: NavSurfaces, id: NavEntryId, open?: () => void): void {
  const effect = navEntryEffect(id);
  if (effect.cancelsHeld) surfaces.cancelHeld();
  for (const [window, surface] of Object.entries(surfaces.windows)) {
    if (window !== effect.window) surface.close();
  }
  if (open !== undefined) open();
  else surfaces.windows[effect.window].toggle();
}
