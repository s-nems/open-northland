import type { BuildingType } from '@open-northland/data';
import {
  Building,
  CompletedCycles,
  CraftSelection,
  JobAssignment,
  Settler,
  UnderConstruction,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isCarrierJob } from '../../stores/index.js';
import { goodTypeByContentId } from '../content-lookup.js';
import { type GamePhase, gamePhase } from '../game-phase.js';
import { ownedSettlers } from '../seat-roster.js';
import type { SeatSupply, SupplyLine } from './supply.js';

/**
 * One operator seat's products, by stable content ids. A plain list is worked as is. A `glut` seat drops
 * each of its `goods` while the seat holds at least that many units of it (the summary bar's figure:
 * stores, workshop shelves, hands and the heaps in reach), and takes it back once the stock has fallen
 * {@link CRAFT_GLUT_BAND_UNITS} under the glut; while every capped good is dropped it works `otherwise`,
 * or the whole list when there is none. A `firstFed` seat works the first of its lines whose `input` the
 * seat holds a unit of, and every line while it holds none of them. A good with supply lines
 * ({@link SeatSupply}) takes no authored glut: {@link CraftPlan.sink} covers it.
 */
export type CraftSeat =
  | readonly string[]
  | {
      readonly goods: readonly string[];
      readonly glut: Readonly<Record<string, number>>;
      readonly otherwise?: CraftSeat;
    }
  | { readonly firstFed: readonly { readonly good: string; readonly input: string }[] };

/** A workplace type's product plan, by stable content ids (authored). */
export interface CraftPlan {
  /** One seat per operator, counted across every building of the type the seat owns and handed out in
   *  canonical settler order, wrapping when more operators work the type than it lists. */
  readonly seats: readonly CraftSeat[];
  /** What the type's only operator works while it employs just one, instead of the first seat. */
  readonly alone?: readonly string[];
  /** What every operator works while each product of the type with supply lines ({@link SeatSupply}) lies
   *  at its glut line, until one falls under its comfort line. A type without a sink rests its crew
   *  instead (`staffing-plan.ts`). */
  readonly sink?: readonly string[];
}

/** How far under its glut a good's stock falls before a seat takes the good back (authored), so a stock
 *  hovering at the line does not flip the seat with every unit made or taken. */
export const CRAFT_GLUT_BAND_UNITS = 8;

/** The iron tools in stock at which the joiners turn to furniture (authored). Every worker wears one and
 *  no bill or shelf sizes them, so they take no supply lines and the glut is authored. */
const JOINERY_TOOL_GLUT_UNITS = 24;

/** A joiner's seat: iron tools until they reach {@link JOINERY_TOOL_GLUT_UNITS}, furniture meanwhile. */
const JOINERY_SEAT: CraftSeat = {
  goods: ['tool_iron'],
  glut: { tool_iron: JOINERY_TOOL_GLUT_UNITS },
  otherwise: ['furniture'],
};

/** The crockery in stock at which the pottery's crockery seat turns to bricks and tiles (authored). A
 *  stocked home eats it beside its food, so no bill or shelf sizes it. */
export const CROCKERY_GLUT_UNITS = 24;

/** The shoes in stock at which a tailor's shoe seat turns to leather armour (authored): every settler wears
 *  a pair out, and the defence amulet and the recruits take the armour. */
const SHOES_GLUT_UNITS = 24;

/** The leather armour in stock at which the second tailor turns to shoes (authored): the armour piles up
 *  unworn once plate armour has come in. */
const LEATHER_ARMOUR_GLUT_UNITS = 16;

/** A tailor's shoe seat: shoes until they reach {@link SHOES_GLUT_UNITS}, leather armour meanwhile. */
const SHOE_SEAT: CraftSeat = {
  goods: ['shoes'],
  glut: { shoes: SHOES_GLUT_UNITS },
  otherwise: ['armor_leather'],
};

/** The most plentiful seats a short product takes at once ({@link shortFirst}) (authored): enough to turn a
 *  pottery's crockery seat to a short building material and still leave its other lines a hand. */
const SHORT_PRODUCT_SEATS = 2;

