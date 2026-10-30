import {
  ECONOMIC_RULES,
  ECONOMIC_SIDES,
  type EconomicArchetype,
  type EconomicChoice,
  type EconomicRule,
  type EconomicSide,
} from '../../../components/index.js';
import { NO_COMPONENT } from '../../../nav/terrain/index.js';
import { type AccessClass, FISH_ACCESS_KEY, type SeatBrief } from '../knowledge/seat-brief.js';

// Thresholds below are authored. Their figures come from the seat briefs of diamentowa_dolina,
// magiczny_las, mroczny_las, krwawa_rzeka and specjalna_forteca (home band 7-10 zones, near band 21-36).

/** Cramped below this share of the home band's land free to build on. Mroczny_las 0 and 3 sit at 48% and
 *  43%, magiczny_las 6 at 24%; every diamentowa_dolina and krwawa_rzeka seat at 57-85%. */
export const CRAMPED_HOME_FREE_PERCENT = 50;
/** Cramped when the home band's clearable ground reaches this share of its free ground. Mroczny_las 0
 *  and 3 sit at 63% and 71%, magiczny_las 6 at 270%; the next is krwawa_rzeka 3 at 50%. */
export const CRAMPED_HOME_CLEARABLE_PERCENT = 60;
/** Cramped below this many free nodes in the home band, however much land a map edge cut off. Mroczny_las
 *  0, 2 and 3 hold 2900-3500, magiczny_las 6 1900; the roomiest seats under it hold 4300-4500. */
export const CRAMPED_HOME_FREE_NODES = 4000;

/** Rich from this many free nodes in the near band. Only diamentowa_dolina 8 (30k) holds more; every
 *  other seat holds 8.9-20k. */
export const RICH_NEAR_FREE_NODES = 20_000;
/** And this much stone and mud in the near band. Specjalna_forteca's seats hold 4.3-8.3k, every other
 *  seat 1.1-3.4k. */
export const RICH_NEAR_BUILDING_DEPOSITS = 4_000;
/** The deposits a building site eats that do not grow back. */
export const BUILDING_DEPOSIT_GOOD_IDS: readonly string[] = ['stone', 'mud'];

/** Iron further on the seat's own land still arms it with iron within this many zones. Diamentowa_dolina
 *  8's nearest iron lies 4 zones out, mroczny_las 3's 8. */
export const IRON_CONTINENT_REACH_ZONES = 5;
/** Herbs need at least this much free grass in the home band. Specjalna_forteca 5 and 6, mroczny_las 3 and
 *  magiczny_las 6 hold 140-1500; every other seat 2300 or more. */
export const HERBS_HOME_GRASS_NODES = 2_000;

const NEARBY: readonly AccessClass[] = ['home', 'near'];
const ON_LAND: readonly AccessClass[] = ['home', 'near', 'continent'];

/** The economic choice the seat brief argues for: islands, else cramped, else rich, else standard, with
 *  the sides beside it. Pure; `evidence` lists every rule that fired, archetype rules a later rule
 *  outranks included. */
export function selectEconomy(seat: SeatBrief): EconomicChoice {
  const fired = new Set<EconomicRule>();
  const fire = (rule: EconomicRule, when: boolean): boolean => {
    if (when) fired.add(rule);
    return when;
  };
  const islands = fire('islandStart', islandStart(seat));
  const { home, near } = seat;
  const freeShareLow = fire('homeFreeShareLow', home.free * 100 < home.land * CRAMPED_HOME_FREE_PERCENT);
  const clearableDominant = fire(
    'homeClearableDominant',
    home.clearable * 100 >= home.free * CRAMPED_HOME_CLEARABLE_PERCENT,
  );
  const roomSmall = fire('homeRoomSmall', home.free < CRAMPED_HOME_FREE_NODES);
  let buildingDeposits = 0;
  for (const good of BUILDING_DEPOSIT_GOOD_IDS) buildingDeposits += near.deposits.get(good) ?? 0;
  const rich = fire(
    'nearRich',
    near.free >= RICH_NEAR_FREE_NODES && buildingDeposits >= RICH_NEAR_BUILDING_DEPOSITS,
  );
  const archetype: EconomicArchetype = islands
    ? 'islands'
    : freeShareLow || clearableDominant || roomSmall
      ? 'cramped'
      : rich
        ? 'rich'
        : 'standard';

  const sides = new Set<EconomicSide>();
  const iron = seat.access.get('iron');
  const ironInReach =
    iron !== undefined &&
    (NEARBY.includes(iron.access) ||
      (iron.access === 'continent' && iron.zones !== null && iron.zones <= IRON_CONTINENT_REACH_ZONES));
  fired.add(ironInReach ? 'ironInReach' : 'ironOutOfReach');
  sides.add(ironInReach ? 'ironArms' : 'naturalArms');
  const onLand = (good: string): boolean => {
    const access = seat.access.get(good);
    return access !== undefined && ON_LAND.includes(access.access);
  };
  if (fire('goldAndMushroomOnLand', onLand('gold') && onLand('mushroom'))) sides.add('goldLine');
  const fish = seat.access.get(FISH_ACCESS_KEY);
  if (fire('fishNearby', fish !== undefined && NEARBY.includes(fish.access))) sides.add('fishing');
  if (fire('grassAtHome', home.plantable >= HERBS_HOME_GRASS_NODES)) sides.add('herbs');

  return {
    archetype,
    sides: ECONOMIC_SIDES.filter((side) => sides.has(side)),
    evidence: ECONOMIC_RULES.filter((rule) => fired.has(rule)),
  };
}

/** No other seat starts on the seat's land, and at least one starts on another. */
function islandStart(seat: SeatBrief): boolean {
  if (seat.component === NO_COMPONENT) return false;
  return seat.others.length > 0 && seat.others.every((other) => !other.sameLand);
}
