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

/** No room below this many free nodes on the seat's whole land: an island start, whose home band is about
 *  as cramped as mroczny_las's but which can never grow past it. Arabskie_wyspy_wolna_gra_mieszana's
 *  islands hold 3.8-4.5k; the smallest shared lands, smocza_kraina's and ciezka_wspolpraca's, 30k and 37k,
 *  every other map 69k or more. */
export const NO_ROOM_LAND_FREE_NODES = 10_000;

/** Rich from this many free nodes in the near band, beside both metals in plenty
 *  ({@link RICH_METAL_UNITS}). Every diamentowa_dolina and magiczny_las seat holds 13-20k, specjalna_forteca
 *  1 10k. */
export const RICH_NEAR_FREE_NODES = 12_000;
/** And at least this much iron and this much gold in {@link reachableDeposit}: owner ruling, diamentowa_dolina
 *  and magiczny_las unleash their expansion. Their seats reach 2.7-4.3k iron and 2.6-3.9k gold;
 *  specjalna_forteca's, the next, at most 1.7k iron and 1.4k gold. */
export const RICH_METAL_UNITS = 2_200;
/** Iron in {@link reachableDeposit} under which a seat forges weapons only and dresses its army in tunics
 *  (owner ruling on krwawa_rzeka: little iron, so plate is hard to come by). Krwawa_rzeka's seats reach
 *  0.57-1.0k, mroczny_las's 0.39-0.6k; specjalna_forteca's, the next, 1.46-1.73k. */
export const IRON_PLENTY_UNITS = 1_200;
/** Gold in {@link reachableDeposit} under which a seat keeps to one mint (owner ruling on krwawa_rzeka:
 *  less gold, fewer mints). Krwawa_rzeka's seats reach 350-530, mroczny_las's 430-600;
 *  specjalna_forteca's, the next, 890-1420. */
export const GOLD_PLENTY_UNITS = 750;

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
  const noRoom = fire(
    'landRoomSmall',
    seat.component !== NO_COMPONENT && seat.continent.free < NO_ROOM_LAND_FREE_NODES,
  );
  const iron = reachableDeposit(seat, 'iron');
  const gold = reachableDeposit(seat, 'gold');
  const rich = fire(
    'nearRich',
    near.free >= RICH_NEAR_FREE_NODES && iron >= RICH_METAL_UNITS && gold >= RICH_METAL_UNITS,
  );
  const archetype: EconomicArchetype = islands
    ? 'islands'
    : freeShareLow || clearableDominant || roomSmall
      ? 'cramped'
      : rich
        ? 'rich'
        : 'standard';

  const sides = new Set<EconomicSide>();
  const ironAccess = seat.access.get('iron');
  const ironInReach =
    ironAccess !== undefined &&
    (NEARBY.includes(ironAccess.access) ||
      (ironAccess.access === 'continent' &&
        ironAccess.zones !== null &&
        ironAccess.zones <= IRON_CONTINENT_REACH_ZONES));
  fired.add(ironInReach ? 'ironInReach' : 'ironOutOfReach');
  if (!ironInReach) sides.add('naturalArms');
  else sides.add(fire('ironScarce', iron < IRON_PLENTY_UNITS) ? 'ironWeapons' : 'ironArms');
  const onLand = (good: string): boolean => {
    const access = seat.access.get(good);
    return access !== undefined && ON_LAND.includes(access.access);
  };
  if (fire('goldAndMushroomOnLand', onLand('gold') && onLand('mushroom'))) {
    sides.add('goldLine');
    if (fire('goldScarce', gold < GOLD_PLENTY_UNITS)) sides.add('oneMint');
  }
  const fish = seat.access.get(FISH_ACCESS_KEY);
  if (fire('fishNearby', fish !== undefined && NEARBY.includes(fish.access))) sides.add('fishing');
  if (fire('grassAtHome', home.plantable >= HERBS_HOME_GRASS_NODES)) sides.add('herbs');
  if (noRoom) sides.add('noRoom');

  return {
    archetype,
    sides: ECONOMIC_SIDES.filter((side) => sides.has(side)),
    evidence: ECONOMIC_RULES.filter((rule) => fired.has(rule)),
  };
}

/** How much of `good` the seat may count on: the near band's deposit plus its share of the deposit on its
 *  whole land, split evenly between the starts the brief records there, map-scripted ones included. The
 *  near band counts twice, as it lies on the seat's land too, so a deposit beside the seat outweighs one
 *  a rival sits on. */
export function reachableDeposit(seat: SeatBrief, good: string): number {
  const near = seat.near.deposits.get(good) ?? 0;
  if (seat.component === NO_COMPONENT) return near;
  const seatsOnLand = 1 + seat.others.filter((other) => other.sameLand).length;
  return near + Math.floor((seat.continent.deposits.get(good) ?? 0) / seatsOnLand);
}

/** No other seat starts on the seat's land, and at least one starts on another. */
function islandStart(seat: SeatBrief): boolean {
  if (seat.component === NO_COMPONENT) return false;
  return seat.others.length > 0 && seat.others.every((other) => !other.sameLand);
}
