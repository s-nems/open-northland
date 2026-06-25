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
 * effect-apply — exactly like the hunger/fatigue resets do.
 *
 * The *gating/tech-graph* half ({@link buildingEnabled}) is query-shaped instead: it answers "is this
 * building unlocked for the tribe right now?" by inspecting current world state, so it lives here as a
 * pure helper the CommandSystem calls when applying `placeBuilding` (not the executor). The remaining
 * `needfor*`/`allow*`/`trainforjob` schooling gates (the XP→level→unlock curve) are a later slice.
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

/**
 * The *gating* half of progression — is a building of `buildingType` unlocked for `tribe` right now?
 *
 * In Cultures, a tribe can't build everything from the start: a house is *enabled* once a settler of
 * the right job is present in the tribe (`tribetypes` `jobEnablesHouse <jobType> <houseType>`). E.g.
 * a smithy might be gated on a smith existing, a barracks on a soldier. This is the read side of the
 * `jobEnables` edges {@link extractJobEnables} produces: a building is enabled when either
 *  - **no** `jobEnablesHouse` edge in the tribe's tech-graph gates that `buildingType` (it is an
 *    ungated start building, like the headquarters), OR
 *  - a settler of **any** of the jobs whose edge gates it is currently alive in that tribe.
 *
 * Determinism: this is a pure **membership** query (does *some* enabling-job settler exist?), so the
 * `query` insertion-order traversal is fine — the boolean is order-independent (like `Map.has`, which
 * the determinism contract permits). No RNG, no wall-clock; content arrays are fixed at load. The
 * tribe id is matched on the {@link TribeType} `typeId`, the same id `Settler.tribe`/`Building.tribe`
 * carry. A tribe absent from content (bad input) gates nothing — every building stays enabled, so a
 * map with no tribe-type data still places its start buildings rather than silently rejecting them.
 */
export function buildingEnabled(
  world: World,
  ctx: SystemContext,
  tribe: number,
  buildingType: number,
): boolean {
  const tribeType = ctx.content.tribes.find((t) => t.typeId === tribe);
  if (tribeType === undefined) return true; // no tech-graph for this tribe — nothing gates it

  // The jobs that unlock this building (a building may be gated by several different jobs).
  const enablingJobs = new Set<number>();
  for (const edge of tribeType.jobEnables) {
    if (edge.kind === 'house' && edge.targetId === buildingType) enablingJobs.add(edge.jobType);
  }
  if (enablingJobs.size === 0) return true; // ungated building (e.g. the headquarters)

  // Enabled iff a settler of an enabling job is currently alive in this tribe.
  for (const e of world.query(Settler)) {
    const s = world.get(e, Settler);
    if (s.tribe === tribe && s.jobType !== null && enablingJobs.has(s.jobType)) return true;
  }
  return false;
}
