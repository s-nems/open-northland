import type { LifeHeart } from '@open-northland/render';
// The Pixi-free entry: the root barrel would drag Pixi into headless callers.
import { isIndoorSettler } from '@open-northland/render/data';
import { positionedWithin, type TileBox, type WorldSnapshot } from '@open-northland/sim';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import {
  healthOf,
  isSettler,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
  settlerTribeOf,
} from '../../game/snapshot.js';

const UNKNOWN_PLAYER_HEART_COLOUR = 0xffffff;

/**
 * At or below this life fraction a person wears a heart unasked. Approximation: the original's own
 * damage-tell threshold is not established. The mark is permanent, since no system heals a person.
 */
export const WOUNDED_LIFE_FRACTION = 0.99;

/** What the projection resolves outside the snapshot. */
export interface LifeHeartInputs {
  readonly isLivestockTribe: (tribe: number) => boolean;
  /** Owner slot to swatch slot; absent = identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
  readonly selected?: ReadonlySet<number> | undefined;
}

/**
 * One faction-coloured heart per unit, filled to its remaining life fraction, ascending by id. Only units
 * standing in `box` are read; no box reads the whole map. Source basis: the permanent heart over claimed
 * stock is observed in the original; hearts on selected or wounded people are an approximation.
 */
export function computeLifeHearts(
  snapshot: WorldSnapshot,
  inputs: LifeHeartInputs,
  box?: TileBox,
): LifeHeart[] {
  const out: LifeHeart[] = [];
  const candidates = box === undefined ? snapshot.entities : positionedWithin(snapshot, box, []);
  for (const e of candidates) {
    if (!isSettler(e)) continue;
    const player = ownerPlayerOf(e);
    if (player === undefined) continue; // wild - no faction, no heart
    const tribe = settlerTribeOf(e);
    if (tribe === undefined) continue;
    const life = lifeFractionOf(e);
    if (!wearsHeart(e.id, tribe, life, inputs)) continue;
    // The scene draws nobody indoors to hang the heart over.
    if (isIndoorSettler(snapshot, e.components)) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const slot = inputs.playerColourOf?.(player) ?? player;
    const colour = PLAYER_SWATCH_COLORS[slot % PLAYER_SWATCH_COLORS.length] ?? UNKNOWN_PLAYER_HEART_COLOUR;
    out.push({ id: e.id, x: pos.x, y: pos.y, colour, life });
  }
  return box === undefined ? out : out.sort((a, b) => a.id - b.id);
}

/** Claimed stock always; a person only while the player has it selected or it is wounded. */
function wearsHeart(id: number, tribe: number, life: number, inputs: LifeHeartInputs): boolean {
  if (inputs.isLivestockTribe(tribe)) return true;
  return inputs.selected?.has(id) === true || life <= WOUNDED_LIFE_FRACTION;
}

/** The unit's `Health` as a `[0, 1]` fill level; a missing or empty pool projects as full. */
function lifeFractionOf(e: SnapshotEntity): number {
  const health = healthOf(e);
  if (health === undefined || health.max <= 0) return 1;
  return Math.max(0, Math.min(1, health.hitpoints / health.max));
}
