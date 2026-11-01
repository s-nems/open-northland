import {
  Age,
  AssistantRecruit,
  Building,
  Female,
  JobAssignment,
  Marriage,
  Residence,
  Settler,
} from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { isBuilt, ownedBuildings, ownedSettlers } from '../ai-shared/seat-roster.js';
import { builderJobOf, civilianCount, isAllocatableMan } from '../ai-shared/workforce/pool.js';
import type { SystemContext } from '../context.js';
import { liveWorkFlag } from '../economy/work-flag.js';
import { isAdultSettler, mayMarry } from '../family/eligibility.js';
import { homeQualityUseFor, householdGoodAllowed } from '../family/home-quality.js';
import { familiesOf } from '../family/households.js';
import { assistantCounterCommand } from './assistant-counters.js';
import { seatBaseOf } from './base.js';
import { type ComputerProfile, computerProfileOf, shareOf } from './difficulty.js';
import { bookedBirths, femaleStockOf } from './female-stock.js';
import { minutesToTicks } from './game-phase.js';
import type { ComputerModule } from './index.js';
import { seatEarningTrades } from './technology/apprentices.js';
import { builderCap } from './workforce/staffing.js';

/** Until when the seat's weddings go out from the men's side in husband order, in ticks (owner ruling:
 *  builders take the wives in the first 30 game minutes). Later the women's side orders, each bride
 *  taking the man nearest her, so no bride walks out to a builder on a far site. */
export const MEN_PROPOSE_UNTIL_TICKS = minutesToTicks(30);

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

  // One marry order per possible couple, capped by the smaller side so the command log does not fill with
  // orders that would only auto-cancel. In the opening every order goes from the men's side in husband
  // order, each man wedding the woman nearest him, so a woman's order never picks the farmer only because
  // he stands nearest; the rest go from the women's side.
  const singleWomen = women.filter((e) => mayMarry(world, ctx.content, e));
  const singleMen = settlers.filter(
    (e) => !world.has(e, Female) && isAdultSettler(world, e) && mayMarry(world, ctx.content, e),
  );
  const orders = Math.min(singleWomen.length, singleMen.length);
  if (orders > 0) {
    const proposers =
      ctx.tick < MEN_PROPOSE_UNTIL_TICKS ? husbandOrder(world, ctx, player, singleMen) : singleWomen;
    for (const e of proposers.slice(0, orders)) commands.push({ kind: 'marry', entity: e });
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

/** Husband ranks, lowest weds first (owner ruling): the builders, whose trade earns the seat nothing a
 *  wife's errands delay; then the men of a trade no pending discovery waits on; last the men still
 *  earning one, such as the farmer toward the miller's trade. */
const BUILDER_HUSBAND = 0;
const IDLE_TRADE_HUSBAND = 1;
const EARNING_HUSBAND = 2;

/**
 * `singleMen` in the order they propose: by husband rank, ascending id within a rank. A priority only:
 * the caller still orders one man per single woman, so every woman marries while single men exist.
 */
function husbandOrder(
  world: World,
  ctx: SystemContext,
  player: number,
  singleMen: readonly Entity[],
): Entity[] {
  const builderJob = builderJobOf(ctx);
  let earning: ReadonlySet<number> | undefined;
  const rankOf = (e: Entity): number => {
    const job = world.get(e, Settler).jobType;
    if (job !== null && job === builderJob) return BUILDER_HUSBAND;
    if (job === null) return IDLE_TRADE_HUSBAND;
    earning ??= seatEarningTrades(world, ctx, player);
    return earning.has(job) ? EARNING_HUSBAND : IDLE_TRADE_HUSBAND;
  };
  const ranked = singleMen.map((e) => ({ e, rank: rankOf(e) }));
  ranked.sort((a, b) => a.rank - b.rank || a.e - b.e);
  return ranked.map((r) => r.e);
}

/**
 * Whether at least {@link IDLE_MEN_HOLD_BIRTHS} builder-trade men beyond the builder reserve
 * ({@link builderCap}) stand idle: no post, no live work flag, no drill or recruit booking. A man nobody
 * can post or arm is a mouth, so more sons wait until posts or arms open up. It reads no clock, so the
 * opening, where every man is placed, is never held.
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
  for (const e of ownedSettlers(world, player)) {
    if (world.get(e, Settler).jobType !== builderJob || !isAllocatableMan(world, ctx, e)) continue;
    if (world.has(e, JobAssignment) || world.has(e, AssistantRecruit)) continue;
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

export const populationModule: ComputerModule = {
  id: 'homeExpansion',
  run: runPopulation,
};
