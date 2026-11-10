import type { SignalNode } from '@open-northland/net-protocol';
import type { MapPing } from '@open-northland/render';
import type { DiplomacyState } from '@open-northland/sim';
import { type KeyBindings, keyDisplayLabel } from '../../hud/keybindings.js';
import type { MinimapHandle } from '../../hud/minimap/index.js';
import { setCanvasCursor } from '../cursors/element.js';
import { createMapPingController, type MapPingController } from './controller.js';
import { createMapPings, type NetSignalSource, pingColour } from './pings.js';

export interface MapPingSessionDeps {
  readonly source: NetSignalSource;
  readonly bindings: KeyBindings;
  readonly canvas: HTMLCanvasElement;
  /** The seat the viewer plays, null while it only watches, whichever seat it watches. */
  readonly seat: () => number | null;
  /** The map roster's seats. */
  readonly roster: readonly number[];
  /** Seat `from`'s stance toward seat `to`, as this client's world holds it. */
  readonly stance: (from: number, to: number) => DiplomacyState;
  /** The half-cell node grid's size, which a heard ping is clamped into. */
  readonly nodes: { readonly width: number; readonly height: number };
  /** A seat's colour slot. */
  readonly colourSlot: (seat: number) => number;
  /** Mounted after the session, so read when needed. */
  readonly minimap: () => Pick<MinimapHandle, 'signal' | 'setSignal'> | undefined;
  /** Whether a held tool (a placement, a road or wall brush) waits for the next click. */
  readonly toolHeld: () => boolean;
  /** Put every held tool down. */
  readonly callOffTools: () => void;
  /** A ping shows: the viewer's own or an ally's. */
  readonly rang: () => void;
  /** A ping refused or called off. */
  readonly refused: () => void;
  readonly now: () => number;
}

export interface MapPingSession {
  readonly controller: MapPingController;
  /** The pings showing on the world view. */
  readonly live: () => readonly MapPing[];
  /** Per frame: an armed ping gives way to a lost seat or a tool taken up after it, and the minimap's
   *  button follows what changed. */
  refresh(): void;
  dispose(): void;
}

/**
 * A relayed game's map pings: the player's own, sent to the seats it is a friend of, and theirs, heard
 * from the link. A heard ping shows only from a seat that is a friend of the viewer's, the rule its
 * sender applies; the relay trusts the sender's list of seats, a modified client's included.
 */
export function createMapPingSession(deps: MapPingSessionDeps): MapPingSession {
  const pings = createMapPings(deps.now);
  const show = (seat: number, at: SignalNode): void => {
    const colour = pingColour(deps.colourSlot(seat));
    deps.minimap()?.signal(at, colour);
    pings.add(at, colour);
    deps.rang();
  };
  const heard = (from: number, at: SignalNode): void => {
    const seat = deps.seat();
    if (seat === null || from === seat || deps.stance(from, seat) !== 'friend') return;
    show(from, {
      hx: Math.min(at.hx, deps.nodes.width - 1),
      hy: Math.min(at.hy, deps.nodes.height - 1),
    });
  };
  let shown = '';
  const refresh = (): void => {
    if (controller.armed() && (!controller.available() || deps.toolHeld())) controller.cancel();
    const minimap = deps.minimap();
    if (minimap === undefined) return;
    const { mapPingMode } = deps.bindings;
    const key = `${controller.available()}|${controller.armed()}|${mapPingMode}`;
    if (key === shown) return;
    shown = key;
    const keys = mapPingMode === null ? [] : [keyDisplayLabel(mapPingMode)];
    minimap.setSignal({ available: controller.available(), armed: controller.armed(), keys });
  };
  const controller = createMapPingController({
    available: () => deps.seat() !== null,
    ping: (at) => {
      const seat = deps.seat();
      if (seat === null) return;
      const node = { hx: at.col, hy: at.row };
      const allies = deps.roster.filter((other) => other !== seat && deps.stance(seat, other) === 'friend');
      deps.source.send(node, allies);
      show(seat, node);
    },
    refused: deps.refused,
    arming: () => {
      if (deps.toolHeld()) deps.callOffTools();
    },
    changed: () => {
      refresh();
      setCanvasCursor(deps.canvas, 'signal', controller.armed() ? 'crosshair' : null);
    },
    now: deps.now,
  });
  const stopListening = deps.source.listen(heard);
  return { controller, live: pings.live, refresh, dispose: stopListening };
}
