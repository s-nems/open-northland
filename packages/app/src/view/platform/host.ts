import type { DesktopCursorConfine } from './cursor-confine.js';
import type { DesktopMaps } from './desktop-bridge.js';
import type { DesktopFaults } from './desktop-faults.js';
import type { DesktopFullscreen } from './fullscreen.js';
import type { DesktopOriginalGame } from './original-game-check.js';

declare global {
  interface Window {
    /** The desktop shell's preload bridge; absent in a browser. */
    readonly desktop?: {
      readonly fullscreen: DesktopFullscreen;
      /** Absent where the shell cannot hold the cursor inside its window. */
      readonly cursorConfine?: DesktopCursorConfine;
      readonly originalGame: DesktopOriginalGame;
      /** Absent in a shell build without the installed-map store. */
      readonly maps?: DesktopMaps;
      /** Absent in a shell build without fault recording. */
      readonly faults?: DesktopFaults;
    };
  }
}

/** The schemes a browser serves the app from; the desktop shell serves its own. */
const BROWSER_PROTOCOLS: readonly string[] = ['http:', 'https:'];

export function servedByBrowser(): boolean {
  return BROWSER_PROTOCOLS.includes(window.location.protocol);
}
