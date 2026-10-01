import {
  Age,
  AssistantChildOrder,
  AssistantRecruit,
  Building,
  ChildOrder,
  Female,
  JobAssignment,
  Marriage,
  ownerOf,
  Residence,
  Settler,
} from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { liveWorkFlag } from '../economy/work-flag.js';
import { isAdultSettler, isOnMission, mayMarry } from '../family/eligibility.js';
import { homeQualityUseFor, householdGoodAllowed } from '../family/home-quality.js';
import { familiesOf } from '../family/households.js';
import { assistantCounterCommand } from './assistant-counters.js';
import { seatBaseOf } from './base.js';
import { type AiProfile, aiProfileOf, shareOf } from './difficulty.js';
import type { AiPlayerModule } from './index.js';
import { isBuilt, ownedBuildings, ownedSettlers } from './seat-roster.js';
import { builderJobOf, civilianCount, isAllocatableMan } from './workforce/pool.js';
import { builderCap } from './workforce/staffing.js';

/** How many idle men beyond the builder reserve hold the sons counter at zero (authored). */
export const IDLE_MEN_HOLD_BIRTHS = 3;

/**
 * The HomeExpansion module (authored): who marries, which family takes a free home slot, and the birth
 * counters the settlement assistant is held at - daughters up to the housing stock, sons unbounded
 * unless idle men stand beyond the builder reserve ({@link idleMenHoldBirths}), both capped together on
 * a lower difficulty ({@link birthCounters}). It also lets its homes
 * burn the holy oil its druid boils, which a player's policy leaves off by default.
 */

function runPopulation(world: World, ctx: SystemContext, player: number): readonly PlayerCommand[] {
  if (seatBaseOf(world, ctx, player) === null) return [];
  const commands: PlayerCommand[] = [];
  const settlers = ownedSettlers(world, player);
  const women = settlers.filter((e) => world.has(e, Female) && isAdultSettler(world, e));

  // One marry order per single woman, capped by the single-men count so the command log does not fill
  // with orders that would only auto-cancel.
  const singleWomen = women.filter((e) => mayMarry(world, ctx.content, e));
  const singleMen = settlers.filter(
    (e) => !world.has(e, Female) && isAdultSettler(world, e) && mayMarry(world, ctx.content, e),
  );
  for (let i = 0; i < Math.min(singleWomen.length, singleMen.length); i++) {
    const woman = singleWomen[i];
    if (woman !== undefined) commands.push({ kind: 'marry', entity: woman });
  }

  // A married, unhoused woman's family takes the first free family slot, in canonical order; slots
  // claimed this decision are tracked so two families never target the same one.
  const index = contentIndex(ctx.content);
  const homes: Array<{ entity: Entity; free: number }> = [];
  let familySlotsTotal = 0;
  for (const e of ownedBuildings(world, player)) {
    if (!isBuilt(world, e)) continue;
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type === undefined || type.kind !== 'home') continue;
    familySlotsTotal += type.homeSize;
    homes.push({ entity: e, free: type.homeSize - familiesOf(world, e).length });
  }
  for (const woman of women) {
    if (world.has(woman, Residence)) continue;
    if (!hasLivingSpouse(world, woman)) continue;
    const home = homes.find((h) => h.free > 0);
    if (home === undefined) break; // no free slots - wait for the next house
    home.free--;
    commands.push({ kind: 'assignHouse', entity: woman, house: home.entity });
  }

  // Both breeding counters are absolute re-sets, issued only when the wanted state differs.
  let femaleStock = 0;
  for (const e of settlers) {
    const job = world.get(e, Settler).jobType;
    // Women, girls and baby girls fill future family slots. Female mission units do not: their job
    // permanently excludes them from family life, just as it excludes them from `singleWomen` above.
    if (world.has(e, Female) && !isOnMission(ctx.content, job)) femaleStock++;
    // A pending non-assistant daughter order still becomes a female; an assistant-booked order is
    // already accounted inside the counter itself.
    if (world.tryGet(e, ChildOrder)?.child === 'female' && !world.has(e, AssistantChildOrder)) femaleStock++;
  }
  const profile = aiProfileOf(world, player);
  const held = idleMenHoldBirths(world, ctx, player, profile);
  const births = birthCounters(
    profile,
    () => ({
      wives: women.filter((e) => hasLivingSpouse(world, e)).length,
      minors: minorsOf(world, settlers),
    }),
    familySlotsTotal - femaleStock,
    held,
    () => bookedBirths(world, player),
  );
  const daughters = assistantCounterCommand(world, player, 'extraWomen', births.daughters, false);
  if (daughters !== null) commands.push(daughters);
  const sons = assistantCounterCommand(world, player, 'extraMen', births.sons ?? 0, births.sons === null);
  if (sons !== null) commands.push(sons);
  if (homeQualityUseFor(ctx, 'piety') !== undefined && !householdGoodAllowed(world, player, 'piety')) {
    commands.push({ kind: 'setHouseholdGoodUse', player, effect: 'piety', allowed: true });
  }
  return commands;
}

