import { Settler } from '../../../../../../components/index.js';
import { pairHash } from '../../../../../../core/coord-hash.js';
import { fx } from '../../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import type { SystemContext } from '../../../../../context.js';
import { experienceBonus, experienceRepeats, generalTrackFor } from '../../../../../progression/index.js';
import { isHunterJob } from '../../../../../readviews/index.js';

/** A fresh hunter's hit chance, percent. APPROXIMATION (source basis "Hunter aim"): the original's hit
 *  model is unreadable; the per-terrain `soundtype_NoHit` tables in `weapons.ini` are the evidence that
 *  missed shots existed at all. Tuned so a hunt visibly takes several draws, not one per kill. */
export const HUNTER_BASE_HIT_PCT = 40;
/** The mastery ceiling - the hit chance a fully-practised hunter saturates at. */
export const HUNTER_MASTER_HIT_PCT = 90;
const PCT = 100;

/**
 * Whether this ranged swing MISSES - the hunter's aim model, decided once at the release frame. A
 * hunter's shot connects with {@link HUNTER_BASE_HIT_PCT} fresh, growing to {@link HUNTER_MASTER_HIT_PCT}
 * along the shared {@link experienceBonus} curve over its general track's repeats (`hunter_general`:
 * every carcass unit carried home steadies the hand). Soldiers keep the engine's always-hit reading -
 * army hit-vs-miss is calibration-pending (see the combat-calibration ticket). Rolled from
 * {@link pairHash}(tick, shooter): one shot per shooter per tick, deterministic and replay-stable, and
 * outside the RNG stream (a shot must not shift a later wander draw).
 */
export function hunterShotMisses(world: World, ctx: SystemContext, shooter: Entity): boolean {
  const s = world.tryGet(shooter, Settler);
  if (s === undefined || s.jobType === null || !isHunterJob(ctx.content, s.jobType)) return false;
  const track = generalTrackFor(ctx, s.jobType);
  const repeats = track === undefined ? 0 : experienceRepeats(s.experience.get(track.typeId) ?? 0, track);
  const spread = fx.mul(fx.fromInt(HUNTER_MASTER_HIT_PCT - HUNTER_BASE_HIT_PCT), experienceBonus(repeats));
  const hitPct = HUNTER_BASE_HIT_PCT + fx.toInt(spread);
  return pairHash(ctx.tick, shooter) % PCT >= hitPct;
}
