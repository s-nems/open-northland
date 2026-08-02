import type { LifeHeart } from '@open-northland/render';
// The Pixi-free entry: a headless scene check runs this projection, and the root barrel drags Pixi in.
import { isIndoorSettler } from '@open-northland/render/data';
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
 * At or below this life fraction a person wears a heart unasked - one percent of the pool spent is the
 * wounded tell. Approximation: the original's own damage-tell threshold is not established.
 *
 * The mark is permanent: no system heals a person (livestock regen takes `Livestock`, the draught only
 * saves from death), so a single starvation bite or arrow hearts that settler for the rest of the
 * session. A famine or a battle therefore leaves a lasting field of hearts, not a transient one.
 */
export const WOUNDED_LIFE_FRACTION = 0.99;

/** What the projection resolves outside the snapshot. */
export interface LifeHeartInputs {
  /** The sim content's catchable-species classification, resolved by the caller. */
  readonly isLivestockTribe: (tribe: number) => boolean;
  /** Owner slot → swatch slot (the minimap-dot rule); absent = identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
  readonly selected?: ReadonlySet<number> | undefined;
}

/**
 * The life-heart projection: one faction-coloured heart the render {@link LifeHeart} layer floats over a
 * unit's back, filled to its remaining life fraction. See {@link wearsHeart} for who gets one.
 *
 * Source basis: the permanent heart over claimed stock is the original's observed read. Extending it to
 * people on selection and injury is this implementation's design choice - the original shows a person's
 * life as a bar in the character panel, and no heart over the body has been established.
 *
 * The promise stops at faction-owned units: a wounded wild animal has no owner, so a hunter's hits give
 * no gauge.
 */
export function computeLifeHearts(snapshot: WorldSnapshot, inputs: LifeHeartInputs): LifeHeart[] {
  const out: LifeHeart[] = [];
  for (const e of actorsOf(snapshot)) {
    if (!isSettler(e)) continue;
    const player = ownerPlayerOf(e);
    if (player === undefined) continue; // wild - no faction, no heart
    const tribe = settlerTribeOf(e);
    if (tribe === undefined) continue;
    const life = lifeFractionOf(e);
    if (!wearsHeart(e.id, tribe, life, inputs)) continue;
    // Tested after membership, not before: the scene index behind it is free under a renderer but a
    // whole extra walk in a headless caller, and only a heart-wearer can hang over an empty doorway.
    if (isIndoorSettler(snapshot, e.components)) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const slot = inputs.playerColourOf?.(player) ?? player;
    const colour = PLAYER_SWATCH_COLORS[slot % PLAYER_SWATCH_COLORS.length] ?? UNKNOWN_PLAYER_HEART_COLOUR;
    out.push({ id: e.id, x: pos.x, y: pos.y, colour, life });
  }
  return out;
}

/** Claimed stock always; a person only while the player has it selected or it is wounded. */
function wearsHeart(id: number, tribe: number, life: number, inputs: LifeHeartInputs): boolean {
  if (inputs.isLivestockTribe(tribe)) return true;
  return inputs.selected?.has(id) === true || life <= WOUNDED_LIFE_FRACTION;
}

/** The unit's `Health` as a `[0, 1]` fill level; a missing or empty pool projects as full - a heart
 *  without a gauge beats one that reads permanently drained. */
function lifeFractionOf(e: SnapshotEntity): number {
  const health = healthOf(e);
  if (health === undefined || health.max <= 0) return 1;
  return Math.max(0, Math.min(1, health.hitpoints / health.max));
}
