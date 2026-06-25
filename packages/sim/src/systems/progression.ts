import type { HumanJobExperienceType, JobRequirement } from '@vinland/data';
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
 * The *gating/tech-graph* half ({@link buildingEnabled} for houses, {@link goodEnabled} for goods) is
 * query-shaped instead: it answers "is this building / good unlocked for the tribe right now?" by
 * inspecting current world state, so each lives here as a pure helper its consumer calls — the
 * CommandSystem when applying `placeBuilding`, ProductionSystem when starting a cycle. The remaining
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
 * `jobEnables` edges the pipeline's `extractJobEnables` produces: a building is enabled when either
 *  - **no** `jobEnablesHouse` edge in the tribe's tech-graph gates that `buildingType` (it is an
 *    ungated start building, like the headquarters), OR
 *  - a settler of **any** of the jobs whose edge gates it is currently alive in that tribe.
 *
 * Determinism: this is a pure **membership** query (does *some* enabling-job settler exist?), so the
 * `query` insertion-order traversal is fine — the boolean is order-independent (like `Map.has`, which
 * the determinism contract permits). No RNG, no wall-clock; content arrays are fixed at load. The
 * tribe id is matched on the `TribeType` `typeId`, the same id `Settler.tribe`/`Building.tribe`
 * carry. A tribe absent from content (bad input) gates nothing — every building stays enabled, so a
 * map with no tribe-type data still places its start buildings rather than silently rejecting them.
 */
export function buildingEnabled(
  world: World,
  ctx: SystemContext,
  tribe: number,
  buildingType: number,
): boolean {
  return tribeUnlockEnabled(world, ctx, tribe, 'house', buildingType);
}

/**
 * The *gating* half of progression for a **good** — is producing `goodType` unlocked for `tribe` right
 * now? The sibling of {@link buildingEnabled} on the `good` kind of the same `jobEnables` tech-graph:
 * the original's `tribetypes` `jobEnablesGood <jobType> <goodType>` edge means a settler of that job
 * being present unlocks producing the good. A good with **no** `jobEnablesGood` edge gating it is an
 * ungated start good (made freely); one that *is* gated may be produced only while an enabling-job
 * settler is alive in the same tribe.
 *
 * Consumed by ProductionSystem's cycle-start gate: a workplace can't begin a cycle whose output good
 * is gated-out (a tannery makes no leather until the tribe has the tanner that enables it). Same
 * determinism properties as {@link buildingEnabled} — a pure membership query, no RNG/wall-clock.
 */
export function goodEnabled(world: World, ctx: SystemContext, tribe: number, goodType: number): boolean {
  return tribeUnlockEnabled(world, ctx, tribe, 'good', goodType);
}

/**
 * Shared read side of the `jobEnables` tech-graph for a single `(kind, targetId)`: is the target
 * unlocked for `tribe`? The target is enabled when either no edge of `kind` gates it (ungated), or a
 * settler of any gating job is currently alive in the tribe. {@link buildingEnabled} (kind `house`)
 * and {@link goodEnabled} (kind `good`) are the two consumers; the `job`/`vehicle` kinds await their
 * JobSystem/vehicle slices. Determinism: a pure membership query (does *some* enabling-job settler
 * exist?), order-independent like `Map.has`; a tribe absent from content gates nothing.
 */
function tribeUnlockEnabled(
  world: World,
  ctx: SystemContext,
  tribe: number,
  kind: 'house' | 'good',
  targetId: number,
): boolean {
  const tribeType = ctx.content.tribes.find((t) => t.typeId === tribe);
  if (tribeType === undefined) return true; // no tech-graph for this tribe — nothing gates it

  // The jobs that unlock this target (a target may be gated by several different jobs).
  const enablingJobs = new Set<number>();
  for (const edge of tribeType.jobEnables) {
    if (edge.kind === kind && edge.targetId === targetId) enablingJobs.add(edge.jobType);
  }
  if (enablingJobs.size === 0) return true; // ungated target (e.g. the headquarters / a start good)

  // Enabled iff a settler of an enabling job is currently alive in this tribe.
  for (const e of world.query(Settler)) {
    const s = world.get(e, Settler);
    if (s.tribe === tribe && s.jobType !== null && enablingJobs.has(s.jobType)) return true;
  }
  return false;
}

