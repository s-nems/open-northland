import type { ContentSet, JobType } from '@vinland/data';

// Pure, terminal **read views** for jobs — the data-defined sea-job classification the Sea/Northland
// slice (`fisher_sea`/`trader_sea`, water travel, embark/disembark) builds on, the job-side analogue of
// ./vehicles.ts's ship classification. No mechanic is added here (nobody fishes from a boat, nothing
// embarks); see ./index.ts for why read views are grouped out of systems/shared.ts.

/**
 * The id suffix the original `jobtypes` data uses to mark a **water-borne specialization** of a land
 * trade — `fisher` → `fisher_sea`, `trader` → `trader_sea`. The sea variant is a *distinct jobtype*
 * (its own `typeId`) whose only extracted distinguisher from its land counterpart is this `_sea` id
 * suffix: the sea jobs carry the same `baseAtomics [6]` and (unlike the land `fisher`'s
 * `36/37/38` cast/catch atomics) an EMPTY `allowedAtomics` — their sea-work atomics are bound
 * per-tribe via `tribetypes` `setatomic`, not listed in `jobtypes`. So the data's own "this trade
 * works from the water" signal is the name, which is what {@link isSeaJob} keys on.
 */
const SEA_JOB_SUFFIX = '_sea';

/**
 * Whether a {@link JobType} is a **sea job** — a water-borne trade (`fisher_sea`, `trader_sea`) as
 * opposed to its land counterpart (`fisher`, `trader`) or any landlubber job. The discriminator is the
 * `_sea` id suffix the original `jobtypes` data carries ({@link SEA_JOB_SUFFIX}): a sea job is a
 * distinct jobtype with its own `typeId` whose name marks it as the water specialization. This is the
 * job-side identity the Sea/Northland item names (`fisher_sea`/`trader_sea`), the classification a
 * settler-assignment gate or a "needs a boat to reach its station" check will read.
 *
 * FIDELITY: pinned to the extracted job `id` — the only param that distinguishes a sea job from its
 * land counterpart in the readable data (the sea variants' `allowedAtomics` are empty, their atomics
 * coming per-tribe via `setatomic`, so the name is the data's own discriminator, not an invented one).
 * In the real IR the suffix isolates EXACTLY `fisher_sea` (23) and `trader_sea` (26) — no false
 * positives, no land job mis-tagged. Adds no mechanic (nothing produced/consumed/moved) — a derived
 * classification over the already-extracted job IR.
 */
export function isSeaJob(job: JobType): boolean {
  return job.id.endsWith(SEA_JOB_SUFFIX);
}

/**
 * The **sea jobs** as a derived **read view** over `content` — the `fisher_sea`/`trader_sea` rows a
 * tribe staffs from the water, distinguished from land trades *by the data alone* ({@link isSeaJob}: the
 * `_sea` id suffix). This is the data-defined seed the Sea/Northland items (a sea worker reaching its
 * fishing/trading station by boat, embark/disembark) build on, with nothing hardcoded — a richer sea-job
 * set is the same shape with more `_sea` rows. {@link isSeaJob} is the matching single-job predicate.
 *
 * Returned as a {@link JobType} **array** sorted ascending by `typeId` (not a Map keyed by id) so the
 * enumeration order is stable regardless of `content.jobs` declaration order — the canonical order a
 * "for each sea job" loop wants, the same shape `shipVehicles` returns for vehicles.
 *
 * FIDELITY n/a: a pure derived **read view** over the already-extracted job IR (like `shipVehicles`
 * over vehicles) — it adds no mechanic and invents no classification: the sea-vs-land split is read
 * straight off the `id` suffix the original data carries (see {@link isSeaJob}). Determinism: a pure
 * function of `content` (no world, no RNG, no wall-clock) over the plain `content.jobs` array, explicitly
 * **sorted** by `typeId`, so the same content yields a byte-identical array every call.
 */
export function seaJobs(content: ContentSet): JobType[] {
  return content.jobs.filter(isSeaJob).sort((a, b) => a.typeId - b.typeId);
}
