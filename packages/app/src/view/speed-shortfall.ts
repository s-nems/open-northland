import type { SpeedBarLook } from '../hud/dom/system-bar.js';
import { formatRoomSpeed } from '../hud/network/text.js';
import { presetAtOrBelow } from '../hud/tool-panel/game-speed.js';
import { formatMessage, messages } from '../i18n/index.js';

/** The delivered speed averages a second or less, good to about a tenth; more digits would overstate it. */
const TENTHS = 10;

/** The speed bar's look while a local game sustains less than its requested speed: the preset it
 *  reaches pressed and dimmed, the title naming both speeds. Null while it keeps up. */
export function shortfallLook(delivered: number | null, requested: number): SpeedBarLook | null {
  if (delivered === null) return null;
  return {
    kind: 'slowed',
    title: formatMessage(messages().hud.speedShortfall, {
      delivered: formatRoomSpeed(Math.round(delivered * TENTHS) / TENTHS),
      requested: formatRoomSpeed(requested),
    }),
    pressed: presetAtOrBelow(delivered),
  };
}

/** {@link shortfallLook} for a caller that asks every frame: the same look until its figure to the
 *  tenth or the request moved. */
export function createShortfallLook(): (delivered: number | null, requested: number) => SpeedBarLook | null {
  let shownTenths: number | null | undefined;
  let shownRequested = 0;
  let look: SpeedBarLook | null = null;
  return (delivered, requested) => {
    const tenths = delivered === null ? null : Math.round(delivered * TENTHS);
    if (tenths !== shownTenths || requested !== shownRequested) {
      shownTenths = tenths;
      shownRequested = requested;
      look = shortfallLook(delivered, requested);
    }
    return look;
  };
}
