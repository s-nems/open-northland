import { Settler, SettlerProgress } from '../../../../../../components/index.js';
import { pairHash } from '../../../../../../core/coord-hash.js';
import { fx } from '../../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import type { SystemContext } from '../../../../../context.js';
import { experienceBonus, experienceRepeats, generalTrackFor } from '../../../../../progression/index.js';
import { isHunterJob } from '../../../../../readviews/index.js';

/** A fresh hunter's hit chance, percent. Approximation: the original's hit model is unreadable, and the
 *  per-terrain `soundtype_NoHit` tables in `weapons.ini` are the only evidence that misses existed at all.
 *  Tuned so a hunt visibly takes several draws, not one per kill. */
export const HUNTER_BASE_HIT_PCT = 40;
/** The hit chance a fully practised hunter saturates at, percent. */
export const HUNTER_MASTER_HIT_PCT = 90;
const PCT = 100;

/**
 * Whether this ranged swing misses, decided once at the release frame. Only hunters can miss; soldiers keep
 * the engine's always-hit reading. The roll is {@link pairHash}(tick, shooter) rather than a draw from the
 * RNG stream, so a shot stays replay-stable and cannot shift a later wander draw.
 */
export function hunterShotMisses(world: World, ctx: SystemContext, shooter: Entity): boolean {
  const s = world.tryGet(shooter, Settler);
  if (s === undefined || s.jobType === null || !isHunterJob(ctx.content, s.jobType)) return false;
  const track = generalTrackFor(ctx, s.jobType);
  const points =
    track === undefined ? 0 : (world.get(shooter, SettlerProgress).experience.get(track.typeId) ?? 0);
  const repeats = track === undefined ? 0 : experienceRepeats(points, track);
  const spread = fx.mul(fx.fromInt(HUNTER_MASTER_HIT_PCT - HUNTER_BASE_HIT_PCT), experienceBonus(repeats));
  const hitPct = HUNTER_BASE_HIT_PCT + fx.toInt(spread);
  return pairHash(ctx.tick, shooter) % PCT >= hitPct;
}
