import type { ContentSet } from '@open-northland/data';
import type { ExperienceStar } from '@open-northland/render';
// The Pixi-free entry: the root barrel would drag Pixi into headless callers.
import { isIndoorSettler, ONE, readEquipmentWeaponGood } from '@open-northland/render/data';
import {
  bucketsReach,
  type EntitySnapshot,
  entityById,
  indexesOf,
  type SnapshotIndexSpec,
  systems,
  type TileBox,
  TileBuckets,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
  settlerExperienceOf,
  settlerJobType,
  settlerTribeOf,
} from '../../game/snapshot.js';

/**
 * The experience a star's size steps by, and the experience its largest size needs. Original behavior
 * (reading, unconfirmed against the running original): a star shows from a quarter of the range and
 * grows a size per quarter, so it is largest at full experience.
 */
const STAR_TIER_STEP = 25;
const STAR_FULL = 100;

/** What the projection resolves outside the snapshot. */
export interface ExperienceStarInputs {
  /** Whether a trade is a soldier's. */
  readonly isSoldierJob: (jobType: number) => boolean;
  /** The class (`mainType`) of the weapon a fighter of `tribe` in `jobType` swings, wearing
   *  `weaponGood` (`null` or `undefined` = the trade's own weapon); undefined when it resolves none. */
  readonly weaponClassOf: (
    tribe: number,
    jobType: number,
    weaponGood: number | null | undefined,
  ) => number | undefined;
  /** The experience tracks (`humanjobexperiencetypes` ids) a trade trains; empty for a carrier. */
  readonly tradeTracksOf: (jobType: number) => readonly number[];
  /** The seat whose selected people show their trade star; null for a spectator. */
  readonly viewer: number | null;
  readonly selected?: ReadonlySet<number> | undefined;
}

/** {@link ExperienceStarInputs}' content rules, resolved once from the running content. A weapon row
 *  binds first-wins per `(tribe, job)` and `(tribe, good)`, as the sim's weapon index does. */
export function experienceStarRules(
  content: ContentSet,
): Pick<ExperienceStarInputs, 'isSoldierJob' | 'weaponClassOf' | 'tradeTracksOf'> {
  const byJob = new Map<number, Map<number, number>>();
  const byGood = new Map<number, Map<number, number>>();
  const bind = (index: Map<number, Map<number, number>>, tribe: number, key: number, mainType: number) => {
    const row = index.get(tribe) ?? new Map<number, number>();
    index.set(tribe, row);
    if (!row.has(key)) row.set(key, mainType);
  };
  for (const w of content.weapons) {
    if (w.tribeType === undefined || w.mainType === undefined) continue;
    if (w.jobType !== undefined) bind(byJob, w.tribeType, w.jobType, w.mainType);
    if (w.goodType !== undefined) bind(byGood, w.tribeType, w.goodType, w.mainType);
  }
  const carriers = new Set(content.jobs.filter((j) => systems.isCarrierJobRow(j)).map((j) => j.typeId));
  const tracks = new Map<number, number[]>();
  for (const t of content.jobExperience) {
    if (carriers.has(t.jobType)) continue;
    const held = tracks.get(t.jobType);
    if (held === undefined) tracks.set(t.jobType, [t.typeId]);
    else held.push(t.typeId);
  }
  return {
    isSoldierJob: (jobType) => systems.isSoldierJob(content, jobType),
    weaponClassOf: (tribe, jobType, weaponGood) =>
      weaponGood == null ? byJob.get(tribe)?.get(jobType) : byGood.get(tribe)?.get(weaponGood),
    tradeTracksOf: (jobType) => tracks.get(jobType) ?? NO_TRACKS,
  };
}

const NO_TRACKS: readonly number[] = [];

/** Reused output of the box query; the slots past a query's count hold earlier frames' bodies. */
const boxed: SnapshotEntity[] = [];

/**
 * Each on-screen person's stars, ascending by id. Only units standing in `box` are read; no box reads
 * the whole map. Original behavior (reading, unconfirmed against the running original):
 * - every soldier, whoever owns him, wears a star for the landed hits with the weapon class he fights
 *   with (the first hundred, the ones that raise his damage);
 * - the player's own selected people wear a second star for experience in their trade.
 * Approximation: the trade star reads the best of the trade's tracks, where the original reads its
 * job-efficiency factor.
 */
