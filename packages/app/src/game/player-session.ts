import { MAP_PLAYER_COLOR_COUNT, type MapScript } from '@open-northland/data';
import { components } from '@open-northland/sim';
import { HUMAN_PLAYER } from './rules.js';

const { isValidPlayer } = components;

/**
 * The local player session a `?map=` start carries from the menu: which roster seat the person controls
 * (`?player=N`) and each slot's team colour (`?colors=<slot>:<colorId>,…`, overriding the map script's
 * authored colours). Pure param parsing and colour-map building. The roster's AI toggles ride separately
 * as `?ai=<seat>,…`.
 */

/** The two spectator pseudo-seats the menu offers in place of a slot. Both drop fog and make every
 *  player's entities pickable; they differ only in whether the HUD may issue commands. */
const OBSERVER = 'observer';
const OVERSEER = 'overseer';

/** `?player=observer|overseer`: either spectator pseudo-seat. The seat-number reads still fall back to
 *  {@link HUMAN_PLAYER} for placement and HUD ownership. */
export function observerParam(params: URLSearchParams): boolean {
  const player = params.get('player');
  return player === OBSERVER || player === OVERSEER;
}

/** `?player=observer`: the read-only spectator, which inspects any entity but issues no commands.
 *  False for `overseer`, which keeps full control of every seat. */
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

/** Parses `?colors=<slot>:<colorId>,…` into slot to colour overrides, dropping malformed pairs. Colours
 *  are bounded to the roster's id space, because an out-of-range id renders differently per consumer. */
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
 * Builds the owner to team-colour mapping for one map: the script roster's authored colours, then the
 * menu's `?colors=` overrides. A player outside the roster keeps its slot id as its colour.
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