/**
 * Whether at least {@link IDLE_MEN_HOLD_BIRTHS} builder-trade men beyond the builder reserve
 * ({@link builderCap}) stand idle: no post, no live work flag, no drill or recruit booking. A man nobody
 * can post or arm is a mouth, so more sons wait until posts or arms open up. It reads no clock, so the
 * opening, where every man is placed, is never held.
 */
function idleMenHoldBirths(world: World, ctx: SystemContext, player: number, profile: AiProfile): boolean {
  const builderJob = builderJobOf(ctx);
  if (builderJob === null) return false;
  let idle = 0;
  for (const e of ownedSettlers(world, player)) {
    if (world.get(e, Settler).jobType !== builderJob || !isAllocatableMan(world, ctx, e)) continue;
    if (world.has(e, JobAssignment) || world.has(e, AssistantRecruit)) continue;
    if (liveWorkFlag(world, e) === undefined) idle++;
  }
  return idle - builderCap(profile, civilianCount(world, ctx, player), ctx.tick) >= IDLE_MEN_HOLD_BIRTHS;
}

/**
 * The two birth counters: daughters up to the `wantedDaughters` the homes lack, sons unbounded (null)
 * unless `held`. A profile with a {@link AiProfile.birthShare} caps the seat's minors and its children on
 * the way together at that share of its `wives`, at least one, daughters first. The assistant counts each
 * counter's own sex's booked child orders against it (`systems/assistant/`), so each counter leaves room
 * for the other sex's bookings already running.
 */
function birthCounters(
  profile: AiProfile,
  family: () => { readonly wives: number; readonly minors: number },
  wantedDaughters: number,
  held: boolean,
  booked: () => { readonly daughters: number; readonly sons: number },
): { readonly daughters: number; readonly sons: number | null } {
  if (profile.birthShare === null) return { daughters: wantedDaughters, sons: held ? 0 : null };
  const { wives, minors } = family();
  const limit = Math.max(1, shareOf(wives, profile.birthShare)) - minors;
  const running = booked();
  const daughters = Math.max(0, Math.min(wantedDaughters, limit - running.sons));
  return { daughters, sons: held ? 0 : Math.max(0, limit - Math.max(daughters, running.daughters)) };
}

/** How many of `settlers` are still growing up. */
function minorsOf(world: World, settlers: readonly Entity[]): number {
  let minors = 0;
  for (const e of settlers) if (world.has(e, Age)) minors++;
  return minors;
}

/** The seat's child orders the assistant booked and a mother still carries, by the child's sex. */
function bookedBirths(world: World, player: number): { daughters: number; sons: number } {
  const booked = { daughters: 0, sons: 0 };
  for (const e of world.query(AssistantChildOrder)) {
    if (ownerOf(world, e) !== player) continue;
    if (world.get(e, AssistantChildOrder).sex === 'female') booked.daughters++;
    else booked.sons++;
  }
  return booked;
}

/** Married to a living spouse - narrower than the family rule's `isMarried`, which also counts a widow
 *  raising a minor, because a widow is orderable into a new family plan. */
function hasLivingSpouse(world: World, e: Entity): boolean {
  const marriage = world.tryGet(e, Marriage);
  return marriage !== undefined && world.isAlive(marriage.spouse);
}

export const populationModule: AiPlayerModule = {
  id: 'homeExpansion',
  run: runPopulation,
};
