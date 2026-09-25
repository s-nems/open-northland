import {
  BUILDING_KIND,
  type BuildingType,
  type ContentSet,
  type GoodType,
  hasFieldFarmAtomics,
  type JobType,
  parseContentSet,
  parseGeneratedContentSet,
  type WeaponType,
} from '@open-northland/data';
import { HARVEST_CADAVER_ATOMIC } from '../catalog/atomics.js';
import { VIKING_BUILDINGS } from '../catalog/buildings.js';
import { HOUSE_BOW_DAMAGE, shelterCapacityFor } from '../catalog/defence.js';
import { FARMING_BALANCE_BY_ID } from '../catalog/farming.js';
import { GATHERING_BALANCE_BY_ID } from '../catalog/gathering.js';
import { HUNTER_BOW_BALANCE, huntPreyRows } from '../catalog/hunting.js';
import { NAV_LANDSCAPE_TYPES } from '../catalog/terrain.js';
import { HUMAN_HITPOINTS } from '../catalog/units.js';
import { diag } from '../diag/index.js';
import { EQUIP_CLASS_BY_SLUG } from '../game/sandbox/combat.js';
import { loadIrRaw } from './ir/load.js';
import { fetchJsonOrNull } from './net.js';

let contentSetPromise: Promise<ContentSet | null> | null = null;

/** The permanent armor the original assigns to hero jobs at creation. These are
 * armor-type ids, not player-worn goods: 42→wool, 43→plate, 44..46→chain, 47→leather. */
const HERO_ARMOR_BY_JOB_ID: Readonly<Record<string, number | undefined>> = {
  hero_unarmed: 1,
  hero_spear_siegfried: 4,
  hero_sword_bjarni: 3,
  hero_saber_hatschi: 3,
  hero_axe: 3,
  heroine_bow_xena: 2,
};

/**
 * Fetch and validate the served `content/ir.json` into the sim's `ContentSet` at the app boundary.
 * Returns `null` when `content/` is absent so a bare checkout still boots; a present-but-malformed IR
 * throws via `parseGeneratedContentSet`. The default transport shares one memoized parse of the
 * {@link loadIrRaw} document per page, while an injected `fetchImpl` fetches and parses uncached.
 */
export function loadRealContent(fetchImpl: typeof fetch = fetch): Promise<ContentSet | null> {
  if (fetchImpl !== fetch) return fetchContentSet(fetchImpl);
  contentSetPromise ??= parseSharedIr().then((set) => {
    // Memoize success only: a transient boot-time fetch failure must not pin the loader to null.
    if (set === null) contentSetPromise = null;
    return set;
  });
  return contentSetPromise;
}

async function parseSharedIr(): Promise<ContentSet | null> {
  const raw = await loadIrRaw();
  return raw === null ? null : parseGeneratedContentSet(raw);
}

async function fetchContentSet(fetchImpl: typeof fetch): Promise<ContentSet | null> {
  const raw = await fetchJsonOrNull<unknown>('/ir.json', fetchImpl);
  return raw === null ? null : parseGeneratedContentSet(raw);
}

/** The real content with its clean-room balance completed, plus the gaps the overlay cannot fill. */
export interface RealContentMerge {
  readonly content: ContentSet;
  /** Felled or mined goods with no clean-room balance: they stay uncalibrated. */
  readonly unbalancedGoods: readonly string[];
  /** Field-farmed goods with no clean-room `farming` block: until one lands they neither field-farm nor
   *  produce (the pipeline correctly gives a grown good no recipe). */
  readonly unfarmedFieldGoods: readonly string[];
  /** Real non-vehicle buildings absent from `VIKING_BUILDINGS`: they keep their extracted
   *  footprint/stock/recipe but no clean-room tuning. */
  readonly uncatalogedBuildings: readonly string[];
}

/** Localize a good's display name by its string id; a good the map lacks keeps its own name. */
function withLocalizedName(good: GoodType, goodNames?: ReadonlyMap<string, string>): GoodType {
  const name = goodNames?.get(good.id);
  return name !== undefined ? { ...good, name } : good;
}

/** Overlay the clean-room field-farming block (growth timing, field radius/count): the source carries no
 *  readable growth constants, so the pipeline cannot extract one. A good absent from
 *  {@link FARMING_BALANCE_BY_ID} is returned unchanged. */
function withFarmingBalance(good: GoodType): GoodType {
  const farming = FARMING_BALANCE_BY_ID[good.id];
  return farming !== undefined ? { ...good, farming } : good;
}

