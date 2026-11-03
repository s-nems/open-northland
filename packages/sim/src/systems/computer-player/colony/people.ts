import {
  Building,
  BuildMode,
  Female,
  JobAssignment,
  Marriage,
  Residence,
  Settler,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { homeBuildings, homeSettlers } from '../../ai-shared/home-roster.js';
import { onErrand } from '../../ai-shared/military/errand.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import {
  builderJobOf,
  civilianCount,
  classifyWorkforce,
  isAllocatableMan,
} from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { isAdultSettler, mayMarry, raisingChild } from '../../family/eligibility.js';
import { familiesOf } from '../../family/households.js';
import { isFisherJob, isHunterJob, isScoutJob } from '../../readviews/index.js';
import { DEFAULT_BUILD_ORDER } from '../build-order/entries.js';
import { decisionMemo, lineStatuses } from '../build-order/progress.js';
import { seatBuildOrder } from '../build-order/seat-order.js';
import { computerProfileOf } from '../difficulty.js';
import { nodeOfEntity } from '../military/operations/raid-target.js';
import { seatApprentices } from '../technology/apprentices.js';
import { inFoodChain } from '../workforce/food.js';

function apprenticesOf(world: World, ctx: SystemContext, seat: number): ReadonlySet<Entity> {
  const order = seatBuildOrder(world, ctx, seat, DEFAULT_BUILD_ORDER, computerProfileOf(world, seat));
  const owned = homeBuildings(world, ctx, seat);
  return seatApprentices(
    world,
    ctx,
    seat,
    order,
    lineStatuses(world, ctx, seat, owned, order, decisionMemo()),
  );
}

/** The men of `seat` a colony may take, in the order it takes them: no post, flag or trade first, then
 *  builders, then gatherers, unwed first within each, then ascending id. A man at a workplace, a scout, a
 *  fisher, an apprentice and a man on an errand stay. */
export function spareMen(world: World, ctx: SystemContext, seat: number): Entity[] {
  const { pool } = classifyWorkforce(world, ctx, seat, [], 0);
  const apprentices = apprenticesOf(world, ctx, seat);
  const builder = builderJobOf(ctx);
  const rank = (e: Entity): number => {
    const tier = liveWorkFlag(world, e) !== undefined ? 2 : world.get(e, Settler).jobType === builder ? 1 : 0;
    return 2 * tier + (mayMarry(world, ctx.content, e) ? 0 : 1);
  };
  return pool
    .filter((e) => !apprentices.has(e) && !onErrand(world, e) && !world.has(e, BuildMode))
    .map((e) => ({ e, rank: rank(e) }))
    .sort((a, b) => a.rank - b.rank || a.e - b.e)
    .map((m) => m.e);
}

// A colony's party, authored from the survey of arabskie_wyspy_wolna_gra_mieszana's seats.

/** Owner ruling: about 15 men and 5 women, scaled to what the seat can spare. */
const PARTY_MOST = 20;
const WOMEN_SHARE = 4;
/** A colony's women to its men, the party's share. */
export const MEN_PER_WOMAN = WOMEN_SHARE - 1;
/** A party takes at most a quarter of the seat's civilians. */
const CIVILIANS_PER_COLONIST = 4;
/** The civilians home keeps however large it is. */
const HOME_KEEPS_CIVILIANS = 30;
/** Fewer than this found nothing: a warehouse wants builders, carriers and gatherers. */
const PARTY_LEAST = 8;
const COUPLE_SEATS = 2;

/** Who sails from `civilians`, or none while the seat cannot spare a party. */
export function partyFor(civilians: number): { readonly men: number; readonly women: number } | null {
  const size = Math.min(
    PARTY_MOST,
    Math.floor(civilians / CIVILIANS_PER_COLONIST),
    civilians - HOME_KEEPS_CIVILIANS,
  );
  if (size < PARTY_LEAST) return null;
  const women = Math.floor(size / WOMEN_SHARE);
  return { men: size - women, women };
}

