import type { BuildingType, ContentSet } from '@open-northland/data';
import {
  AssistantCounters,
  type AssistantCounterValues,
  assistantCountersEntity,
  Building,
  CompletedCycles,
  type EconomicSide,
  JobAssignment,
  PRODUCTION_UNLIMITED,
  ProductionCounters,
  type ProductionCountersView,
  playerPlacementTribes,
  productionCountOf,
  professionProgressionEnabled,
  Settler,
  UnderConstruction,
  Vehicle,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { isBuilt, ownedBuildings, ownedSettlers } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { goodEnabled } from '../../progression/index.js';
import { vehicleHouseOfGood } from '../../readviews/index.js';
import { isCarrierJob } from '../../stores/index.js';
import { vehicleIndex } from '../../vehicles/registry.js';
import { militaryWaits, seatHasSide } from '../build-order/seat-order.js';
import type { ComputerProfile } from '../difficulty.js';
import { type GamePhase, gamePhase } from '../game-phase.js';
import { type HerdKept, seatHerdKept } from '../herd.js';
import { type JoineryRole, joineryRoles, ROLE_JOINERY_ID, smallestShipHouse } from '../joinery-role.js';
import { BARRACKS_LEAD_TICKS } from '../military/deadline.js';
import { rivalOverSea } from '../sea-route.js';
import { militaryOrdersOf } from '../strategy/military.js';
import { COLLECTED_GOOD_IDS } from './collectors/wanted-goods.js';
import {
  ARMY_RESERVE_UNITS,
  needCounters,
  REST_SEAT,
  type StockCraftPlan,
  type StockReads,
  type StockTarget,
  type StockWant,
  stockSeats,
} from './craft-stock.js';
import { standsFree } from './hauling-carts.js';
import type { SeatSupply, SupplyLine } from './supply.js';

/**
 * One operator seat's products, by stable content ids. A plain list is worked as is. A `glut` seat drops
 * each of its `goods` while the seat holds at least that many units of it (the summary bar's figure:
 * stores, workshop shelves, hands and the heaps in reach), and takes it back once the stock has fallen its
 * `band` (default {@link CRAFT_GLUT_BAND_UNITS}) under the glut; while every capped good is dropped it
 * works `otherwise`, or the whole list when there is none. A `firstFed` seat works the first of its lines whose `input` the
 * seat holds a unit of, and every line while it holds none of them. A good with supply lines
 * ({@link SeatSupply}) takes no authored glut: {@link SeatCraftPlan.sink} covers it. A `firstEnabled` seat
 * works the first of its seats that names a good the seat may make right now, so a better product
 * replaces weaker ones once earned. An `until` seat works `works` until the seat has earned the good it
 * names and `otherwise` from then on. A `whileOwned` seat works `works` while the seat owns a building of
 * that type, standing or a site (with `siteOnly`, a site still under construction), and `otherwise`
 * meanwhile. A `rest` seat stops every product of its operator.
 * Over every kind, a seat whose goods all lack their inputs ({@link inputsInStock}) works the next seat's in
 * the plan with one that has them, {@link SeatCraftPlan.unfed} last, and its own while none has.
 */
export type CraftSeat =
  | readonly string[]
  | {
      readonly goods: readonly string[];
      readonly glut: Readonly<Record<string, number>>;
      readonly band?: number;
      readonly otherwise?: CraftSeat;
    }
  | { readonly firstFed: readonly { readonly good: string; readonly input: string }[] }
  | { readonly firstEnabled: readonly CraftSeat[] }
  | { readonly until: string; readonly works: CraftSeat; readonly otherwise: CraftSeat }
  | {
      readonly whileOwned: string;
      readonly siteOnly?: true;
      readonly works: CraftSeat;
      readonly otherwise: CraftSeat;
    }
  | typeof REST_SEAT
  | FleetSeat;

/**
 * A seat on a vehicle good (`fleet`) with a cap on the seat's fleet of it, counting the vehicles standing
 * ({@link seatFleet}): the seat works `otherwise` from `cap` on, or where the content has no
 * such good or the seat has yet to earn it, and takes the vehicle back once the fleet has fallen to
 * `resume`. In between it keeps its current selection, so no state beyond the live selection is kept.
 * A {@link LANDING_FLEET} cap is the seat's landing fleet ({@link landingFleetShips}), raised for a seat
 * whose rival lies over the sea to room for its sea scout ({@link SEA_SCOUT_SHIPS}), taken back as soon as
 * the fleet falls under it. While it builds the vehicle it works the goods `beside` it in rotation.
 */
export type FleetSeat = {
  readonly fleet: string;
  readonly beside?: readonly string[];
  /** Count only the vehicles standing free ({@link standsFree}). */
  readonly freeOnly?: true;
  readonly otherwise: CraftSeat;
} & ({ readonly cap: number; readonly resume: number } | { readonly cap: typeof LANDING_FLEET });

/** The cap of a {@link FleetSeat} sized to the army the seat would land. */
export const LANDING_FLEET = 'landingFleet';

/** Owner ruling: a small ship carries 20 soldiers, its 19 passengers and the commander at the helm. */
export const SOLDIERS_PER_SHIP = 20;

/** Owner ruling: an island seat gathers a fleet of 2 to 10 ships for its landing. */
export const LANDING_FLEET_MIN_SHIPS = 2;
export const LANDING_FLEET_MAX_SHIPS = 10;

/** Owner ruling: a big landing sails with at least 4 loaded ships, about 80 men, or with the seat's whole
 *  landing fleet ({@link landingFleetShips}) when that is smaller, and never fewer than
 *  {@link LANDING_FLEET_MIN_SHIPS}. */
export const LANDING_BIG_SHIPS = 4;

/** The fewest free ships a landing sails with for a landing fleet of `fleet` ships. */
export function landingFewestShips(fleet: number): number {
  return Math.max(LANDING_FLEET_MIN_SHIPS, Math.min(LANDING_BIG_SHIPS, fleet));
}

/** Owner ruling: an island seat scouts its rival by sea. Its joinery builds enough ships that this many
 *  can scout while the landing's fewest ({@link landingFewestShips}) lie free. */
export const SEA_SCOUT_SHIPS = 1;

/** The ships a seat's landing takes: its planned army, the army at which its barracks sends the whole band
 *  scaled by its plan's draft share (`strategy/military.ts`), in {@link SOLDIERS_PER_SHIP}, within the
 *  owner's fleet band. */
export function landingFleetShips(world: World, player: number, profile: ComputerProfile): number {
  // The share by hand: the difficulty table imports this module's plans.
  const { num, den } = militaryOrdersOf(world, player).draftCapShare;
  const army = Math.floor((profile.army.cap * num) / den);
  const ships = Math.ceil(army / SOLDIERS_PER_SHIP);
  return Math.min(LANDING_FLEET_MAX_SHIPS, Math.max(LANDING_FLEET_MIN_SHIPS, ships));
}

/** A workplace type's product plan by fixed operator seats, by stable content ids (authored). */
export interface SeatCraftPlan {
  /** One seat per operator, counted across every building of the seat that works this plan and handed out
   *  in canonical settler order, wrapping when more operators work it than it lists. */
  readonly seats: readonly CraftSeat[];
  /** What the type's only operator works while it employs just one, instead of the first seat. */
  readonly alone?: readonly string[];
  /** What an operator works while no good of his seat nor of any other seat has its inputs in stock
   *  ({@link inputsInStock}), before he waits on his own seat's inputs. */
  readonly unfed?: readonly string[];
  /** What every operator works while each product of the type with supply lines ({@link SeatSupply}) lies
   *  at its glut line, until one falls under its comfort line. A type without a sink rests its crew
   *  instead (`staffing-plan.ts`). */
  readonly sink?: readonly string[];
}

/** A workplace type's product plan: fixed seats, or seats shared out by stock each decision. */
export type CraftPlan = SeatCraftPlan | StockCraftPlan;

/** How far under its glut a good's stock falls before a seat takes the good back (authored), so a stock
 *  hovering at the line does not flip the seat with every unit made or taken. */
export const CRAFT_GLUT_BAND_UNITS = 8;

/** The iron tools in stock up to which the joiners make them (authored). Every worker wears one and no bill
 *  or shelf sizes them; past it the tools would eat the iron the smithies' plate and long swords want
 *  (seen at 50-146 tools on magiczny_las with 7 iron left). */
export const JOINERY_TOOL_GLUT_UNITS = 24;

/** Owner ruling: a joiner makes wooden tools only to earn the iron tool, from then on iron tools alone and
 *  never furniture; he rests while the iron tools lie at {@link JOINERY_TOOL_GLUT_UNITS}. */
const JOINERY_SEAT: CraftSeat = {
  until: 'tool_iron',
  works: ['tool_wooden'],
  otherwise: { goods: ['tool_iron'], glut: { tool_iron: JOINERY_TOOL_GLUT_UNITS }, otherwise: REST_SEAT },
};

/** The handcarts standing free at which the seat stops building more (authored): a
 *  spare one waits for the next carrier hired. */
export const AI_FREE_HANDCARTS = 2;

/** A joiner of the upgraded tools joinery: handcarts and iron tools in turn while fewer than
 *  {@link AI_FREE_HANDCARTS} carts stand free, a {@link JOINERY_SEAT} otherwise. */
const HANDCART_SEAT: CraftSeat = {
  fleet: 'handcart',
  beside: ['tool_iron'],
  freeOnly: true,
  cap: AI_FREE_HANDCARTS,
  resume: AI_FREE_HANDCARTS - 1,
  otherwise: JOINERY_SEAT,
};

/** A joiner of the ship joinery: small ships while the seat's fleet stands under its landing fleet,
 *  counting a sunk ship out, and the upgraded joinery's handcarts and tools between those runs. */
const SHIP_SEAT: CraftSeat = { fleet: 'ship_small', cap: LANDING_FLEET, otherwise: HANDCART_SEAT };

/** The crockery in stock at which the pottery's crockery seat turns to bricks and tiles (authored). A
 *  stocked home eats it beside its food, so no bill or shelf sizes it. */
export const CROCKERY_GLUT_UNITS = 24;

/** The shoes a tailor keeps in stock (authored): every settler wears a pair out, and no bill or shelf sizes
 *  them. */
export const SHOES_STOCK_UNITS = 24;

/** The most plentiful seats a short product takes at once ({@link shortFirst}) (authored): enough to turn a
 *  pottery's crockery seat to a short building material and still leave its other lines a hand. */
const SHORT_PRODUCT_SEATS = 2;

/** Owner ruling: an input good is kept in a small buffer sized to what consumes it, one cycle's unit per
 *  operator of the seat's workshops that take it. */
export const INPUT_UNITS_PER_CONSUMER = 1;

/** The coins a big healing potion's recipe takes. */
export const COINS_PER_BIG_POTION = 2;

/** The big potions' worth of coins the mint keeps in stock per druid (authored, owner ruling that the
 *  coins cover the druids). A druid spends two coins a cycle and a coiner strikes one, so the stock drains
 *  whatever the mint does; at two potions a druid a two-druid hut's lack spans two coiners' shares
 *  (`OPERATOR_SHARE_UNITS`), the whole crew of a mint strikes coins under it, and the amulets take the gold
 *  only once the druids are covered. */
export const COIN_POTIONS_PER_DRUID = 2;

/** Every armour a recruit may take: an army want for armour reads them all. */
const ARMOUR_GOOD_IDS: readonly string[] = ['armor_plate', 'armor_chain', 'armor_leather', 'armor_wool'];

const ARMY_ARMOUR: StockTarget = { kind: 'army', need: 'armour' };
const ARMY_SWORD: StockTarget = { kind: 'army', need: 'sword' };
const ARMY_SPEAR: StockTarget = { kind: 'army', need: 'spear' };
const ARMY_BOW: StockTarget = { kind: 'army', need: 'bow' };
const INPUT_BUFFER: StockTarget = { kind: 'consumers', perConsumer: INPUT_UNITS_PER_CONSUMER };

/** Owner ruling: the economy first, the army shortly before the deadline. An iron-rich seat stocks two
 *  waves of each iron arm from its barracks lead on, so the draft, which takes no more men into a class
 *  than the arms in stock, finds plate, chain and iron weapons rather than short bows and leather. Without
 *  it the upper smiths of a crowded diamentowa_dolina seat rested at a wave's reserve while its army fought
 *  in leather from game minute 60. */
const IRON_ARMS_READY_UNITS = 2 * ARMY_RESERVE_UNITS;
const READY_ARMOUR: StockTarget = { ...ARMY_ARMOUR, readyStock: IRON_ARMS_READY_UNITS };
const READY_SWORD: StockTarget = { ...ARMY_SWORD, readyStock: IRON_ARMS_READY_UNITS };
const READY_SPEAR: StockTarget = { ...ARMY_SPEAR, readyStock: IRON_ARMS_READY_UNITS };

/** Owner ruling: short swords only as the strength amulet's input and, until the long sword is earned, to
 *  arm the swordsmen and earn it. */
const SHORT_SWORD_WANTS: readonly StockWant[] = [
  { goods: ['sword_shord'], target: ARMY_SWORD, until: 'sword_long' },
  { goods: ['sword_shord'], target: INPUT_BUFFER },
];

/** Owner ruling: the smiths focus on long swords and iron spears. */
const WEAPON_WANTS: readonly StockWant[] = [
  { goods: ['sword_long'], target: ARMY_SWORD },
  { goods: ['spear_iron'], target: ARMY_SPEAR },
  ...SHORT_SWORD_WANTS,
];

/** Past every want a smith forges short swords while the long sword is still to earn, and from then on the
 *  army's arms for stock (the surplus wants, `./craft-stock.ts`). */
const SMITH_OVERFLOW: readonly CraftSeat[] = [
  { until: 'sword_long', works: ['sword_shord'], otherwise: REST_SEAT },
];

/** On a seat rich in iron the smith past every want keeps forging long swords until he has earned chain
 *  mail, whose discovery opens the upper smithy: resting there left a lone lower smith short of it at game
 *  minute 90 on a crowded diamentowa_dolina seat. Short swords only while the long sword is still to earn,
 *  the army's arms for stock once chain mail is earned. */
const IRON_ARMS_SMITH_OVERFLOW: readonly CraftSeat[] = [
  {
    until: 'sword_long',
    works: ['sword_shord'],
    otherwise: { until: 'armor_chain', works: ['sword_long'], otherwise: REST_SEAT },
  },
];

/** Owner ruling: on a seat rich in iron the army wears plate and chain mail, forged beside the weapons. The
 *  armour want reads the iron armour alone: the leather the tailors sewed before plate was earned would
 *  otherwise stand in for it. */
const IRON_ARMS_SMITHY: StockCraftPlan = {
  wants: [
    { goods: ['armor_plate', 'armor_chain'], target: READY_ARMOUR },
    { goods: ['sword_long'], target: READY_SWORD },
    { goods: ['spear_iron'], target: READY_SPEAR },
    ...SHORT_SWORD_WANTS,
  ],
  overflow: IRON_ARMS_SMITH_OVERFLOW,
};

/** Owner ruling: a seat with little iron forges weapons alone and dresses its army in tunics. */
const IRON_WEAPONS_SMITHY: StockCraftPlan = { wants: WEAPON_WANTS, overflow: SMITH_OVERFLOW };

/** Owner ruling: short bows only to arm the archers and earn the long bow, then long bows alone; wooden
 *  spears as the iron spear's input and, until the iron spear is earned or where no smith forges one, for
 *  the spearmen. Past every want an armourer makes both earners while the long bow is still to earn, and
 *  from then on the wanted goods for stock. */
const ARMORY: StockCraftPlan = {
  wants: [
    { goods: ['bow_long'], target: ARMY_BOW },
    { goods: ['bow_short'], target: ARMY_BOW, until: 'bow_long' },
    { goods: ['spear_wooden'], target: ARMY_SPEAR, until: 'spear_iron' },
    { goods: ['spear_wooden'], target: INPUT_BUFFER },
  ],
  overflow: [{ until: 'bow_long', works: ['bow_short', 'spear_wooden'], otherwise: REST_SEAT }],
};

/** Owner ruling: on a seat rich in iron leather armour is only the defence amulet's input and the army's
 *  armour until plate is earned; the tailors keep shoes in stock and sew the wanted goods for stock past
 *  their wants. Tunics stand in for the leather armour until plate is earned. */
const IRON_ARMS_SEWERY: StockCraftPlan = {
  wants: [
    { goods: ['armor_leather'], target: ARMY_ARMOUR, counts: ARMOUR_GOOD_IDS, until: 'armor_plate' },
    { goods: ['armor_wool'], target: ARMY_ARMOUR, counts: ARMOUR_GOOD_IDS, until: 'armor_plate' },
    { goods: ['shoes'], target: { kind: 'units', units: SHOES_STOCK_UNITS } },
    { goods: ['armor_leather'], target: INPUT_BUFFER },
  ],
  overflow: [],
};

/** Owner ruling: a seat with little or no iron sews no leather armour, only tunics for the army and shoes,
 *  past their stock lines too. */
const TUNIC_SEWERY: StockCraftPlan = {
  wants: [
    { goods: ['armor_wool'], target: ARMY_ARMOUR, counts: ARMOUR_GOOD_IDS },
    { goods: ['shoes'], target: { kind: 'units', units: SHOES_STOCK_UNITS } },
  ],
  overflow: [],
};

/** Owner ruling: a tunic seat that keeps cattle but no pair of sheep sews leather armour for the army in
 *  the tunics' place, and shoes. */
const LEATHER_SEWERY: StockCraftPlan = {
  wants: [
    { goods: ['armor_leather'], target: ARMY_ARMOUR, counts: ARMOUR_GOOD_IDS },
    { goods: ['shoes'], target: { kind: 'units', units: SHOES_STOCK_UNITS } },
  ],
  overflow: [],
};

const DEFENCE_AMULET_LINE = { good: 'amulet_defense', input: 'armor_leather' } as const;
const STRENGTH_AMULET_LINE = { good: 'amulet_strength', input: 'sword_shord' } as const;

/** Amulet seats: each strikes its own amulet while its input is in store and the other one's meanwhile, so
 *  the seat never idles on a line the tailors or the smiths have not fed; both lines while neither is. */
const STRENGTH_AMULET_SEAT: CraftSeat = { firstFed: [STRENGTH_AMULET_LINE, DEFENCE_AMULET_LINE] };
const DEFENCE_AMULET_SEAT: CraftSeat = { firstFed: [DEFENCE_AMULET_LINE, STRENGTH_AMULET_LINE] };

/** Owner ruling: the mint keeps coins for the druids and turns the rest of its gold into amulets by the
 *  inputs in store, strength-first and defence-first seats in turn; it strikes coins meanwhile to earn the
 *  amulets. */
const MINT: StockCraftPlan = {
  wants: [
    {
      goods: ['coin'],
      target: { kind: 'consumers', perConsumer: COIN_POTIONS_PER_DRUID * COINS_PER_BIG_POTION },
    },
  ],
  overflow: [
    { until: 'amulet_strength', works: ['coin'], otherwise: STRENGTH_AMULET_SEAT },
    { until: 'amulet_defense', works: ['coin'], otherwise: DEFENCE_AMULET_SEAT },
  ],
};

/** The bows and wooden spears in stock at which the easy seat's first armourer drops that line (authored). */
const ARMOURY_GLUT_UNITS = 20;

/** How many druids a seat's six huts employ. */
const DRUID_SEATS = 12;

/** Owner ruling: a druid boils holy oil, the cheapest brew, only to earn the big healing potion, and from
 *  then on brews the big potion alone. Every brew trains the druid's general track, which the potion's
 *  discovery reads, so the oil's one herb buys the same experience as a potion's eight inputs. */
const POTION_SEAT: CraftSeat = { firstEnabled: [['potion_heal_big'], ['holy_oil']] };

/** The holy oil in stock at which the temple-site druid turns back to potions, and the band under it at
 *  which he takes the oil back (authored): the site's bill takes one unit, so the store holds one or two. */
export const TEMPLE_SITE_OIL_UNITS = 2;
const TEMPLE_SITE_OIL_BAND_UNITS = 1;

/** The first druid keeps a unit of holy oil in store while the seat's temple is a site, whose bill takes
 *  one: the homes may have burned the oil the druids boiled while they earned the big potion. */
const TEMPLE_SITE_SEAT: CraftSeat = {
  whileOwned: 'work_temple',
  siteOnly: true,
  works: {
    goods: ['holy_oil'],
    glut: { holy_oil: TEMPLE_SITE_OIL_UNITS },
    band: TEMPLE_SITE_OIL_BAND_UNITS,
    otherwise: POTION_SEAT,
  },
  otherwise: POTION_SEAT,
};

/**
 * The product plans per workplace type (authored). Smithies, armouries, tailors and mints pick from stock
 * each decision (owner ruling, {@link StockCraftPlan}); the rest keep fixed seats whose lists interleave so
 * a partly staffed type already runs its main lines. Whatever the lists say, a product the build order runs
 * short of comes first ({@link tuneCraftCounters}); over the lists, a type's sink takes the whole crew while
 * its stocked products lie at glut ({@link sinkHolds}). The reason for each row stands beside it.
 */
export const CRAFT_PLANS_BY_BUILDING_ID: Readonly<Record<string, CraftPlan>> = {
  // The lower joinery makes wooden tools alone, so its joiner rests once the iron tool is earned.
  work_joinery_00: { seats: [{ until: 'tool_iron', works: ['tool_wooden'], otherwise: REST_SEAT }] },
  work_joinery_01: { seats: [JOINERY_SEAT, JOINERY_SEAT] },
  // The upgraded joinery's joiners build the carriers' handcarts in turn with iron tools while few stand
  // spare.
  work_joinery_02: { seats: [HANDCART_SEAT] },
  // The first potter works bricks and tiles, the second crockery, which doubles a stocked home's food,
  // until it piles up; a short building material takes the crockery seat, and both potters turn to
  // crockery while bricks and tiles lie at their glut lines.
  work_pottery_01: {
    seats: [
      ['brick', 'tile'],
      { goods: ['crockery'], glut: { crockery: CROCKERY_GLUT_UNITS }, otherwise: ['brick', 'tile'] },
    ],
    alone: ['brick', 'tile'],
    sink: ['crockery'],
  },
  work_mason_hut_01: { seats: [['pillar', 'ornament']] },
  // Both breeders raise cattle for the leather of shoes and leather armour (owner ruling, iron arms).
  work_animal_farm: { seats: [['cattle']] },
  work_sewery_00: IRON_ARMS_SEWERY,
  work_sewery_01: IRON_ARMS_SEWERY,
  work_bakery_01: { seats: [['bread']] },
  work_smithy_00: IRON_ARMS_SMITHY,
  work_smithy_01: IRON_ARMS_SMITHY,
  work_armory_00: ARMORY,
  work_armory_01: ARMORY,
  // The druids boil holy oil until the big healing potion is earned and brew only it from then on; the
  // first keeps a unit of oil in store for a temple site. The lower hut boils only holy oil.
  work_druid_00: { seats: [['holy_oil']] },
  work_druid_01: {
    seats: [TEMPLE_SITE_SEAT, ...Array.from({ length: DRUID_SEATS - 1 }, (): CraftSeat => POTION_SEAT)],
  },
  work_coin_mint: MINT,
};

/** The catapults a hard seat keeps at most (authored): at this many standing, the catapult
 *  joinery's crew turns to iron tools. */
export const AI_CATAPULT_CAP = 15;

/** The catapults a hard seat has fallen back to when the catapult joinery's crew takes catapults up again
 *  (authored), a band under {@link AI_CATAPULT_CAP} so one loss does not flip the crew. */
export const AI_CATAPULT_RESUME = 12;

/** The plans per role of a workplace type whose buildings each take a role by where they stand
 *  ({@link joineryRoles}), by stable content id. */
export type JoineryRolePlans = Readonly<Record<string, Readonly<Record<JoineryRole, CraftPlan>>>>;

/** The role plans of a seat keeping `cap` catapults and building again from `resume` (authored): the
 *  top-tier joinery's whole crew builds catapults up to the cap and a {@link JOINERY_SEAT}'s goods past
 *  it, or a {@link SHIP_SEAT}'s ships and carts.
 *  Such a type takes no {@link CRAFT_PLANS_BY_BUILDING_ID} row. */
export function joineryRolePlans(cap: number, resume: number): JoineryRolePlans {
  // A seat that keeps no catapults works tools alone: a fleet seat capped at none would take catapults
  // up again at every decision its fleet lies at the resume line.
  const catapultSeat: CraftSeat =
    cap === 0 ? JOINERY_SEAT : { fleet: 'catapult', cap, resume, otherwise: JOINERY_SEAT };
  return {
    [ROLE_JOINERY_ID]: { catapult: { seats: [catapultSeat] }, ship: { seats: [SHIP_SEAT] } },
  };
}

/** The role plans of a seat keeping no catapults (owner ruling: a seat with no room to grow builds none). */
const NO_CATAPULT_ROLE_PLANS: JoineryRolePlans = joineryRolePlans(0, 0);

/** The hard seat's role plans. */
export const CRAFT_PLANS_BY_JOINERY_ROLE: JoineryRolePlans = joineryRolePlans(
  AI_CATAPULT_CAP,
  AI_CATAPULT_RESUME,
);

/**
 * The easy seat's plans over {@link CRAFT_PLANS_BY_BUILDING_ID} (authored): its one mint strikes coins
 * only, and its smithies and armoury make each class's weaker weapon beside the best, since it arms its
 * recruits with either: the short sword takes less iron than the long one, the wooden spear and the short
 * bow only wood.
 */
export const EASY_CRAFT_PLANS: Readonly<Record<string, CraftPlan>> = {
  work_coin_mint: { seats: [['coin']] },
  work_smithy_01: { seats: [['sword_shord'], ['armor_chain'], ['sword_long'], ['spear_iron']] },
  work_armory_01: {
    seats: [
      {
        goods: ['bow_short', 'spear_wooden'],
        glut: { bow_short: ARMOURY_GLUT_UNITS, spear_wooden: ARMOURY_GLUT_UNITS },
        otherwise: ['bow_long'],
      },
      ['bow_long'],
    ],
  },
};

/**
 * The plans of a seat dressing its army in tunics over its difficulty's (owner ruling): one breeder of each
 * farm raises sheep for the tunics' wool and the other cattle for the shoes' leather, and the tailors sew
 * tunics and shoes, never leather armour.
 */
export const NATURAL_ARMS_CRAFT_PLANS: Readonly<Record<string, CraftPlan>> = {
  work_animal_farm: { seats: [['sheep'], ['cattle']] },
  work_sewery_00: TUNIC_SEWERY,
  work_sewery_01: TUNIC_SEWERY,
};

/**
 * The plans of a seat with little iron over its difficulty's (owner ruling on krwawa_rzeka): the tunic
 * seat's breeders and tailors, and smiths on weapons alone, since plate for the army is out of reach.
 */
export const IRON_WEAPONS_CRAFT_PLANS: Readonly<Record<string, CraftPlan>> = {
  ...NATURAL_ARMS_CRAFT_PLANS,
  work_smithy_00: IRON_WEAPONS_SMITHY,
  work_smithy_01: IRON_WEAPONS_SMITHY,
};

/** The rows over a seat's side plans by the livestock it keeps (owner ruling, `../herd.ts`): its breeders
 *  raise only the species it keeps a pair of, and a seat keeping only sheep sews tunics, whatever its side.
 *  A tunic seat keeping only cattle sews leather armour ({@link TUNIC_HERD_CRAFT_PLANS}). */
const HERD_CRAFT_PLANS: Readonly<Record<HerdKept, Readonly<Record<string, CraftPlan>>>> = {
  both: {},
  none: {},
  cattle: { work_animal_farm: { seats: [['cattle']] } },
  sheep: {
    work_animal_farm: { seats: [['sheep']] },
    work_sewery_00: TUNIC_SEWERY,
    work_sewery_01: TUNIC_SEWERY,
  },
};

/** {@link HERD_CRAFT_PLANS} for a seat dressing its army in tunics. */
const TUNIC_HERD_CRAFT_PLANS: Readonly<Record<HerdKept, Readonly<Record<string, CraftPlan>>>> = {
  ...HERD_CRAFT_PLANS,
  cattle: {
    ...HERD_CRAFT_PLANS.cattle,
    work_sewery_00: LEATHER_SEWERY,
    work_sewery_01: LEATHER_SEWERY,
  },
};

/** The sides whose rows lie over a seat's difficulty plans, and those rows. */
const SIDE_CRAFT_PLANS: readonly (readonly [EconomicSide, Readonly<Record<string, CraftPlan>>])[] = [
  ['naturalArms', NATURAL_ARMS_CRAFT_PLANS],
  ['ironWeapons', IRON_WEAPONS_CRAFT_PLANS],
];

/** `profile`'s plans with a side's and a herd's rows over them, per profile plan table and
 *  `side|herd` key. */
const sidePlans = new WeakMap<
  Readonly<Record<string, CraftPlan>>,
  Map<string, Readonly<Record<string, CraftPlan>>>
>();

/** The craft plans `player`'s seat works: its difficulty's, with its sides' rows and then the rows of the
 *  livestock it keeps ({@link seatHerdKept}) over them. */
export function seatCraftPlans(
  world: World,
  ctx: SystemContext,
  player: number,
  profile: ComputerProfile,
): Readonly<Record<string, CraftPlan>> {
  const held = SIDE_CRAFT_PLANS.find(([side]) => seatHasSide(world, player, side));
  const herd = seatHerdKept(world, ctx, player);
  if (held === undefined && (herd === 'both' || herd === 'none')) return profile.craftPlans;
  const key = `${held?.[0] ?? ''}|${herd}`;
  let byKey = sidePlans.get(profile.craftPlans);
  if (byKey === undefined) {
    byKey = new Map();
    sidePlans.set(profile.craftPlans, byKey);
  }
  let plans = byKey.get(key);
  if (plans === undefined) {
    const herdRows = (held === undefined ? HERD_CRAFT_PLANS : TUNIC_HERD_CRAFT_PLANS)[herd];
    plans = { ...profile.craftPlans, ...held?.[1], ...herdRows };
    byKey.set(key, plans);
  }
  return plans;
}

/** The run a workshop opens with once built, by stable content ids (authored): its whole crew works only
 *  `good` until that building has finished `cycles` of it, then the seat lists apply. Tiles and marble come
 *  only from these tiers and the next bills wait on both. */
export const CRAFT_OPENING_RUN_BY_BUILDING_ID: Readonly<
  Record<string, { readonly good: string; readonly cycles: number }>
> = {
  work_pottery_01: { good: 'tile', cycles: 5 },
  work_mason_hut_01: { good: 'ornament', cycles: 5 },
};

interface RestrictedCrew {
  readonly type: BuildingType;
  readonly plan: CraftPlan;
  readonly crew: Entity[];
  /** Each crew member's workplace, index for index. */
  readonly workplaces: Entity[];
}

/**
 * Keep every operator of a restricted workplace on its plan's product list for his seat: the type's plan in
 * `profile`, or for a type whose buildings take roles, the plan of his building's role. An operator of an
 * unplanned workplace is released to every product.
 * `ProductionCounters` is per worker, not per building, and any employment change resets it (`bindEmployment`),
 * so the check runs every decision and issues a command only when the live counters differ from "these
 * products unlimited, every other one stopped". An empty result issues nothing, because
 * `setProductionGoods []` would mean "every product", the opposite of a restriction.
 *
 * Over the lists, the plan's sink takes the whole crew while the type's products with supply lines lie at
 * glut ({@link sinkHolds}), and otherwise a short product takes one or two seats whose own goods are
 * plentiful ({@link shortFirst}). A crew member on an opening run keeps it. An apprentice
 * (`technology/apprentices.ts`) on a fixed seat works past its glut and its earned `until` rest, since a
 * resting man earns no repeats toward his discovery; one on a stock plan takes its surplus goods like the
 * rest of the crew. No good takes an input the landing fleet's missing ships hold back
 * ({@link fleetReserve}).
 */
export function tuneCraftCounters(
  world: World,
  ctx: SystemContext,
  player: number,
  supply: SeatSupply,
  profile: ComputerProfile,
  apprentices: ReadonlySet<Entity> = NO_APPRENTICES,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const index = contentIndex(ctx.content);
  const plans = seatCraftPlans(world, ctx, player, profile);
  const roleOf = joineryRoles(world, ctx, player, () => rivalOverSea(world, ctx, player));
  const rolePlans = seatHasSide(world, player, 'noRoom') ? NO_CATAPULT_ROLE_PLANS : profile.joineryRolePlans;
  const fleets = new Map<string, number>();
  const fleetOf = (good: number, freeOnly: boolean): number => {
    const key = `${good}:${freeOnly}`;
    let owned = fleets.get(key);
    if (owned === undefined) {
      owned = seatFleet(world, ctx, player, good, freeOnly);
      fleets.set(key, owned);
    }
    return owned;
  };
  // Restricted plan and type -> its operators across the seat, gathered first because a seat's share
  // depends on how many men the plan employs. A plan shared by tiers splits per tier, since a command
  // naming a good the tier does not make is ignored. Insertion follows the canonical settler walk, so the
  // seats and the emitted command order are both deterministic.
  const crews = new Map<CraftPlan, Map<number, RestrictedCrew>>();
  for (const e of ownedSettlers(world, player)) {
    const assignment = world.tryGet(e, JobAssignment);
    if (assignment === undefined) continue;
    const job = world.get(e, Settler).jobType;
    if (job === null || isCarrierJob(ctx, job) || index.harvestJobs.has(job)) continue;
    const building = world.tryGet(assignment.workplace, Building);
    const type = building === undefined ? undefined : index.buildings.get(building.buildingType);
    if (type === undefined) continue;
    const roles = rolePlans[type.id];
    const plan = roles === undefined ? plans[type.id] : roles[roleOf(assignment.workplace)];
    if (plan === undefined) {
      // An unplanned workshop's crew works every product, while a fresh hire starts on the first alone.
      if ((world.tryGet(e, ProductionCounters)?.counters.length ?? 0) > 0)
        commands.push({ kind: 'setProductionGoods', entity: e, goods: [] });
      continue;
    }
    let byType = crews.get(plan);
    if (byType === undefined) {
      byType = new Map();
      crews.set(plan, byType);
    }
    const seated = byType.get(type.typeId);
    if (seated !== undefined) {
      seated.crew.push(e);
      seated.workplaces.push(assignment.workplace);
    } else byType.set(type.typeId, { type, plan, crew: [e], workplaces: [assignment.workplace] });
  }
  let landing: number | undefined;
  const landingShips = (): number => {
    if (landing === undefined) {
      const fleet = landingFleetShips(world, player, profile);
      landing = rivalOverSea(world, ctx, player)
        ? Math.max(fleet, landingFewestShips(fleet) + SEA_SCOUT_SHIPS)
        : fleet;
    }
    return landing;
  };
  const tribe = playerPlacementTribes(world, player)?.[0];
  const ownedTypes = new Map<string, boolean>();
  const owns = (buildingId: string, siteOnly: boolean): boolean => {
    const key = `${buildingId}:${siteOnly}`;
    let owned = ownedTypes.get(key);
    if (owned === undefined) {
      owned = ownsBuildingOf(world, ctx, player, buildingId, siteOnly);
      ownedTypes.set(key, owned);
    }
    return owned;
  };
  const earnedIds = new Map<string, boolean>();
  const earned = (id: string): boolean => {
    let known = earnedIds.get(id);
    if (known === undefined) {
      const good = goodTypeByContentId(ctx.content, id)?.typeId;
      known =
        good !== undefined &&
        (tribe === undefined ||
          !professionProgressionEnabled(world) ||
          goodEnabled(world, ctx, player, tribe, good));
      earnedIds.set(id, known);
    }
    return known;
  };
  const reads = stockReads(world, ctx, player, supply, earned);
  const reserve = fleetReserve(world, ctx, player, roleOf, landingShips);
  for (const { type, plan, crew, workplaces } of [...crews.values()].flatMap((byType) => [
    ...byType.values(),
  ])) {
    const products = enabledProducts(world, ctx, player, tribe, type);
    const recipeProducts = recipeProductsOf(ctx, type);
    const choice: SeatChoice = { ctx, supply, fleetOf, landingShips, owns, earned, products };
    const counters = crew.map((e) => world.tryGet(e, ProductionCounters));
    const current = counters.map((selection) => selectedGoods(selection, recipeProducts));
    const fed = (good: number, selected: boolean): boolean =>
      inputsInStock(ctx, supply, reserve, type, good, selected);
    const stock = 'wants' in plan ? stockSeats(plan, reads, products, current) : null;
    const seatPlan = 'wants' in plan ? null : plan;
    const seats = stock?.seats ?? seatPlan?.seats ?? [];
    /** A crew member's goods, or null while he rests. */
    const listed: (readonly number[] | null)[] = [];
    const free: number[] = []; // the crew members off any opening run, at work
    let surplusTurn = 0; // the surplus wants rotate over the operators past every want
    for (let seat = 0; seat < workplaces.length; seat++) {
      const workplace = workplaces[seat] as Entity;
      const opening = openingRun(world, ctx, workplace, type);
      if (opening !== null) {
        countCycles(world, workplace);
        listed.push(goodsOf(ctx, products, [opening]));
        continue;
      }
      const held = current[seat] ?? [];
      // A seat whose goods the seat may not make yet hands over to the next seat in the plan that has some,
      // and one whose goods all lack their inputs to the next with a good that has them; a stock plan's
      // operator hands over to its wants by rank and then its overflow.
      const others = stock?.fallbacks ?? seats.map((_, step) => seats[(seat + step + 1) % seats.length]);
      const workOf = (option: CraftSeat | undefined): number[] | null => {
        const work = seatProducts(choice, held, option ?? []);
        return work === REST ? null : goodsOf(ctx, products, work);
      };
      // A list keeps a good of its own that lacks its inputs while another has them: the worker's rotation
      // passes over an unsourced recipe by itself.
      const anyFed = (goods: readonly number[]): boolean =>
        goods.some((good) => fed(good, held.includes(good)));
      let own = workOf(seats[seat % Math.max(1, seats.length)]);
      if (own === null && seatPlan !== null && apprentices.has(crew[seat] as Entity)) {
        const work = seatProducts({ ...choice, pastGlut: true }, held, seats[seat % seats.length] ?? []);
        own = work === REST ? null : goodsOf(ctx, products, work);
      }
      if (own === null && stock !== null) {
        // A stock plan's operator past every want makes a surplus good with its inputs in stock, in turn,
        // and only from inputs the sites can spare.
        const spare = (good: number): boolean =>
          inputsSpare(ctx, supply, type, good, held.includes(good)) && fed(good, held.includes(good));
        const sourced = stock.surplus
          .map((ids) => goodsOf(ctx, products, ids).filter(spare))
          .filter((goods) => goods.length > 0);
        own = sourced[surplusTurn++ % Math.max(1, sourced.length)] ?? null;
      }
      if (own === null) {
        listed.push(null);
        continue;
      }
      free.push(seat);
      const alone =
        crew.length === 1 && seatPlan?.alone !== undefined ? goodsOf(ctx, products, seatPlan.alone) : [];
      let goods = alone.length > 0 ? alone : own;
      for (let step = 0; goods.length === 0 && step < others.length; step++)
        goods = workOf(others[step]) ?? [];
      let stocked = anyFed(goods) ? goods : [];
      for (let step = 0; stocked.length === 0 && step < others.length; step++) {
        const next = workOf(others[step]) ?? [];
        if (anyFed(next)) stocked = next;
      }
      const unfed = goodsOf(ctx, products, seatPlan?.unfed ?? []);
      if (stocked.length === 0 && anyFed(unfed)) stocked = unfed;
      listed.push(stocked.length > 0 ? stocked : goods);
    }
    const sinkGoods = goodsOf(ctx, products, seatPlan?.sink ?? []);
    // The whole crew, since a seat of its own may work the sink's goods, as the crockery seat does.
    const sinking = free.length > 0 && free.every((seat) => sameGoods(current[seat] ?? [], sinkGoods));
    // A sink none of whose goods has its inputs takes nobody.
    const sink = sinkGoods.some((good) => fed(good, sinking)) ? sinkGoods : [];
    if (sink.length > 0 && sinkHolds(supply, products, sinking)) for (const seat of free) listed[seat] = sink;
    else shortFirst(supply, gamePhase(ctx.tick), products, free, listed, current, fed);
    if (reserve.size > 0) {
      for (const seat of free) {
        const kept = listed[seat]?.filter((good) => !heldBack(ctx, supply, reserve, type, good)) ?? null;
        listed[seat] = kept === null || kept.length === 0 ? null : kept;
      }
    }
    for (let seat = 0; seat < crew.length; seat++) {
      const entity = crew[seat] as Entity;
      const goods = listed[seat];
      if (goods === null) {
        const [first] = recipeProducts;
        if (first === undefined || resting(counters[seat], recipeProducts)) continue;
        // Only this good, then not even it: every product stopped.
        commands.push({ kind: 'setProductionGoods', entity, goods: [first] });
        commands.push({ kind: 'setProductionCount', entity, goodType: first, count: 0 });
        continue;
      }
      if (goods === undefined || goods.length === 0 || sameGoods(current[seat] ?? [], goods)) continue;
      commands.push({ kind: 'setProductionGoods', entity, goods });
    }
  }
  return commands;
}

/**
 * Whether the seat's stock (stores, shelves, hands, heaps in reach) holds the inputs of one cycle of
 * `good` at `type`: each input's recipe amount, or while the worker already has the good `selected`, a
 * unit of each, so a cycle half fed keeps its man through the band. True for a good without a recipe or
 * inputs, as a vehicle built on its yard.
 */
function inputsInStock(
  ctx: SystemContext,
  supply: SeatSupply,
  reserve: ReadonlyMap<number, number>,
  type: BuildingType,
  good: number,
  selected: boolean,
): boolean {
  const recipe = contentIndex(ctx.content).recipeByProductByBuilding.get(type.typeId)?.get(good);
  if (recipe === undefined) return true;
  return recipe.inputs.every(
    (input) =>
      supply.units(input.goodType) - (reserve.get(input.goodType) ?? 0) >= (selected ? 1 : input.amount),
  );
}

/** Whether a cycle of `good` at `type` would take an input below what the {@link fleetReserve} holds
 *  back. */
function heldBack(
  ctx: SystemContext,
  supply: SeatSupply,
  reserve: ReadonlyMap<number, number>,
  type: BuildingType,
  good: number,
): boolean {
  const recipe = contentIndex(ctx.content).recipeByProductByBuilding.get(type.typeId)?.get(good);
  return (
    recipe?.inputs.some((input) => {
      const held = reserve.get(input.goodType) ?? 0;
      return held > 0 && supply.units(input.goodType) - held < input.amount;
    }) === true
  );
}

/**
 * The units of each good the seat's crafts leave in stock for the ships its landing fleet still lacks,
 * while its ship joinery stands: the missing ships' share of every line of the smallest ship's bill that
 * no collector gathers (the wood and the like come through the supply lines and their gatherers).
 * Authored: on arabskie_wyspy_wolna_gra_mieszana (seed 7) a seat's tailors sewed the leather it started
 * with into shoes, and its ship yard then waited 40 minutes on the leather of its bill.
 */
function fleetReserve(
  world: World,
  ctx: SystemContext,
  player: number,
  roleOf: (joinery: Entity) => JoineryRole,
  landingShips: () => number,
): ReadonlyMap<number, number> {
  const index = contentIndex(ctx.content);
  const house = smallestShipHouse(index);
  const joinery = index.buildingTypeBySlug.get(ROLE_JOINERY_ID);
  const vehicleType = house === null ? undefined : index.buildings.get(house)?.vehicleType;
  if (house === null || joinery === undefined || vehicleType === undefined) return NO_RESERVE;
  const shipYard = ownedBuildings(world, player).some(
    (e) => world.get(e, Building).buildingType === joinery && isBuilt(world, e) && roleOf(e) === 'ship',
  );
  if (!shipYard) return NO_RESERVE;
  let standing = 0;
  for (const e of vehicleIndex(world).ownedBy(player))
    if (world.get(e, Vehicle).vehicleType === vehicleType) standing++;
  const missing = landingShips() - standing;
  if (missing <= 0) return NO_RESERVE;
  const collected = new Set(COLLECTED_GOOD_IDS.flatMap((id) => index.goodTypeBySlug.get(id) ?? []));
  const reserve = new Map<number, number>();
  for (const line of index.constructionBillByBuilding.get(house) ?? [])
    if (!collected.has(line.goodType)) reserve.set(line.goodType, missing * line.amount);
  return reserve;
}

const NO_RESERVE: ReadonlyMap<number, number> = new Map();
const NO_APPRENTICES: ReadonlySet<Entity> = new Set();

/**
 * Whether every input of `good` at `type` with supply lines lies at or above its comfort line, or while the
 * worker already makes the good (`selected`) above its short line: a surplus product never eats the wood
 * or stone the sites and homes still want. True for an input without supply lines.
 */
function inputsSpare(
  ctx: SystemContext,
  supply: SeatSupply,
  type: BuildingType,
  good: number,
  selected: boolean,
): boolean {
  const recipe = contentIndex(ctx.content).recipeByProductByBuilding.get(type.typeId)?.get(good);
  return recipe === undefined || recipe.inputs.every((input) => !supply.isShort(input.goodType, !selected));
}

/** The goods named by content `ids` that the type makes (`products`), each once, ascending. */
function goodsOf(ctx: SystemContext, products: readonly number[], ids: readonly string[]): number[] {
  const goods: number[] = [];
  for (const id of ids) {
    const good = goodTypeByContentId(ctx.content, id)?.typeId;
    if (good !== undefined && products.includes(good) && !goods.includes(good)) goods.push(good);
  }
  return goods.sort((a, b) => a - b);
}

/** The {@link productsOf} `player` may make: under the experience gates, the goods its `tribe` has
 *  discovered ({@link goodEnabled}), so a smith is never held to a weapon his seat has still to earn. */
function enabledProducts(
  world: World,
  ctx: SystemContext,
  player: number,
  tribe: number | undefined,
  type: BuildingType,
): readonly number[] {
  const products = productsOf(ctx, type);
  if (tribe === undefined || !professionProgressionEnabled(world)) return products;
  return products.filter((good) => goodEnabled(world, ctx, player, tribe, good));
}

/** The goods a workplace type's recipes make, ascending: the products a selection counter can name. */
function recipeProductsOf(ctx: SystemContext, type: BuildingType): readonly number[] {
  let byType = recipeProductsByContent.get(ctx.content);
  if (byType === undefined) {
    byType = new Map();
    recipeProductsByContent.set(ctx.content, byType);
  }
  let products = byType.get(type.typeId);
  if (products === undefined) {
    const recipes = contentIndex(ctx.content).recipeByProductByBuilding.get(type.typeId);
    products = [...(recipes?.keys() ?? [])].sort((a, b) => a - b);
    byType.set(type.typeId, products);
  }
  return products;
}

/** {@link recipeProductsOf} per content and building type id: content-static, shared, never edited. */
const recipeProductsByContent = new WeakMap<ContentSet, Map<number, readonly number[]>>();

/** The goods a workplace type makes, ascending: its recipes' outputs and the field-farmed goods it
 *  produces without a recipe, as the farm's grain. */
export function productsOf(ctx: SystemContext, type: BuildingType): readonly number[] {
  let byType = productsByContent.get(ctx.content);
  if (byType === undefined) {
    byType = new Map();
    productsByContent.set(ctx.content, byType);
  }
  let products = byType.get(type.typeId);
  if (products === undefined) {
    const crafted = contentIndex(ctx.content).mergedRecipeByBuilding.get(type.typeId)?.outputs ?? [];
    products = [...new Set([...crafted.map((o) => o.goodType), ...type.produces])].sort((a, b) => a - b);
    byType.set(type.typeId, products);
  }
  return products;
}

/** {@link productsOf} per content and building type id: content-static, shared, never edited. */
const productsByContent = new WeakMap<ContentSet, Map<number, readonly number[]>>();

/** Whether the type's products with supply lines all lie at their glut lines, or while the whole crew
 *  already works the sink (`sinking`), all at or above their comfort lines. False for a type with none. */
function sinkHolds(supply: SeatSupply, products: readonly number[], sinking: boolean): boolean {
  const managed = products.filter((good) => supply.lines(good) !== undefined);
  return (
    managed.length > 0 &&
    managed.every((good) => (sinking ? !supply.isShort(good, true) : supply.atGlut(good)))
  );
}

/** The line under which a short product takes seats, and the line it holds them to, per game phase
 *  (authored): the opening hires under the short line and holds to comfort, and from the mid game on it
 *  hires under comfort and holds to the glut, like the product-gated crews (`staffing-plan.ts`). */
const SHORT_PRODUCT_LINES: Readonly<
  Record<GamePhase, { readonly hire: SupplyLine; readonly hold: SupplyLine }>
> = {
  opening: { hire: 'short', hold: 'comfort' },
  mid: { hire: 'comfort', hold: 'glut' },
  late: { hire: 'comfort', hold: 'glut' },
};

/**
 * Put each short product, ascending, on seats of its own: one per supply unit it lacks to its hold line
 * ({@link SHORT_PRODUCT_LINES}), at most {@link SHORT_PRODUCT_SEATS}, taken from the free seats whose listed
 * goods all lie at or above their comfort lines, those already working the product alone first, then the
 * last. A seat the plan itself lists on the product alone is neither counted nor taken: the seats here come
 * on top of it. While a seat works it the product holds to the hold line, otherwise it reads the hire line.
 * Selection changes cost nothing, so the two lines are the whole hysteresis. A product whose inputs are
 * out (`fed`) takes no seat.
 */
function shortFirst(
  supply: SeatSupply,
  phase: GamePhase,
  products: readonly number[],
  free: readonly number[],
  listed: (readonly number[] | null)[],
  current: readonly (readonly number[])[],
  fed: (good: number, selected: boolean) => boolean,
): void {
  const { hire, hold } = SHORT_PRODUCT_LINES[phase];
  const plentiful = free.filter((seat) => (listed[seat] ?? []).every((good) => !supply.isShort(good, true)));
  for (const good of products) {
    if (plentiful.length === 0) return;
    const lines = supply.lines(good);
    const surplus = supply.surplus(good);
    if (lines === undefined || surplus === undefined) continue;
    const extra = plentiful.filter((seat) => !onlyGood(listed[seat], good));
    const holders = extra.filter((seat) => onlyGood(current[seat], good));
    if (!supply.isUnder(good, holders.length > 0 ? hold : hire) || !fed(good, holders.length > 0)) continue;
    const seats = Math.min(Math.ceil((lines[hold] - surplus) / lines.unit), SHORT_PRODUCT_SEATS);
    const others = extra.filter((seat) => !holders.includes(seat)).reverse();
    for (const seat of [...holders, ...others].slice(0, seats)) {
      plentiful.splice(plentiful.indexOf(seat), 1);
      listed[seat] = [good];
    }
  }
}

/**
 * Whether a good one of the type's craft seats caps at an authored glut lies under it: under the glut while
 * `engaged`, else under it by the seat's band ({@link CRAFT_GLUT_BAND_UNITS} by default), at which a seat
 * takes the good back.
 * False for a type with no such seat.
 */
export function craftGlutPending(
  ctx: SystemContext,
  supply: SeatSupply,
  plans: Readonly<Record<string, CraftPlan>>,
  type: BuildingType,
  engaged: boolean,
): boolean {
  const plan = plans[type.id];
  if (plan === undefined || 'wants' in plan) return false;
  return plan.seats.some(
    (seat) =>
      'goods' in seat &&
      Object.entries(seat.glut).some(([id, glut]) => {
        const good = goodTypeByContentId(ctx.content, id);
        return (
          good !== undefined &&
          supply.units(good.typeId) < (engaged ? glut : glut - (seat.band ?? CRAFT_GLUT_BAND_UNITS))
        );
      }),
  );
}

function sameGoods(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((g, i) => g === b[i]);
}

/** Whether `goods` lists `good` alone. */
function onlyGood(goods: readonly number[] | null | undefined, good: number): boolean {
  return goods !== undefined && goods !== null && goods.length === 1 && goods[0] === good;
}

/**
 * The list `setProductionGoods` leaves on `selection`: its unlimited products when every other one of
 * `recipeProducts` (ascending) is stopped. Empty for no selection or for a finite counter the player set,
 * so the tuner reissues its list.
 */
function selectedGoods(
  selection: ProductionCountersView | undefined,
  recipeProducts: readonly number[],
): readonly number[] {
  if (selection === undefined) return [];
  const goods: number[] = [];
  for (const good of recipeProducts) {
    const count = productionCountOf(selection, good);
    if (count === PRODUCTION_UNLIMITED) goods.push(good);
    else if (count !== 0) return [];
  }
  return goods;
}

/** What one workplace type's seats read this decision. */
interface SeatChoice {
  readonly ctx: SystemContext;
  readonly supply: SeatSupply;
  readonly fleetOf: (good: number, freeOnly: boolean) => number;
  /** The ships the seat's joinery builds: its {@link landingFleetShips}, with room for {@link SEA_SCOUT_SHIPS}. */
  readonly landingShips: () => number;
  /** Whether the seat owns a building of the type with this stable content id, standing or a site, or
   *  with `siteOnly` a site still under construction. */
  readonly owns: (buildingId: string, siteOnly: boolean) => boolean;
  /** Whether the seat may make the good with this stable content id ({@link goodEnabled}). */
  readonly earned: (id: string) => boolean;
  /** The goods the type makes that the seat may make ({@link enabledProducts}). */
  readonly products: readonly number[];
  /** Read a glutted goods list as still wanted rather than handing over to its `otherwise`, and an `until`
   *  seat that would rest once its good is earned as still working its `works`. */
  readonly pastGlut?: true;
}

/** What a {@link CraftSeat} resolves to when its operator rests. */
const REST = 'rest';

/**
 * What a {@link CraftSeat} works right now, or {@link REST}. A capped good the worker has on his `current`
 * selection is dropped at its glut; one he does not have comes back only under the glut by the band, so the
 * two lines a stock crosses are the hysteresis and no state beyond the live selection is kept.
 */
function seatProducts(
  choice: SeatChoice,
  current: readonly number[],
  seat: CraftSeat,
): readonly string[] | typeof REST {
  const { ctx, supply, fleetOf } = choice;
  if ('rest' in seat) return REST;
  if ('fleet' in seat) {
    // A vehicle the seat has yet to earn: the crew works `otherwise`, which earns it.
    const good = goodTypeByContentId(ctx.content, seat.fleet);
    if (good === undefined || !choice.products.includes(good.typeId))
      return seatProducts(choice, current, seat.otherwise);
    const limit =
      seat.cap === LANDING_FLEET
        ? choice.landingShips()
        : current.includes(good.typeId)
          ? seat.cap
          : seat.resume + 1;
    return fleetOf(good.typeId, seat.freeOnly === true) < limit
      ? [seat.fleet, ...(seat.beside ?? [])]
      : seatProducts(choice, current, seat.otherwise);
  }
  if ('until' in seat) {
    if (!choice.earned(seat.until)) return seatProducts(choice, current, seat.works);
    const goods = seatProducts(choice, current, seat.otherwise);
    return goods === REST && choice.pastGlut === true ? seatProducts(choice, current, seat.works) : goods;
  }
  if ('whileOwned' in seat) {
    const owned = choice.owns(seat.whileOwned, seat.siteOnly === true);
    return seatProducts(choice, current, owned ? seat.works : seat.otherwise);
  }
  if ('firstEnabled' in seat) {
    for (const option of seat.firstEnabled) {
      const goods = seatProducts(choice, current, option);
      if (goods === REST || goodsOf(ctx, choice.products, goods).length > 0) return goods;
    }
    return [];
  }
  if ('firstFed' in seat) {
    const fed = seat.firstFed.find((line) => {
      const input = goodTypeByContentId(ctx.content, line.input);
      return input !== undefined && supply.units(input.typeId) > 0;
    });
    return fed === undefined ? seat.firstFed.map((line) => line.good) : [fed.good];
  }
  if (!('goods' in seat)) return seat;
  const kept = seat.goods.filter((id) => {
    const glut = seat.glut[id];
    const good = glut === undefined ? undefined : goodTypeByContentId(ctx.content, id);
    if (glut === undefined || good === undefined) return true;
    const dropAt = current.includes(good.typeId) ? glut : glut - (seat.band ?? CRAFT_GLUT_BAND_UNITS);
    return !supply.exceeds(good.typeId, dropAt - 1);
  });
  if (kept.length > 0 || choice.pastGlut === true) return kept.length > 0 ? kept : seat.goods;
  return seat.otherwise === undefined ? seat.goods : seatProducts(choice, current, seat.otherwise);
}

/** Whether `selection` stops every one of `recipeProducts`: a worker the tuner rested. */
function resting(selection: ProductionCountersView | undefined, recipeProducts: readonly number[]): boolean {
  return selection !== undefined && recipeProducts.every((good) => productionCountOf(selection, good) === 0);
}

/** The seat's {@link StockReads} this decision, each read made once on first use. */
function stockReads(
  world: World,
  ctx: SystemContext,
  player: number,
  supply: SeatSupply,
  earned: (id: string) => boolean,
): StockReads {
  let counters: AssistantCounterValues | null | undefined;
  return {
    typeOf: (id) => goodTypeByContentId(ctx.content, id)?.typeId,
    units: (good) => supply.units(good),
    consumers: (good) => supply.plannedConsumers(good),
    earned,
    readying: () => !militaryWaits(world, ctx, player, BARRACKS_LEAD_TICKS),
    recruits(need) {
      if (counters === undefined) {
        const carrier = assistantCountersEntity(world, player);
        counters = carrier === null ? null : world.get(carrier, AssistantCounters).counters;
      }
      let recruits = 0;
      for (const kind of needCounters(need)) recruits += counters?.[kind].value ?? 0;
      return recruits;
    },
  };
}

/** Whether `player` owns a building of the type with stable content id `buildingId`, standing or a site,
 *  or with `siteOnly` a site still under construction. */
function ownsBuildingOf(
  world: World,
  ctx: SystemContext,
  player: number,
  buildingId: string,
  siteOnly: boolean,
): boolean {
  const type = contentIndex(ctx.content).buildingTypeBySlug.get(buildingId);
  if (type === undefined) return false;
  for (const e of ownedBuildings(world, player))
    if (world.get(e, Building).buildingType === type && (!siteOnly || world.has(e, UnderConstruction)))
      return true;
  return false;
}

/** How many of the vehicle made as `good` the seat owns: standing on the map or carried, or with
 *  `freeOnly` standing free. A yard still under construction does not count, so its crew finishes it
 *  while the fleet stands under its cap rather than leaving it half built at the cap; the crew reuses an
 *  unfinished yard before it opens another (`vehicle-yard.ts`). The cost is the seat's vehicles. */
function seatFleet(
  world: World,
  ctx: SystemContext,
  player: number,
  good: number,
  freeOnly: boolean,
): number {
  const house = vehicleHouseOfGood(ctx.content, good);
  const vehicleType =
    house === undefined ? undefined : contentIndex(ctx.content).buildings.get(house)?.vehicleType;
  if (house === undefined || vehicleType === undefined) return 0;
  let owned = 0;
  for (const e of vehicleIndex(world).ownedBy(player)) {
    if (world.get(e, Vehicle).vehicleType === vehicleType && (!freeOnly || standsFree(world, e))) owned++;
  }
  return owned;
}

/** Whether `workplace`'s opening run is still unfinished; false for a type without one. */
export function openingRunPending(
  world: World,
  ctx: SystemContext,
  workplace: Entity,
  type: BuildingType,
): boolean {
  const run = CRAFT_OPENING_RUN_BY_BUILDING_ID[type.id];
  const good = run === undefined ? undefined : goodTypeByContentId(ctx.content, run.good);
  if (run === undefined || good === undefined) return false;
  return (world.tryGet(workplace, CompletedCycles)?.byGood.get(good.typeId) ?? 0) < run.cycles;
}

/** The good built `workplace`'s opening run still wants, or null once the run is done or its type has
 *  none. */
function openingRun(world: World, ctx: SystemContext, workplace: Entity, type: BuildingType): string | null {
  if (world.has(workplace, UnderConstruction) || !openingRunPending(world, ctx, workplace, type)) return null;
  return CRAFT_OPENING_RUN_BY_BUILDING_ID[type.id]?.good ?? null;
}

/** Opt `workplace` into {@link CompletedCycles} so its opening run's count starts with the crew's first
 *  cycle. */
function countCycles(world: World, workplace: Entity): void {
  if (!world.has(workplace, CompletedCycles)) world.add(workplace, CompletedCycles, { byGood: new Map() });
}