/**
 * The *threshold* half of progression — does a settler's accrued XP satisfy a single `needfor*`
 * requirement? This is the read side of the `{need,train}for{job,good}` table (`TribeType.jobRequirements`,
 * extracted by `extractJobRequirements`), consuming the same per-specialization XP `grantWorkExperience`
 * accrues onto `Settler.experience` (keyed by the `humanjobexperiencetypes` track typeId).
 *
 * A `needfor*` requirement says: to unlock the target, the settler must have already accrued `amount`
 * experience measured in the requirement's `experienceTypes` track(s). The settler's XP is keyed by the
 * **same** track typeIds, so the check sums the settler's accrued XP across the named tracks and compares
 * it to `amount`. A requirement with no `experienceTypes` (none observed in the real data, but the schema
 * permits an empty list) is vacuously met — there is no track to measure against.
 *
 * APPROXIMATED (see docs/FIDELITY.md): the original measures the threshold per the same below-the-`.ini`
 * XP logic the per-animation `event` deltas live in — whether a two-`expType` line means "sum both" or
 * "either alone" has no readable oracle. Summing the named tracks is the deterministic reading (a
 * single threshold over the relevant specializations); refine when the original's XP curve is observed.
 *
 * Only `requirement === 'need'` requirements are interpreted here — `train` requirements are a schooling
 * COST paid at a training house (the JobSystem/school slice), not an already-accrued XP threshold.
 * Determinism: a pure read over content + the settler's XP Map (summed in the requirement's fixed
 * `experienceTypes` order); no RNG, no wall-clock.
 */
export function experienceRequirementMet(
  experience: ReadonlyMap<number, number>,
  requirement: JobRequirement,
): boolean {
  if (requirement.requirement !== 'need') return true; // not an accrued-XP threshold (train = schooling)
  if (requirement.experienceTypes.length === 0) return true; // no track to measure against
  let accrued = 0;
  for (const expType of requirement.experienceTypes) accrued += experience.get(expType) ?? 0;
  return accrued >= requirement.amount;
}

/**
 * Does a settler meet **all** the `needfor*` XP thresholds gating a `(target, targetId)` for its tribe?
 *
 * The sibling of {@link tribeUnlockEnabled} on the *threshold* axis: where `jobEnables*` gates a target
 * on a job being PRESENT in the tribe, `needfor*` gates it on THIS settler having accrued enough XP. A
 * target with no `need` requirement is unthresholded (any settler clears it); one with several must clear
 * every one (e.g. a master baker needs both bread- and flour-track XP). `train` requirements are skipped
 * here — they are a schooling cost, not an accrued-XP threshold (see {@link experienceRequirementMet}).
 *
 * A tribe absent from content thresholds nothing (consistent with the `jobEnables` gate). Determinism:
 * a pure read over the tribe's `jobRequirements` (fixed source order) + the settler's XP Map.
 */
export function settlerMeetsNeed(
  ctx: SystemContext,
  tribe: number,
  target: JobRequirement['target'],
  targetId: number,
  experience: ReadonlyMap<number, number>,
): boolean {
  const tribeType = ctx.content.tribes.find((t) => t.typeId === tribe);
  if (tribeType === undefined) return true; // no requirement table for this tribe — nothing thresholds it
  for (const req of tribeType.jobRequirements) {
    if (req.requirement !== 'need' || req.target !== target || req.targetId !== targetId) continue;
    if (!experienceRequirementMet(experience, req)) return false;
  }
  return true; // no unmet `need` requirement gates this target
}