function unwed(world: World, e: Entity): boolean {
  return !world.has(e, Marriage);
}

/** Whether `e` leaves a growing child at home. */
function hasMinor(world: World, e: Entity): boolean {
  const marriage = world.tryGet(e, Marriage);
  return marriage !== undefined && raisingChild(world, marriage);
}

/** Whether `e` stands on `land`. */
export function standsOn(world: World, ctx: SystemContext, e: Entity, land: number): boolean {
  const terrain = ctx.terrain;
  const at = nodeOfEntity(world, e);
  return (
    terrain !== undefined &&
    at !== null &&
    terrain.inBounds(at.hx, at.hy) &&
    terrain.componentOf(terrain.nodeAt(at.hx, at.hy)) === land
  );
}

/** The spare men on `land` who leave no growing child behind. */
export function sparePartyMen(world: World, ctx: SystemContext, seat: number, land: number): Entity[] {
  return spareMen(world, ctx, seat).filter((e) => standsOn(world, ctx, e, land) && !hasMinor(world, e));
}

/** Whether `e` puts food on the seat's table: a hunter, a fisher, or a hand in a food chain's workshop. */
function feedsHome(world: World, ctx: SystemContext, e: Entity): boolean {
  const job = world.get(e, Settler).jobType;
  if (isFisherJob(ctx.content, job) || (job !== null && isHunterJob(ctx.content, job))) return true;
  const workplace = world.tryGet(e, JobAssignment)?.workplace;
  const building = workplace === undefined ? undefined : world.tryGet(workplace, Building);
  const type =
    building === undefined ? undefined : contentIndex(ctx.content).buildings.get(building.buildingType);
  return type !== undefined && inFoodChain(ctx, type);
}

/** Whether a husband may leave a post to sail with his wife: a man the workforce can refill, never a post
 *  that feeds the seat, a scout, an apprentice, or a man on an errand or a run. */
function mayFollowWife(
  world: World,
  ctx: SystemContext,
  e: Entity,
  apprentices: ReadonlySet<Entity>,
): boolean {
  return (
    isAllocatableMan(world, ctx, e) &&
    !apprentices.has(e) &&
    !onErrand(world, e) &&
    !world.has(e, BuildMode) &&
    !isScoutJob(ctx.content, world.get(e, Settler).jobType) &&
    !feedsHome(world, ctx, e)
  );
}

/** How many `men` and `women` to take, and in how many `seats`. */
interface PartyWant {
  readonly men: number;
  readonly women: number;
  readonly seats: number;
}

/**
 * Who answers `want` from the people on `land`, men ahead of women: the women unwed first, then wives with
 * their husbands, a spare husband ahead of one who leaves a post; the men left to find unwed first, then
 * married ones alone. No parent of a growing child sails.
 */
function gather(world: World, ctx: SystemContext, seat: number, land: number, want: PartyWant): Entity[] {
  const spare = sparePartyMen(world, ctx, seat, land);
  const wives = homeSettlers(world, ctx, seat).filter(
    (e) =>
      world.has(e, Female) &&
      isAdultSettler(world, e) &&
      standsOn(world, ctx, e, land) &&
      !onErrand(world, e) &&
      !hasMinor(world, e),
  );
  const women: Entity[] = wives.filter((e) => unwed(world, e)).slice(0, Math.min(want.women, want.seats));
  const men: Entity[] = [];
  const apprentices = apprenticesOf(world, ctx, seat);
  const couples = wives.flatMap((wife) => {
    const husband = world.tryGet(wife, Marriage)?.spouse;
    if (husband === undefined) return [];
    const free = spare.includes(husband);
    const follows =
      free || (standsOn(world, ctx, husband, land) && mayFollowWife(world, ctx, husband, apprentices));
    return follows ? [{ wife, husband, free }] : [];
  });
  couples.sort((a, b) => Number(b.free) - Number(a.free) || a.wife - b.wife);
  const room = (): number => want.seats - men.length - women.length;
  for (const { wife, husband } of couples) {
    if (women.length >= want.women || room() < COUPLE_SEATS) break;
    women.push(wife);
    men.push(husband);
  }
  const byUnwed = [...spare].sort((a, b) => Number(unwed(world, b)) - Number(unwed(world, a)));
  for (const man of byUnwed) {
    if (men.length >= want.men || room() <= 0) break;
    if (!men.includes(man)) men.push(man);
  }
  return [...men, ...women];
}

