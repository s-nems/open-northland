import { MAP_PLAYER_COLOR_COUNT, type MapScript } from '@open-northland/data';
import { components } from '@open-northland/sim';
import { HUMAN_PLAYER } from './rules.js';

const { isValidPlayer } = components;

/**
 * The local player session a `?map=` start carries from the menu: which roster seat the person
 * controls (`?player=N`) and each slot's team colour (`?colors=<slot>:<colorId>,…` overrides over
 * the map script's authored colours). Pure param parsing + colour-map building, unit-tested; the
 * map entry feeds the result into the renderer (LUT rows), the minimap (dot swatches) and the
 * shared game view (fog/controls/HUD perspective). The roster's AI toggles ride separately as
 * `?ai=<seat>,…` (`aiSeatsParam` in view/params.ts), consumed by the map entry's `setPlayerAi`
 * wiring.
 */

/** The two spectator pseudo-seats the menu offers in place of a slot: a read-only `observer` (watch
 *  and inspect any entity, issue no commands) and an `overseer` god-mode (watch and command every
 *  seat). Both drop fog and make every player's entities pickable; they differ only in whether the
 *  HUD may issue commands (see {@link readOnlyObserverParam}). */
const OBSERVER = 'observer';
const OVERSEER = 'overseer';

/** `?player=observer|overseer` — either spectator pseudo-seat (the roster's `OBSERVER_SEAT` /
 *  `OVERSEER_SEAT`): a session with no fog view and every player's entities pickable. The seat-number
 *  reads ({@link localPlayerParam}) fall back to {@link HUMAN_PLAYER} for placement/HUD ownership. */
export function observerParam(params: URLSearchParams): boolean {
  const player = params.get('player');
  return player === OBSERVER || player === OVERSEER;
}

/** `?player=observer` — the read-only spectator: it selects and inspects any entity but issues no
 *  commands (the game view no-ops its command seam). False for the `overseer` god-mode, which keeps
 *  full control of every seat. */
export function readOnlyObserverParam(params: URLSearchParams): boolean {
  return params.get('player') === OBSERVER;
}

/** The controlled seat: `?player=N` when it names a valid player slot, else {@link HUMAN_PLAYER}. */
export function localPlayerParam(params: URLSearchParams): number {
  const raw = params.get('player');
  if (raw === null) return HUMAN_PLAYER;
  const n = Number.parseInt(raw, 10);
  return isValidPlayer(n) ? n : HUMAN_PLAYER;
}

/** Parses `?colors=<slot>:<colorId>,…` into slot → colour overrides (malformed pairs drop).
 *  Colours are bounded to the roster's id space: an out-of-range id would render differently per
 *  consumer (the sprite LUT clamps, the minimap wraps, the signpost atlas misses). */
export function colorOverridesParam(params: URLSearchParams): ReadonlyMap<number, number> {
  const out = new Map<number, number>();
  const raw = params.get('colors');
  if (raw === null) return out;
  for (const pair of raw.split(',')) {
    const [slotRaw, colorRaw] = pair.split(':');
    const slot = Number.parseInt(slotRaw ?? '', 10);
    const color = Number.parseInt(colorRaw ?? '', 10);
    if (isValidPlayer(slot) && Number.isInteger(color) && color >= 0 && color < MAP_PLAYER_COLOR_COUNT) {
      out.set(slot, color);
    }
  }
  return out;
}

/**
 * Builds the owner→team-colour mapping for one map: the script roster's authored colours, then the
 * menu's `?colors=` overrides. A player outside the roster keeps its slot id as the colour (the
 * app-wide default — LUT row = player id — so scenes and roster-less maps look unchanged).
 */
export function playerColourMap(
  script: Pick<MapScript, 'players'> | null,
  overrides: ReadonlyMap<number, number>,
): (player: number) => number {
  const bySlot = new Map<number, number>();
  for (const p of script?.players ?? []) bySlot.set(p.player, p.colorId);
  for (const [slot, color] of overrides) bySlot.set(slot, color);
  if (bySlot.size === 0) return (player) => player;
  return (player) => bySlot.get(player) ?? player;
}
