import type { WatchTarget } from '../game/viewer-seat.js';
import type { KeyBindings } from '../hud/keybindings.js';
import { spectatorKeyAction, watchTargetOf } from '../hud/spectator-keys.js';

export interface SpectatorKeysDeps {
  readonly bindings: KeyBindings;
  /** The picker's seats, in its order. */
  readonly seats: readonly number[];
  /** Whether the viewer watches now; a player's keys stay its own until then. */
  readonly active: () => boolean;
  readonly watch: (target: WatchTarget) => void;
}

/**
 * A watching spectator's keys: a seat, the players' sight or the revealed map.
 * They run before the unit controls and keep the press from them, so a digit never also recalls a
 * control group. Returns the uninstaller.
 */
export function installSpectatorKeys(deps: SpectatorKeysDeps): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    // A modal dialog (the bug report) keeps its keys, as it does from the tool panel.
    if (!deps.active() || (e.target instanceof Element && e.target.closest('[aria-modal="true"]') !== null))
      return;
    const action = spectatorKeyAction(e, deps.bindings);
    if (action === null) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = watchTargetOf(action, deps.seats);
    if (target !== undefined) deps.watch(target);
  };

  // Capture phase, so the press is settled before the unit controls' own listener sees it.
  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}
