import type { LifeHeart } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import {
  actorsOf,
  healthOf,
  isSettler,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
  settlerTribeOf,
} from '../../game/snapshot.js';

/** Heart colour for a player outside the swatch table - unreachable today (index taken modulo the
 *  table length); named like the minimap's stray-dot colour. */
const UNKNOWN_PLAYER_HEART_COLOUR = 0xffffff;

/**
 * The livestock-heart projection: every CLAIMED animal (a settler of a livestock tribe carrying an
 * `Owner`) becomes one faction-coloured heart the render {@link LifeHeart} layer floats over its
 * back, filled to the animal's remaining life fraction - the original's "the claimed sheep shows the
 * owner's life heart" read. Pure over the snapshot plus two seams: `isLivestockTribe` (the sim
 * content's catchable-species classification, resolved by the caller) and the roster's slot-to-colour
 * mapping (the minimap-dot rule: `playerColourOf` picks the swatch slot, {@link PLAYER_SWATCH_COLORS}
 * names the RGB).
 */
export function computeLivestockHearts(
  snapshot: WorldSnapshot,
  isLivestockTribe: (tribe: number) => boolean,
  playerColourOf: ((player: number) => number) | undefined,
): LifeHeart[] {
  const out: LifeHeart[] = [];
  for (const e of actorsOf(snapshot)) {
    if (!isSettler(e)) continue;
    const player = ownerPlayerOf(e);
    if (player === undefined) continue; // wild - no heart
    const tribe = settlerTribeOf(e);
    if (tribe === undefined || !isLivestockTribe(tribe)) continue; // an owned human/soldier
    if (e.components.Resting !== undefined) continue; // inside the workplace - not drawn, so no heart
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const slot = playerColourOf?.(player) ?? player;
    const colour = PLAYER_SWATCH_COLORS[slot % PLAYER_SWATCH_COLORS.length] ?? UNKNOWN_PLAYER_HEART_COLOUR;
    out.push({ id: e.id, x: pos.x, y: pos.y, colour, life: lifeFractionOf(e) });
  }
  return out;
}

/** The animal's `Health` as a `[0, 1]` fill level; a missing or empty pool projects as full - a
 *  heart without a gauge beats one that reads permanently drained. */
function lifeFractionOf(e: SnapshotEntity): number {
  const health = healthOf(e);
  if (health === undefined || health.max <= 0) return 1;
  return Math.max(0, Math.min(1, health.hitpoints / health.max));
}