/** Overlay the clean-room equip classification (slot category + wear axis) the pipeline does not extract,
 *  from the source-pinned table (`allowequip` membership plus the manual's Equipment section). A good
 *  already shipping an `equip` block keeps it: extracted data wins over the overlay. */
function withEquipClass(good: GoodType): GoodType {
  if (good.equip !== undefined) return good;
  const equip = EQUIP_CLASS_BY_SLUG.get(good.id);
  return equip !== undefined ? { ...good, equip } : good;
}

/** Add the armor a hero is born with in the original. Extracted `jobtypes.ini` has no field for it: the
 * original fixes it per job, so it belongs in this runtime overlay. */
function withHeroArmor(job: JobType): JobType {
  const fixedArmorType = HERO_ARMOR_BY_JOB_ID[job.id];
  return fixedArmorType === undefined ? job : { ...job, fixedArmorType };
}

/** Repair the Byzantine and Egyptian `hero fist` rows whose readable `weapons.ini` anomalously binds job
 * 32: the same named type-3 row with the same stats binds unarmed-hero job 42 for all three other playable
 * tribes. This inferred correction keeps the raw pipeline faithful and closes the runtime join here. */
function withHeroFistJob(weapon: WeaponType): WeaponType {
  return weapon.id === 'hero_fist' && weapon.typeId === 3 && weapon.jobType === 32
    ? { ...weapon, jobType: 42 }
    : weapon;
}

/** Give WOOL the carcass-harvest atomic. In the source wool is purely a husbandry product (no harvest
 *  atomic, no gathering pipeline), so the hunter's wool-off-a-sheep-kill yield and this atomic are a
 *  named approximation mirroring leather/meat's extracted `atomicForHarvesting 33`. */
function withWoolCarcassHarvest(good: GoodType): GoodType {
  if (good.id !== 'wool' || good.atomics.harvest !== undefined) return good;
  return { ...good, atomics: { ...good.atomics, harvest: HARVEST_CADAVER_ATOMIC } };
}

/** Overlay the authored garrison size: the flag decides who offers the mode, so an unflagged row is
 *  zeroed whatever it arrived with. */
function withShelterCapacity(building: BuildingType): BuildingType {
  return { ...building, shelterCapacity: shelterCapacityFor(building) };
}

/** Rein the two civilian bows in under the soldier's short bow: a design override of the extracted rows,
 *  which make both stronger in at least one column. The wall bow keeps its extracted reach. */
function withCivilianBowBalance(weapon: WeaponType): WeaponType {
  if (weapon.id === 'house_bow') return { ...weapon, damage: { ...HOUSE_BOW_DAMAGE } };
  if (weapon.id !== 'hunter_bow') return weapon;
  return {
    ...weapon,
    minRange: HUNTER_BOW_BALANCE.minRange,
    maxRange: HUNTER_BOW_BALANCE.maxRange,
    damage: { ...HUNTER_BOW_BALANCE.damage },
  };
}

/** Overlay the clean-room felling/mining balance (felled yield, deposit size and levels) into the
 *  pipeline's zeroed gathering block: the mod data carries none of them. Everything else the real row
 *  ships is preserved. */
function withGatheringBalance(good: GoodType): GoodType {
  if (good.gathering === undefined) return good;
  const balance = GATHERING_BALANCE_BY_ID[good.id];
  if (balance === undefined) return good;
  return {
    ...good,
    gathering: {
      ...good.gathering,
      ...(balance.yieldPerNode !== undefined ? { yieldPerNode: balance.yieldPerNode } : {}),
      ...(balance.depositSize !== undefined ? { depositSize: balance.depositSize } : {}),
      ...(balance.depositLevels !== undefined ? { depositLevels: balance.depositLevels } : {}),
    },
  };
}

/**
 * Ready the real content for the sim: apply the clean-room overlays the pipeline cannot extract, keyed by
 * good id off the same tables the sandbox reads, then report the gaps they cannot fill rather than
 * dropping them silently.
 *
 * It also injects the sim's semantic nav-terrain classes ({@link NAV_LANDSCAPE_TYPES}) into `landscape`:
 * real content's detailed types (1..87) carry no collision classes, and the class ids sit in a reserved
 * band that never aliases them. Idempotent, so a class row already present is not duplicated.
 */