/** The coins in stock at which a mint's top-up coiners turn to amulets (authored): the druids draw a
 *  couple per potion, so a score in store keeps them brewing, and every coin past it is gold the amulets
 *  could have had. Every seat but the first reads it; the first coiner never stops. */
export const COIN_GLUT_UNITS = 20;

/** An amulet seat: defence amulets while a leather armour is in store, strength amulets while a short sword
 *  is, both lines while neither, so the seat never idles on a line the tailors or the smiths have not fed. */
const AMULET_SEAT: CraftSeat = {
  firstFed: [
    { good: 'amulet_defense', input: 'armor_leather' },
    { good: 'amulet_strength', input: 'sword_shord' },
  ],
};

/** A top-up coiner: coins while they lie under {@link COIN_GLUT_UNITS}, amulets meanwhile. */
const COIN_TOP_UP_SEAT: CraftSeat = {
  goods: ['coin'],
  glut: { coin: COIN_GLUT_UNITS },
  otherwise: AMULET_SEAT,
};

/** The mint's six seats over three mints: one coiner always, two more only while the coins run under the
 *  glut, and the rest on amulets. */
const MINT_SEATS: readonly CraftSeat[] = [
  ['coin'],
  COIN_TOP_UP_SEAT,
  COIN_TOP_UP_SEAT,
  AMULET_SEAT,
  AMULET_SEAT,
  AMULET_SEAT,
];

/** How many druids a seat's six huts employ; one boils the temple's oil, the rest brew the big potion. */
const DRUID_SEATS = 12;

/**
 * The product plans per workplace type (authored). The lists interleave so a partly staffed type already
 * runs its main lines. Whatever the lists say, a product the build order runs short of comes first
 * ({@link tuneCraftSelections}); over the lists, a type's sink takes the whole crew while its stocked
 * products lie at glut ({@link sinkHolds}). The reason for each row stands beside it.
 */
export const CRAFT_PLANS_BY_BUILDING_ID: Readonly<Record<string, CraftPlan>> = {
  // Every joiner makes iron tools and turns to furniture only while the tools pile up.
  work_joinery_01: { seats: [JOINERY_SEAT, JOINERY_SEAT] },
  work_joinery_02: { seats: [JOINERY_SEAT, JOINERY_SEAT, JOINERY_SEAT] },
  work_joinery_03: { seats: [JOINERY_SEAT, JOINERY_SEAT, JOINERY_SEAT] },
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
  work_animal_farm: { seats: [['cattle']] },
  // The small tailor's one man sews shoes, and leather armour meanwhile; the first tailor sews shoes and
  // the second leather armour, each turning to the other's good while his own piles up, as the armour
  // does once plate armour has come in.
  work_sewery_00: { seats: [SHOE_SEAT] },
  work_sewery_01: {
    seats: [
      SHOE_SEAT,
      {
        goods: ['armor_leather'],
        glut: { armor_leather: LEATHER_ARMOUR_GLUT_UNITS },
        otherwise: ['shoes'],
      },
    ],
  },
  work_bakery_01: { seats: [['bread']] },
  // The smithies open on plate armour and long swords, then add the iron spear, whose wooden shaft the
  // first armourer makes between his long bows, and mail. Five smithies' ten smiths forge three plate,
  // two mail, two long swords, two iron spears and one short sword, the weapon only the strength amulet
  // takes; the late game's two more smithies add a short sword, an iron spear, a plate and a mail.
  work_smithy_01: {
    seats: [
      ['armor_plate'],
      ['sword_long'],
      ['spear_iron'],
      ['armor_chain'],
      ['armor_plate'],
      ['sword_long'],
      ['spear_iron'],
      ['armor_chain'],
      ['armor_plate'],
      ['sword_shord'],
      ['sword_shord'],
      ['spear_iron'],
      ['armor_plate'],
      ['armor_chain'],
    ],
  },
  // The first armourer works long bows and wooden spears, dropping whichever has piled up so the other,
  // the spear the smithy's iron spear needs or the bow, gets his whole time; the rest make long bows.
  work_armory_01: {
    seats: [
      { goods: ['bow_long', 'spear_wooden'], glut: { bow_long: 20, spear_wooden: 20 } },
      ['bow_long'],
      ['bow_long'],
      ['bow_long'],
    ],
  },
  // One druid in twelve boils holy oil for the temple and the rest brew the big potion.
  work_druid_01: {
    seats: [['holy_oil'], ...Array.from({ length: DRUID_SEATS - 1 }, (): CraftSeat => ['potion_heal_big'])],
  },
  // One coiner on coins for good, two more only while the coins run under the glut line, and the rest
  // on amulets: defence while leather armour is in store, strength while short swords are.
  work_coin_mint: { seats: MINT_SEATS },
};

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
 * Keep every operator of a restricted workplace type on the plan's product list for its seat. `CraftSelection`
 * is per worker, not per building, and any employment change clears it (`reidleAsJob`), so the check runs
 * every decision and issues a command only when the live selection differs. An empty result issues
 * nothing, because `setCraftGoods []` would mean "every product", the opposite of a restriction.
 *
 * Over the lists, the plan's sink takes the whole crew while the type's products with supply lines lie at
 * glut ({@link sinkHolds}), and otherwise a short product takes one or two seats whose own goods are
 * plentiful ({@link shortFirst}). A crew member on an opening run keeps it.
 */
