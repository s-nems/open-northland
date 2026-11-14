import {
  Age,
  AssistantRecruit,
  assistantFoundsFamilies,
  Building,
  BuildMode,
  Female,
  JobAssignment,
  Marriage,
  Settler,
} from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { homeBuildings, homeSettlers } from '../ai-shared/home-roster.js';
import { onErrand } from '../ai-shared/military/errand.js';
import { isBuilt } from '../ai-shared/seat-roster.js';
import { builderJobOf, civilianCount, isAllocatableMan } from '../ai-shared/workforce/pool.js';
import type { SystemContext } from '../context.js';
import { liveWorkFlag } from '../economy/work-flag.js';
import { isAdultSettler } from '../family/eligibility.js';
import { homeFamilyCapacity, homeQualityUseFor, householdGoodAllowed } from '../family/home-quality.js';
import { assistantCounterCommand } from './assistant-counters.js';
import { seatBaseOf } from './base.js';
import { type ComputerProfile, computerProfileOf, shareOf } from './difficulty.js';
import { bookedBirths, femaleStockOf } from './female-stock.js';
import type { ComputerModule } from './index.js';
import { builderCap } from './workforce/staffing.js';

/** How many idle men beyond the builder reserve hold the sons counter at zero (authored). */
export const IDLE_MEN_HOLD_BIRTHS = 3;

/**
 * The HomeExpansion module (authored): the settlement assistant houses and weds the seat's women
 * ({@link familiesSwitch}) and is held at the birth counters set here - daughters up to the housing
 * stock, sons unbounded unless idle men stand beyond the builder reserve ({@link idleMenHoldBirths}),
 * both capped together on a lower difficulty ({@link birthCounters}). It also lets its homes
 * burn the holy oil its druid boils, which a player's policy leaves off by default.
 */

function runPopulation(world: World, ctx: SystemContext, player: number): readonly PlayerCommand[] {
  if (seatBaseOf(world, ctx, player) === null) return [];
  const commands: PlayerCommand[] = familiesSwitch(world, player);
  const settlers = homeSettlers(world, ctx, player);
  const women = settlers.filter((e) => world.has(e, Female) && isAdultSettler(world, e));

  const index = contentIndex(ctx.content);
  let familySlotsTotal = 0;
  for (const e of homeBuildings(world, ctx, player)) {
    if (!isBuilt(world, e)) continue;
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type?.kind === 'home') familySlotsTotal += homeFamilyCapacity(world, ctx, e, type);
  }

  // Both breeding counters are absolute re-sets, issued only when the wanted state differs. An
  // assistant-booked daughter is already accounted inside the counter itself.
  const femaleStock = femaleStockOf(world, ctx, settlers);
  const profile = computerProfileOf(world, player);
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
 * ({@link builderCap}) stand idle: no post, no live work flag, no road or wall run, no errand, no drill or
 * recruit booking. A man nobody can post or arm is a mouth, so more sons wait until posts or arms open up.
 * It reads no clock, so the opening, where every man is placed, is never held.
 */
function idleMenHoldBirths(
  world: World,
  ctx: SystemContext,
  player: number,
  profile: ComputerProfile,
): boolean {
  const builderJob = builderJobOf(ctx);
  if (builderJob === null) return false;
  let idle = 0;
  for (const e of homeSettlers(world, ctx, player)) {
    if (world.get(e, Settler).jobType !== builderJob || !isAllocatableMan(world, ctx, e)) continue;
    if (world.has(e, JobAssignment) || world.has(e, AssistantRecruit)) continue;
    // A man on a road or wall run, or sent out on an errand, has work, as the workforce counts him.
    if (world.has(e, BuildMode) || onErrand(world, e)) continue;
    if (liveWorkFlag(world, e) === undefined) idle++;
  }
  return idle - builderCap(profile, civilianCount(world, ctx, player), ctx.tick) >= IDLE_MEN_HOLD_BIRTHS;
}

/**
 * The two birth counters: daughters up to the `wantedDaughters` the homes lack, sons unbounded (null)
 * unless `held`. A profile with a {@link ComputerProfile.birthShare} caps the seat's minors and its children on
 * the way together at that share of its `wives`, at least one, daughters first. The assistant counts each
 * counter's own sex's booked child orders against it (`systems/assistant/`), so each counter leaves room
 * for the other sex's bookings already running.
 */
function birthCounters(
  profile: ComputerProfile,
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

/** Married to a living spouse - narrower than the family rule's `isMarried`, which also counts a widow
 *  raising a minor, because a widow is orderable into a new family plan. */
function hasLivingSpouse(world: World, e: Entity): boolean {
  const marriage = world.tryGet(e, Marriage);
  return marriage !== undefined && world.isAlive(marriage.spouse);
}

/** The command turning the seat's "found families" switch on, until it is: its women are housed and wed
 *  by the same assistant feature a player switches on. */
export function familiesSwitch(world: World, player: number): PlayerCommand[] {
  return assistantFoundsFamilies(world, player)
    ? []
    : [{ kind: 'setAssistantFoundFamilies', player, enabled: true }];
}

export const populationModule: ComputerModule = {
  id: 'homeExpansion',
  run: runPopulation,
};