export function mergeRealContent(
  real: ContentSet,
  goodNames?: ReadonlyMap<string, string>,
): RealContentMerge {
  const goods = real.goods.map((raw) =>
    withWoolCarcassHarvest(
      withEquipClass(withGatheringBalance(withFarmingBalance(withLocalizedName(raw, goodNames)))),
    ),
  );
  const unfarmedFieldGoods = goods
    .filter((g) => hasFieldFarmAtomics(g) && g.farming === undefined)
    .map((g) => g.id);
  const buildings = real.buildings.map(withShelterCapacity);
  const jobs = real.jobs.map(withHeroArmor);
  const cataloged = new Set(VIKING_BUILDINGS.map((b) => b.id));
  // A vehicle is commanded, never built from the menu, so the catalog does not list it.
  const uncatalogedBuildings = real.buildings
    .filter((b) => b.kind !== BUILDING_KIND.vehicle && !cataloged.has(b.id))
    .map((b) => b.id);
  const landscapeIds = new Set(real.landscape.map((t) => t.typeId));
  const navRows = NAV_LANDSCAPE_TYPES.filter((t) => !landscapeIds.has(t.typeId));
  const landscape = [...real.landscape, ...navRows];
  // The real IR carries no human hitpoints (unreadable, source basis "Combat hit resolution"), so a
  // playable tribe takes the clean-room value. Scoped by `jobEnables`: an animal/monster tribe is no
  // settler's tribe and keeps its own 0.
  const tribes = real.tribes.map((t) =>
    t.hitpoints > 0 || t.jobEnables.length === 0 ? t : { ...t, hitpoints: HUMAN_HITPOINTS },
  );
  const weapons = real.weapons.map((weapon) => withCivilianBowBalance(withHeroFistJob(weapon)));
  // Wool's pipeline row is leather's whole row re-keyed: the cadaver stage (landscape 79 / gfx 847), its
  // footprint, and the store-pile stage, so a wool heap draws the hide pile's decal. The same named
  // approximation as the harvest atomic.
  const woolType = goods.find((g) => g.id === 'wool')?.typeId;
  const leatherRow = real.gatheringPipeline.find((p) => p.goodId === 'leather');
  const needsWoolRow =
    woolType !== undefined &&
    leatherRow !== undefined &&
    !real.gatheringPipeline.some((p) => p.goodId === 'wool');
  const gatheringPipeline = needsWoolRow
    ? [...real.gatheringPipeline, { ...leatherRow, goodType: woolType, goodId: 'wool' }]
    : real.gatheringPipeline;
  const huntPrey = huntPreyRows(goods, tribes);
  // Only a good felled or mined off a landscape node reads the felling/mining balance. A field crop, a
  // carcass yield and a hive's honey (no harvest stage) are supplied by their own loops.
  const huntYields = new Set(huntPrey.flatMap((prey) => prey.yields.map((y) => y.goodType)));
  const unbalancedGoods = goods
    .filter(
      (g) =>
        g.gathering?.harvest !== undefined &&
        g.farming === undefined &&
        !huntYields.has(g.typeId) &&
        GATHERING_BALANCE_BY_ID[g.id] === undefined,
    )
    .map((g) => g.id);
  // Re-validate so a bad overlay or injected row fails at the app boundary, not deep in the sim.
  return {
    content: parseContentSet({
      ...real,
      goods,
      jobs,
      buildings,
      landscape,
      tribes,
      weapons,
      gatheringPipeline,
      huntPrey,
    }),
    unbalancedGoods,
    unfarmedFieldGoods,
    uncatalogedBuildings,
  };
}

/**
 * Load the served real content and ready it for the sim in one call. Returns `null` on a bare checkout
 * (no `content/ir.json`), so the interactive entries fall back to the clean-room sandbox content.
 */
export async function loadRuntimeRealContent(
  goodNames?: ReadonlyMap<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<RealContentMerge | null> {
  const real = await loadRealContent(fetchImpl);
  return real === null ? null : mergeRealContent(real, goodNames);
}

/** Log the gaps {@link mergeRealContent} surfaced as one line. No-op when there is nothing to report. */
export function logRealContentGaps(merge: RealContentMerge): void {
  const { unbalancedGoods, unfarmedFieldGoods, uncatalogedBuildings } = merge;
  if (unbalancedGoods.length === 0 && unfarmedFieldGoods.length === 0 && uncatalogedBuildings.length === 0)
    return;
  diag.info(
    'content',
    `real content gaps: ${unbalancedGoods.length} felled/mined good(s) without clean-room balance ` +
      `[${unbalancedGoods.join(', ')}], ${unfarmedFieldGoods.length} field good(s) without a farming block ` +
      `[${unfarmedFieldGoods.join(', ')}], ${uncatalogedBuildings.length} building(s) beyond the catalog ` +
      `[${uncatalogedBuildings.join(', ')}]`,
  );
}