export function tuneCraftSelections(
  world: World,
  ctx: SystemContext,
  player: number,
  supply: SeatSupply,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const index = contentIndex(ctx.content);
  // Restricted workplace type -> its operators across the seat, gathered first because a seat's share
  // depends on how many men the whole type employs. Insertion follows the canonical settler walk, so the
  // seats and the emitted command order are both deterministic.
  const crews = new Map<number, RestrictedCrew>();
  for (const e of ownedSettlers(world, player)) {
    const assignment = world.tryGet(e, JobAssignment);
    if (assignment === undefined) continue;
    const job = world.get(e, Settler).jobType;
    if (job === null || isCarrierJob(ctx, job) || index.harvestJobs.has(job)) continue;
    const building = world.tryGet(assignment.workplace, Building);
    if (building === undefined) continue;
    const seated = crews.get(building.buildingType);
    if (seated !== undefined) {
      seated.crew.push(e);
      seated.workplaces.push(assignment.workplace);
      continue;
    }
    const type = index.buildings.get(building.buildingType);
    if (type === undefined) continue;
    const plan = CRAFT_PLANS_BY_BUILDING_ID[type.id];
    if (plan === undefined) continue;
    crews.set(building.buildingType, { type, plan, crew: [e], workplaces: [assignment.workplace] });
  }
  for (const { type, plan, crew, workplaces } of crews.values()) {
    const products = productsOf(ctx, type);
    const produced = new Set(products);
    const toGoods = (ids: readonly string[]): readonly number[] =>
      [
        ...new Set(
          ids
            .map((id) => goodTypeByContentId(ctx.content, id)?.typeId)
            .filter((g): g is number => g !== undefined && produced.has(g)),
        ),
      ].sort((a, b) => a - b);
    const { seats } = plan;
    const current = crew.map((e) => world.tryGet(e, CraftSelection)?.goods ?? []);
    const listed: (readonly number[])[] = [];
    const free: number[] = []; // the crew members off any opening run
    for (const [seat, workplace] of workplaces.entries()) {
      const opening = openingRun(world, ctx, workplace, type);
      if (opening !== null) {
        listed.push(toGoods([opening]));
        continue;
      }
      free.push(seat);
      listed.push(
        toGoods(
          crew.length === 1 && plan.alone !== undefined
            ? plan.alone
            : seatProducts(ctx, supply, current[seat] ?? [], seats[seat % seats.length] ?? []),
        ),
      );
    }
    const sink = toGoods(plan.sink ?? []);
    // The whole crew, since a seat of its own may work the sink's goods, as the crockery seat does.
    const sinking = free.length > 0 && free.every((seat) => sameGoods(current[seat] ?? [], sink));
    if (sink.length > 0 && sinkHolds(supply, products, sinking)) for (const seat of free) listed[seat] = sink;
    else shortFirst(supply, gamePhase(ctx.tick), products, free, listed, current);
    for (const [seat, e] of crew.entries()) {
      const goods = listed[seat] ?? [];
      if (goods.length === 0 || sameGoods(current[seat] ?? [], goods)) continue;
      commands.push({ kind: 'setCraftGoods', entity: e, goods });
    }
  }
  return commands;
}

