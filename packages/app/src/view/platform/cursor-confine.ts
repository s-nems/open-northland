import { type MenuSettings, onStoredSettingsChange, readStoredSettings } from '../settings/store.js';
import { fullscreenOptedOut, isFullscreen } from './fullscreen.js';

export type CursorConfineMode = MenuSettings['cursorConfine'];

/**
 * The desktop shell's hold on the system cursor, exposed by its preload where the shell has one. A
 * browser page cannot keep the cursor inside its window.
 */
export interface DesktopCursorConfine {
  set(mode: CursorConfineMode): Promise<void>;
}

export function cursorConfineAvailable(): boolean {
  return window.desktop?.cursorConfine !== undefined;
}

/** A scripted session never takes the cursor of whoever shares the machine. */
function effectiveMode(settings: MenuSettings): CursorConfineMode {
  return fullscreenOptedOut(new URLSearchParams(window.location.search)) ? 'never' : settings.cursorConfine;
}

/** Whether the shell keeps the cursor inside this window while it has the focus. */
export function cursorConfined(): boolean {
  if (!cursorConfineAvailable()) return false;
  const mode = effectiveMode(readStoredSettings());
  return mode === 'always' || (mode === 'fullscreen' && isFullscreen());
}

/** Hand the shell the stored choice now and whenever it changes. */
export function installCursorConfine(): void {
  const confine = window.desktop?.cursorConfine;
  if (confine === undefined) return;
  let sent: CursorConfineMode | null = null;
  const apply = (settings: MenuSettings): void => {
    const mode = effectiveMode(settings);
    if (mode === sent) return;
    sent = mode;
    void confine.set(mode).catch(() => undefined);
  };
  onStoredSettingsChange(apply);
  apply(readStoredSettings());
}
