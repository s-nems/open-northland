import type { SignalNode } from '@open-northland/net-protocol';
import { MAP_PING_MS, type MapPing } from '@open-northland/render';
import { MINIMAP_PLAYER_COLOURS } from '../../hud/minimap/palette.js';
import { teamColour } from '../accessibility/team-colour.js';

/** A relayed game's ping link: what the runtime sends to its allies and hears from them. */
export interface NetSignalSource {
  /** Ping `at` for the members in seats `to`. */
  send(at: SignalNode, to: readonly number[]): void;
  /** Hear each ping an ally sends; returns the call that stops listening. */
  listen(onSignal: (seat: number, at: SignalNode) => void): () => void;
}

/** The colour a ping of the player in colour slot `slot` wears: its minimap marker colour, which
 *  stands clear of the dark rims every ping stroke wears. */
export function pingColour(slot: number): number {
  return teamColour(MINIMAP_PLAYER_COLOURS[slot % MINIMAP_PLAYER_COLOURS.length] ?? 0);
}

/** A burst keeps only the newest pings on the world view. */
const MAX_PINGS = 8;
const NONE: readonly MapPing[] = [];

interface Raised {
  readonly id: number;
  readonly at: SignalNode;
  readonly colour: number;
  readonly atMs: number;
}

/** The pings showing on the world view: view state only, on the wall clock. */
export interface MapPings {
  add(at: SignalNode, colour: number): void;
  /** The pings still showing, oldest first; the same empty list while none is. */
  live(): readonly MapPing[];
}

export function createMapPings(now: () => number): MapPings {
  let raised: Raised[] = [];
  let nextId = 1;
  return {
    add: (at, colour) => {
      raised.push({ id: nextId++, at, colour, atMs: now() });
      if (raised.length > MAX_PINGS) raised.splice(0, raised.length - MAX_PINGS);
    },
    live: () => {
      if (raised.length === 0) return NONE;
      const nowMs = now();
      raised = raised.filter((ping) => nowMs - ping.atMs < MAP_PING_MS);
      if (raised.length === 0) return NONE;
      return raised.map((ping) => ({
        id: ping.id,
        hx: ping.at.hx,
        hy: ping.at.hy,
        colour: ping.colour,
        ageMs: nowMs - ping.atMs,
      }));
    },
  };
}