/** The goods a workplace type makes, ascending: its recipes' outputs and the field-farmed goods it
 *  produces without a recipe, as the farm's grain. */
export function productsOf(ctx: SystemContext, type: BuildingType): readonly number[] {
  const crafted = contentIndex(ctx.content).mergedRecipeByBuilding.get(type.typeId)?.outputs ?? [];
  return [...new Set([...crafted.map((o) => o.goodType), ...type.produces])].sort((a, b) => a - b);
}

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
 * Selection changes cost nothing, so the two lines are the whole hysteresis.
 */
function shortFirst(
  supply: SeatSupply,
  phase: GamePhase,
  products: readonly number[],
  free: readonly number[],
  listed: (readonly number[])[],
  current: readonly (readonly number[])[],
): void {
  const { hire, hold } = SHORT_PRODUCT_LINES[phase];
  const plentiful = free.filter((seat) => (listed[seat] ?? []).every((good) => !supply.isShort(good, true)));
  for (const good of products) {
    if (plentiful.length === 0) return;
    const lines = supply.lines(good);
    const surplus = supply.surplus(good);
    if (lines === undefined || surplus === undefined) continue;
    const extra = plentiful.filter((seat) => !sameGoods(listed[seat] ?? [], [good]));
    const holders = extra.filter((seat) => sameGoods(current[seat] ?? [], [good]));
    if (!supply.isUnder(good, holders.length > 0 ? hold : hire)) continue;
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
 * `engaged`, else under it by {@link CRAFT_GLUT_BAND_UNITS}, the band at which a seat takes the good back.
 * False for a type with no such seat.
 */
export function craftGlutPending(
  ctx: SystemContext,
  supply: SeatSupply,
  type: BuildingType,
  engaged: boolean,
): boolean {
  const plan = CRAFT_PLANS_BY_BUILDING_ID[type.id];
  if (plan === undefined) return false;
  return plan.seats.some(
    (seat) =>
      'goods' in seat &&
      Object.entries(seat.glut).some(([id, glut]) => {
        const good = goodTypeByContentId(ctx.content, id);
        return (
          good !== undefined && supply.units(good.typeId) < (engaged ? glut : glut - CRAFT_GLUT_BAND_UNITS)
        );
      }),
  );
}

function sameGoods(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((g, i) => g === b[i]);
}

/**
 * What a {@link CraftSeat} works right now. A capped good the worker has on his `current` selection is
 * dropped at its glut; one he does not have comes back only under the glut by the band, so the two lines
 * a stock crosses are the hysteresis and no state beyond the live selection is kept.
 */
function seatProducts(
  ctx: SystemContext,
  supply: SeatSupply,
  current: readonly number[],
  seat: CraftSeat,
): readonly string[] {
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
    const dropAt = current.includes(good.typeId) ? glut : glut - CRAFT_GLUT_BAND_UNITS;
    return !supply.exceeds(good.typeId, dropAt - 1);
  });
  if (kept.length > 0) return kept;
  return seat.otherwise === undefined ? seat.goods : seatProducts(ctx, supply, current, seat.otherwise);
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

/**
 * The good `workplace`'s opening run still wants, or null once the run is done or its type has none. The
 * first look opts the building into {@link CompletedCycles}, so its count starts with the crew's first
 * cycle.
 */
function openingRun(world: World, ctx: SystemContext, workplace: Entity, type: BuildingType): string | null {
  if (world.has(workplace, UnderConstruction) || !openingRunPending(world, ctx, workplace, type)) return null;
  if (!world.has(workplace, CompletedCycles)) world.add(workplace, CompletedCycles, { byGood: new Map() });
  return CRAFT_OPENING_RUN_BY_BUILDING_ID[type.id]?.good ?? null;
}
