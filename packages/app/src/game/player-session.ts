import { MAP_PLAYER_COLOR_COUNT, type MapScript } from '@open-northland/data';
import { components } from '@open-northland/sim';
import { HUMAN_PLAYER } from './rules.js';

const { isValidPlayer } = components;

/**
 * The local player session a `?map=` start carries from the menu: which roster seat the person
 * controls (`?player=N`) and each slot's team colour (`?colors=<slot>:<colorId>,…` overrides over
 * the map script's authored colours). Pure param parsing + colour-map building, unit-tested; the
 * map entry feeds the result into the renderer (LUT rows), the minimap (dot swatches) and the
 * shared game view (fog/controls/HUD perspective). `?vacant=<slot>:<idle|ai>,…` (unclaimed
 * claimable seats toggled away from their authored default) is menu-authored but has no consumer
 * yet — the future AI player reads it (docs/tickets/features/vacant-seat-ai-player.md).
 */

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
