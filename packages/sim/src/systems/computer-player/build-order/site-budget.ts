import { Building, BuildOrderPause, UnderConstruction, Upgrading } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { homeSettlers } from '../../ai-shared/home-roster.js';
import { isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { isServedConstructionSite } from '../../settlers/targets/index.js';
import { type ComputerProfile, computerProfileOf } from '../difficulty.js';
import { SITES_GROW_FROM_TICKS } from '../game-phase.js';
import { type BuildOrder, type BuildOrderEntry, isLaneEntry, orderSteps } from './entries.js';
import { TOWER_CONTENT_IDS } from './front.js';
import { HOUSING_PACE, homeTiersOf, housingExtraSites, housingStage } from './housing.js';
import { sitePace } from './limits.js';
import type { DecisionMemo } from './memo.js';
import { seatHomesCap } from './plots.js';
import { entryStatus } from './status.js';

/** The most homes the seat's housing lane raises before room lifts it, under its ground plan's cut. */
export function housingCap(world: World, player: number, order: BuildOrder): number {
  const entry = orderSteps(order).find((step) => step.kind === 'housing');
  return entry?.kind === 'housing' ? seatHomesCap(world, player, entry.count) : 0;
}

/** The seat's open sites that count against its pace: a workshop's hidden vehicle yard is the crew's own
 *  cycle, never a placement the list made, so it holds no slot. */
export function constructionSites(world: World, ctx: SystemContext, owned: readonly Entity[]): Entity[] {
  return owned.filter((e) => isServedConstructionSite(world, ctx.content, e));
}

/** The adult men the seat keeps per open construction site before it opens a tower site (authored): the
 *  open sites' builder pair (`workforce/staffing.ts`) and a gatherer feeding them. Basis: observed on
 *  magiczny_las, seats with more men a site grew; on specjalna_forteca a seat of few men opened several
 *  tower sites beside its homes and mill and finished none. */
export const MEN_PER_OPEN_SITE = 3;

/** The open sites `player`'s men can staff ({@link MEN_PER_OPEN_SITE}), at least one: no tower site
 *  opens past it. Infinite for a seat with no man yet, whose sites wait for the men a script
 *  brings and keep the clock's pace alone. */
export function crewSiteCap(world: World, ctx: SystemContext, player: number): number {
  let men = 0;
  for (const e of homeSettlers(world, ctx, player)) if (isAllocatableMan(world, ctx, e)) men++;
  return men === 0 ? Number.POSITIVE_INFINITY : Math.max(1, Math.floor(men / MEN_PER_OPEN_SITE));
}

/** The housing lane's share of the open `sites`, a ring's towers standing apart left out: `beyond` is
 *  how many of its home sites stand past the clock's `siteCap` (all but its first, or all of them while
 *  `apart`, up to {@link housingExtraSites}), and `open` whether it may open one more: below its stage's
 *  sites ({@link HOUSING_PACE}) and below the clock's sites plus its extra. */
export function homeSiteBudget(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  order: BuildOrder,
  sites: readonly Entity[],
  siteCap: number,
  apart: boolean,
): { readonly beyond: number; readonly open: boolean } {
  const entry = order.lines.flatMap((line) => line.steps).find((step) => step.kind === 'housing');
  if (entry?.kind !== 'housing') return { beyond: 0, open: false };
  const chain = homeTiersOf(ctx.content, entry);
  const homes = sites.filter((e) => chain.has(world.get(e, Building).buildingType)).length;
  // The stage walks the seat's buildings, so it is read only when a home site could stand past the clock.
  if (!apart && homes === 0 && sites.length < siteCap) return { beyond: 0, open: true };
  const stage = housingStage(world, ctx, player, owned);
  const extra = housingExtraSites(stage, siteCap, apart);
  return {
    beyond: Math.max(0, Math.min(homes - (apart ? 0 : 1), extra)),
    open: homes < HOUSING_PACE[stage].sites && (apart ? homes < extra : sites.length < siteCap + extra),
  };
}

/** Whether a tower ring's sites stand beyond the clock's sites (owner ruling: towers are always good, and
 *  the ring stands by the military deadline): on a profile that never pauses, so the slower profiles' pace
 *  stays their throttle. On krwawa_rzeka, with the ring inside the clock's sites, the first tower went up
 *  only as the clock grew at minute 45 and one or two stood by minute 70. */
export function ringApart(profile: ComputerProfile): boolean {
  return profile.freeSitePauseTicks === 0;
}

/** Whether `e` is a new tower site of a ring, not a standing tower rising a tier. */
export function ringTowerSite(world: World, ctx: SystemContext, e: Entity): boolean {
  if (world.has(e, Upgrading)) return false;
  const type = contentIndex(ctx.content).buildings.get(world.get(e, Building).buildingType);
  return type !== undefined && TOWER_CONTENT_IDS.includes(type.id);
}

/** Whether the housing lane's home sites all stand beyond the clock's sites (authored): on a profile that
 *  never pauses, once the clock has grown ({@link SITES_GROW_FROM_TICKS}). On magiczny_las, with the first
 *  home counted, two home sites and two tower sites held every site of the third quarter hour past the
 *  peace and the second smithy, mint and brewery waited with a spot found. */
export function homesApart(profile: ComputerProfile, tick: number): boolean {
  return profile.freeSitePauseTicks === 0 && tick >= SITES_GROW_FROM_TICKS;
}

/** Construction sites over the pace kept for a workshop whose discovery the seat earned (authored): owner
 *  ruling, once a trade is discovered its building goes up promptly; on magiczny_las the bakery waited up to
 *  six game minutes after its discovery while the pace's sites were taken. */
export const EARNED_WORKSHOP_EXTRA_SITES = 1;

/** Whether a seat at `sites` open sites of its pace's `siteCap` may still open one for an earned workshop:
 *  only with a base and a profile that never pauses between sites, since the slower profiles' pace is their
 *  throttle. */
export function earnedSiteOpen(
  base: Entity | null,
  profile: ComputerProfile,
  sites: number,
  siteCap: number,
): boolean {
  return base !== null && profile.freeSitePauseTicks === 0 && sites < siteCap + EARNED_WORKSHOP_EXTRA_SITES;
}

/** Whether the seat's free site still waits out its profile's {@link ComputerProfile.freeSitePauseTicks}: the
 *  first decision that finds a site free starts the wait, and the next site or upgrade the list starts
 *  ends it, so every construction costs the seat its build time plus the pause. */
export function waitsOnFreeSite(
  world: World,
  carrier: Entity | null,
  profile: ComputerProfile,
  tick: number,
): boolean {
  if (carrier === null || profile.freeSitePauseTicks === 0) return false;
  const pause = world.tryGet(carrier, BuildOrderPause);
  if (pause !== undefined) return tick < pause.untilTick;
  world.add(carrier, BuildOrderPause, { untilTick: tick + profile.freeSitePauseTicks });
  return true;
}

/**
 * Whether acting on `step` of a line's `steps` would take the line more than the clock's lookahead
 * ({@link sitePace}) past its oldest step met only by a fresh site still going up. That step is found by
 * re-reading the line over the buildings that stand, a building mid-upgrade counted at the tier it has.
 * A step unmet over the sites too was passed over, not met by one, so it never holds the line; skipped
 * steps and lanes do not count toward the lookahead.
 */
export function outrunsSites(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  steps: readonly BuildOrderEntry[],
  step: number,
  memo: DecisionMemo,
): boolean {
  const { lookahead } = sitePace(computerProfileOf(world, player), ctx.tick);
  if (step <= lookahead) return false;
  const standing = owned.filter((e) => !world.has(e, UnderConstruction) || world.has(e, Upgrading));
  let oldest = -1;
  for (let i = 0; i < step && oldest < 0; i++) {
    const entry = steps[i];
    if (entry === undefined || isLaneEntry(entry)) continue;
    if (entryStatus(world, ctx, player, standing, entry, memo, false) !== 'unmet') continue;
    if (entryStatus(world, ctx, player, owned, entry, memo) !== 'unmet') oldest = i;
  }
  if (oldest < 0) return false;
  let ahead = 0;
  for (let i = oldest + 1; i <= step; i++) {
    const entry = steps[i];
    if (entry === undefined || isLaneEntry(entry)) continue;
    if (entryStatus(world, ctx, player, owned, entry, memo) !== 'skip') ahead++;
  }
  return ahead > lookahead;
}
