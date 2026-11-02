import { BuildMode, Female, Marriage, Settler } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { homeBuildings, homeSettlers } from '../../ai-shared/home-roster.js';
import { onErrand } from '../../ai-shared/military/errand.js';
import { builderJobOf, civilianCount, classifyWorkforce } from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { isAdultSettler, mayMarry, raisingChild } from '../../family/eligibility.js';
import { DEFAULT_BUILD_ORDER } from '../build-order/entries.js';
import { decisionMemo, lineStatuses } from '../build-order/progress.js';
import { seatBuildOrder } from '../build-order/seat-order.js';
import { computerProfileOf } from '../difficulty.js';
import { nodeOfEntity } from '../military/operations/raid-target.js';
import { seatApprentices } from '../technology/apprentices.js';

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
/** A party takes at most a quarter of the seat's civilians. */
const CIVILIANS_PER_COLONIST = 4;
/** The civilians home keeps however large it is. */
const HOME_KEEPS_CIVILIANS = 30;
/** Fewer than this found nothing: a warehouse and four homes want builders, carriers and gatherers. */
const PARTY_LEAST = 8;

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

/**
 * The party of a seat, men ahead of women, read from the people on `land`: the women unwed first, then wives
 * with their husbands; the men left to find unwed first, then married ones alone. No parent of a growing
 * child sails. Empty when that makes fewer than {@link PARTY_LEAST}.
 */
export function pickParty(world: World, ctx: SystemContext, seat: number, land: number): Entity[] {
  const size = partyFor(civilianCount(world, ctx, seat));
  const terrain = ctx.terrain;
  if (size === null || terrain === undefined) return [];
  const onLand = (e: Entity): boolean => {
    const at = nodeOfEntity(world, e);
    return (
      at !== null &&
      terrain.inBounds(at.hx, at.hy) &&
      terrain.componentOf(terrain.nodeAt(at.hx, at.hy)) === land
    );
  };
  const spare = spareMen(world, ctx, seat).filter((e) => onLand(e) && !hasMinor(world, e));
  const wives = homeSettlers(world, ctx, seat).filter(
    (e) =>
      world.has(e, Female) &&
      isAdultSettler(world, e) &&
      onLand(e) &&
      !onErrand(world, e) &&
      !hasMinor(world, e),
  );
  const women: Entity[] = wives.filter((e) => unwed(world, e)).slice(0, size.women);
  const men: Entity[] = [];
  for (const wife of wives) {
    if (women.length >= size.women) break;
    const husband = world.tryGet(wife, Marriage)?.spouse;
    if (husband !== undefined && spare.includes(husband)) {
      women.push(wife);
      men.push(husband);
    }
  }
  const byUnwed = [...spare].sort((a, b) => Number(unwed(world, b)) - Number(unwed(world, a)));
  for (const man of byUnwed) {
    if (men.length >= size.men) break;
    if (!men.includes(man)) men.push(man);
  }
  return men.length + women.length < PARTY_LEAST ? [] : [...men, ...women];
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
