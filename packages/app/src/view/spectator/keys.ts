import type { Camera } from '@open-northland/render';
import type { HalfCellNode } from '@open-northland/sim';
import type { WatchTarget } from '../../game/viewer-seat.js';
import type { KeyBindings } from '../../hud/keybindings.js';
import { spectatorKeyAction, watchTargetOf } from '../../hud/spectator-keys.js';
import type { LatestFights } from './latest-fights.js';

export interface SpectatorKeysDeps {
  readonly bindings: KeyBindings;
  /** The picker's seats, in its order. */
  readonly seats: readonly number[];
  /** Whether the viewer watches now; a player's keys stay its own until then. */
  readonly active: () => boolean;
  readonly watch: (target: WatchTarget) => void;
  readonly fights: LatestFights;
  readonly camera: () => Camera;
  readonly centreOn: (at: HalfCellNode) => void;
}

/** Where the fight key last put the camera, so the next press steps on while it still stands there. */
interface FightJump {
  readonly spot: number;
  readonly x: number;
  readonly y: number;
}

/**
 * A watching spectator's keys: a seat, the players' sight or the revealed map, and the latest fights.
 * They run before the unit controls and keep the press from them, so a digit never also recalls a
 * control group. Returns the uninstaller.
 */
export function installSpectatorKeys(deps: SpectatorKeysDeps): () => void {
  let lastJump: FightJump | null = null;

  const jumpToFight = (): void => {
    const camera = deps.camera();
    const stillThere =
      lastJump !== null && lastJump.x === camera.offsetX && lastJump.y === camera.offsetY ? lastJump : null;
    const spot = deps.fights.next(stillThere?.spot ?? null);
    if (spot === null) return;
    deps.centreOn(spot.at);
    const moved = deps.camera();
    lastJump = { spot: spot.id, x: moved.offsetX, y: moved.offsetY };
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    // A modal dialog (the bug report) keeps its keys, as it does from the tool panel.
    if (!deps.active() || (e.target instanceof Element && e.target.closest('[aria-modal="true"]') !== null))
      return;
    const action = spectatorKeyAction(e, deps.bindings);
    if (action === null) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (action === 'jumpToFight') {
      jumpToFight();
      return;
    }
    const target = watchTargetOf(action, deps.seats);
    if (target !== undefined) deps.watch(target);
  };

  // Capture phase, so the press is settled before the unit controls' own listener sees it.
  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}