/** The party of a seat ({@link gather}), empty when that makes fewer than {@link PARTY_LEAST}. */
export function pickParty(world: World, ctx: SystemContext, seat: number, land: number): Entity[] {
  const size = partyFor(civilianCount(world, ctx, seat));
  if (size === null) return [];
  const party = gather(world, ctx, seat, land, { ...size, seats: PARTY_MOST });
  return party.length < PARTY_LEAST ? [] : party;
}

/** Who sails on the ferry's outward leg, in `seats`, for the `lacking` men and women of a colony; home keeps
 *  its {@link HOME_KEEPS_CIVILIANS} and its food posts. */
export function topUpParty(
  world: World,
  ctx: SystemContext,
  seat: number,
  land: number,
  lacking: { readonly men: number; readonly women: number },
  seats: number,
): Entity[] {
  const room = Math.min(seats, civilianCount(world, ctx, seat) - HOME_KEEPS_CIVILIANS);
  const want = { ...lacking, seats: room };
  return room <= 0 || (lacking.men <= 0 && lacking.women <= 0) ? [] : gather(world, ctx, seat, land, want);
}

/** Whether home holds more civilians than it keeps. */
export function homeMaySpare(world: World, ctx: SystemContext, seat: number): boolean {
  return civilianCount(world, ctx, seat) > HOME_KEEPS_CIVILIANS;
}

/** The orders that take `party` aboard `ship`, men first so a man holds the helm: each person whose whole
 *  family sails gives up the old home; a husband sailing alone leaves his to his wife. */
export function boardOrders(world: World, party: readonly Entity[], ship: Entity): PlayerCommand[] {
  const sailing = new Set(party);
  const commands: PlayerCommand[] = [];
  for (const e of party) {
    const spouse = world.tryGet(e, Marriage)?.spouse;
    if (spouse === undefined || sailing.has(spouse)) commands.push({ kind: 'unassignHouse', entity: e });
    commands.push({ kind: 'attachToVehicle', entity: e, vehicle: ship });
  }
  return commands;
}

/** What population does at home, over a colony's `people` and `buildings`: one marry order per possible
 *  couple, and a family with no home takes the first free slot. */
export function colonyFamilies(
  world: World,
  ctx: SystemContext,
  people: readonly Entity[],
  buildings: readonly Entity[],
): PlayerCommand[] {
  const index = contentIndex(ctx.content);
  const commands: PlayerCommand[] = [];
  const brides = people.filter((e) => world.has(e, Female) && mayMarry(world, ctx.content, e));
  const grooms = people.filter((e) => !world.has(e, Female) && mayMarry(world, ctx.content, e));
  for (const e of brides.slice(0, grooms.length)) commands.push({ kind: 'marry', entity: e });
  const homes = buildings.flatMap((e) => {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (!isBuilt(world, e) || type === undefined || type.kind !== 'home') return [];
    return [{ entity: e, free: type.homeSize - familiesOf(world, e).length }];
  });
  for (const wife of people) {
    if (!world.has(wife, Female) || !world.has(wife, Marriage) || world.has(wife, Residence)) continue;
    const home = homes.find((h) => h.free > 0);
    if (home === undefined) break;
    home.free--;
    commands.push({ kind: 'assignHouse', entity: wife, house: home.entity });
  }
  return commands;
}