export function computeExperienceStars(
  snapshot: WorldSnapshot,
  inputs: ExperienceStarInputs,
  box?: TileBox,
): ExperienceStar[] {
  const out: ExperienceStar[] = [];
  const candidates = box === undefined ? snapshot.entities : boxed;
  const count = box === undefined ? candidates.length : collectCandidates(snapshot, box, inputs);
  for (let i = 0; i < count; i++) {
    const e = candidates[i] as SnapshotEntity;
    if (e.components.Person === undefined) continue;
    const jobType = settlerJobType(e);
    const tribe = settlerTribeOf(e);
    if (jobType === undefined || tribe === undefined) continue;
    const experience = settlerExperienceOf(e.components);
    const weaponTier = inputs.isSoldierJob(jobType)
      ? weaponStarTier(e, tribe, jobType, experience, inputs)
      : 0;
    const jobTier = wearsTradeStar(e, inputs) ? tradeStarTier(jobType, experience, inputs) : 0;
    if (weaponTier === 0 && jobTier === 0) continue;
    // The scene draws nobody indoors to hang the star over.
    if (isIndoorSettler(snapshot, e.components)) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    out.push({ id: e.id, x: pos.x, y: pos.y, weaponTier, jobTier });
  }
  return box === undefined ? out : out.sort((a, b) => a.id - b.id);
}

/** A star's size `1..4` for an experience percent, 0 below the first quarter. */
export function starTier(percent: number): number {
  return Math.trunc(Math.min(percent, STAR_FULL) / STAR_TIER_STEP);
}

function weaponStarTier(
  e: SnapshotEntity,
  tribe: number,
  jobType: number,
  experience: ReadonlyMap<number, number>,
  inputs: ExperienceStarInputs,
): number {
  const weaponClass = inputs.weaponClassOf(tribe, jobType, readEquipmentWeaponGood(e.components));
  return starTier(systems.weaponClassHits(experience, weaponClass));
}

function wearsTradeStar(e: SnapshotEntity, inputs: ExperienceStarInputs): boolean {
  return inputs.viewer !== null && inputs.selected?.has(e.id) === true && ownerPlayerOf(e) === inputs.viewer;
}

function tradeStarTier(
  jobType: number,
  experience: ReadonlyMap<number, number>,
  inputs: ExperienceStarInputs,
): number {
  let best = 0;
  for (const track of inputs.tradeTracksOf(jobType)) {
    const percent = systems.experiencePercent(systems.experiencePoints(experience.get(track) ?? 0));
    if (percent > best) best = percent;
  }
  return starTier(best);
}

/** The people in `box`'s position buckets who may wear a star, written over {@link boxed}: the indexed
 *  seasoned fighters, then the selected ones the index does not hold. Returns the count. */
function collectCandidates(snapshot: WorldSnapshot, box: TileBox, inputs: ExperienceStarInputs): number {
  const fighters = indexesOf(snapshot).get(SEASONED_FIGHTERS);
  let count = fighters.collect(box, boxed);
  for (const id of inputs.selected ?? []) {
    if (fighters.has(id)) continue;
    const e = entityById(snapshot, id);
    const pos = e === undefined ? undefined : positionOf(e);
    if (e !== undefined && pos !== undefined && bucketsReach(box, pos.x / ONE, pos.y / ONE))
      boxed[count++] = e;
  }
  return count;
}

const FIGHT_BUCKETS: readonly number[] = Object.values(systems.FIGHT_EXPERIENCE_TYPE);

/** The people whose landed hits in some weapon class reach the first star, bucketed by `Position`. The
 *  test needs no content, so the trade and the weapon class he swings are the reader's. */
export const SEASONED_FIGHTERS: SnapshotIndexSpec<TileBuckets<EntitySnapshot>> = {
  name: 'star wearers',
  reads: { values: ['SettlerProgress'], presence: ['Person', 'Position'] },
  empty: () => new TileBuckets(),
  differs: (held, fresh) => held.differenceFrom(fresh),
  add: placeFighter,
  remove: (buckets, e) => {
    buckets.delete(e.id);
  },
  replace: (buckets, _previous, next) => placeFighter(buckets, next),
  swapAll: (buckets, nexts) => {
    for (const next of nexts) {
      if (!buckets.has(next.id)) continue; // most touched entities are ones this index never holds
      const pos = positionOf(next);
      if (pos !== undefined) buckets.move(next.id, next, pos.x / ONE, pos.y / ONE);
    }
  },
};

function placeFighter(buckets: TileBuckets<EntitySnapshot>, e: EntitySnapshot): void {
  const pos = positionOf(e);
  if (pos !== undefined && e.components.Person !== undefined && isSeasoned(e)) {
    buckets.set(e.id, e, pos.x / ONE, pos.y / ONE);
  } else buckets.delete(e.id);
}

function isSeasoned(e: SnapshotEntity): boolean {
  const experience = settlerExperienceOf(e.components);
  return FIGHT_BUCKETS.some((bucket) => starTier(experience.get(bucket) ?? 0) > 0);
}
