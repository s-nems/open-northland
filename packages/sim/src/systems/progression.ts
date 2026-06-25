import type { HumanJobExperienceType } from '@vinland/data';
import { Settler } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import type { SystemContext } from './context.js';

/**
 * ProgressionSystem (XP-accrual half) — a settler gets better at the *specialization* it works.
 *
 * In Cultures, experience is granted within a narrow `(job, good)` specialization (e.g. "collector
 * wood" = job 8 + good 5), not just per job — doing the same job on the same good repeatedly is what
 * makes a settler an expert at it (see `HumanJobExperienceType`, the `humanjobexperiencetypes` IR).
 * This module owns the lookup-and-grant so the AtomicSystem stays the executor: when a settler
 * completes a **work** atomic that yields a good (today: `harvest`), {@link grantWorkExperience}
 * finds the matching track for `(settler.jobType, goodType)` and adds its `experienceFactor` to the
 * settler's per-specialization XP, keyed by the track's `typeId`.
 *
 * Why a helper called from the executor, not a per-tick `System`: XP is event-shaped (it accrues at
 * the *instant* a work atomic completes), and sim events are render-only (must not be read back in
 * sim logic — see events.ts). So the grant lives where the completion is known — AtomicSystem's
 * effect-apply — exactly like the hunger/fatigue resets do. The poll-driven `progressionSystem`
 * stub stays reserved for the *gating/tech-graph* half (`needfor*`/`allow*`/`jobEnables*`), a later
 * slice.
 *
 * Determinism: no RNG, no wall-clock, fixed-point not needed (XP is a whole-number counter on the
 * original's integer scale, like the recipe/stock counts). The track is resolved by a stable
 * `Array.find` over content (array order is fixed at load), and the XP Map is hashed in sorted-key
 * order (snapshot.ts) — so identical inputs yield byte-identical state.
 */

/**
 * Find the `(job, good)` experience track a completed work atomic accrues into, or `undefined` when
 * none matches (the job/good pairing has no track — not every activity trains a specialization).
 *
 * Matching mirrors the data: a track names its owning `jobType` (always) and, when good-specific,
 * the `goodType` it trains on. A good-specific track must match BOTH ids; a "general" track (no
 * `goodType`) matches the job regardless of good. A good-specific match is preferred over a general
 * one for the same job (it is the more specialized — the original's narrow `(job, good)` track),
 * so a job that has both a wood-specific and a general track accrues the wood one when chopping wood.
 */
export function trackFor(
  ctx: SystemContext,
  jobType: number,
  goodType: number,
): HumanJobExperienceType | undefined {
  let general: HumanJobExperienceType | undefined;
  for (const t of ctx.content.jobExperience) {
    if (t.jobType !== jobType) continue;
    if (t.goodType === goodType) return t; // most-specific: the (job, good) track
    if (t.goodType === undefined && general === undefined) general = t; // first general fallback
  }
  return general;
}

/**
 * Grant a settler XP for completing a work atomic that yielded `goodType`. No-ops when the settler
 * has no job (an unemployed settler trains nothing), the settler is gone, or no track matches the
 * `(job, good)` pairing. The grant adds the track's `experienceFactor` to the settler's running XP
 * for that specialization, keyed by the track's `typeId` (the specialization id `Settler.experience`
 * is keyed on). `experienceFactor` is the original's per-track accrual rate (raw integer, 1..250 in
 * the base data); summing it per completed work is the basic "repetition builds expertise" accrual —
 * the non-linear XP→level curve (`baseRepeatCounter`) is a later balance slice, deferred (see
 * docs/FIDELITY.md).
 */
export function grantWorkExperience(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  goodType: number,
): void {
  const s = world.tryGet(settler, Settler);
  if (s === undefined || s.jobType === null) return; // gone, or no job to train a specialization
  const track = trackFor(ctx, s.jobType, goodType);
  if (track === undefined) return; // this (job, good) pairing trains no specialization
  const current = s.experience.get(track.typeId) ?? 0;
  s.experience.set(track.typeId, current + track.experienceFactor);
}
