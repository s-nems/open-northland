import { Allowance, SIGNAL_BURST, SIGNAL_REFILL_MS } from '@open-northland/net-protocol';
import type { MousePress } from '../../hud/keybindings.js';
import type { Tile } from '../picking.js';

const LEFT_BUTTON = 0;
const RIGHT_BUTTON = 2;

/**
 * The player's map pings in a relayed game. The ping key (`mapPingMode`) or the minimap's button arms a
 * ping that the next left click places, on the world view and on either map, while a right click or Esc
 * calls it off. Pings past the relay's allowance are refused here as the relay would drop them, so a ping the
 * player sees went out too, short of link jitter at the allowance's refill edge.
 */
export interface MapPingDeps {
  /** Whether the viewer may ping now: a seated player of a relayed game. */
  readonly available: () => boolean;
  /** Send a ping at `at` and show it; the allowance has been taken. */
  readonly ping: (at: Tile) => void;
  /** A ping refused for the allowance, or a called-off armed ping. */
  readonly refused: () => void;
  /** A ping is being armed: whatever else waits for the next click gives way. */
  readonly arming: () => void;
  /** The armed state or the availability changed. */
  readonly changed: () => void;
  /** Wall-clock ms. */
  readonly now: () => number;
}

export interface MapPingController {
  available(): boolean;
  armed(): boolean;
  /** Arm a ping for the next left click, or call an armed one off. */
  toggle(): void;
  /** Call an armed ping off; true when one was armed. */
  cancel(): boolean;
  /** A press on a surface that names the spot `at`; true when the press was a ping's. */
  press(event: MousePress, at: Tile): boolean;
}

export function createMapPingController(deps: MapPingDeps): MapPingController {
  let armed = false;
  // The relay's allowance, counted the same way on this side of the link.
  const allowance = new Allowance(SIGNAL_BURST, SIGNAL_REFILL_MS, deps.now());
  const setArmed = (next: boolean): void => {
    if (armed === next) return;
    if (next) deps.arming();
    armed = next;
    deps.changed();
  };
  const fire = (at: Tile): void => {
    if (allowance.take(deps.now())) deps.ping(at);
    else deps.refused();
  };
  return {
    available: deps.available,
    armed: () => armed,
    toggle: () => {
      if (!deps.available()) return;
      setArmed(!armed);
    },
    cancel: () => {
      if (!armed) return false;
      setArmed(false);
      return true;
    },
    press: (event, at) => {
      if (!deps.available()) {
        setArmed(false);
        return false;
      }
      if (!armed) return false;
      if (event.button === LEFT_BUTTON) {
        setArmed(false);
        fire(at);
        return true;
      }
      if (event.button === RIGHT_BUTTON) {
        setArmed(false);
        deps.refused();
        return true;
      }
      return false;
    },
  };
}
