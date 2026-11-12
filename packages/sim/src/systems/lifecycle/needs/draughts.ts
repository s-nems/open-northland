import {
  Carrying,
  Equipment,
  Fleeing,
  Frightened,
  NeedOrder,
  NoRegeneration,
  PathFollow,
  PathRoute,
  Settler,
  SettlerNeeds,
  type SettlerNeedsView,
  Sheltering,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { type Fixed, fx, ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { type CarriedDraught, draughtFor, spendSip } from '../../equipment/index.js';
import { startDrink } from '../../settlers/atomics/start.js';
import { pullsHaulingCart } from '../../vehicles/hauling-cart.js';
import { carriesNeeds } from './drain-class.js';
import { mutNeeds, needLevel } from './levels.js';
import {
  applyNeedUnits,
  NEED_CRITICAL_THRESHOLD,
  NEED_DRIVE_THRESHOLD,
  NEED_RESERVE_UNITS,
} from './scale.js';

/** A restore percent in need reserve units. */
const reserveUnits = (pct: number): number => (pct * NEED_RESERVE_UNITS) / 100;

const pressing = (level: Fixed): boolean => level >= NEED_DRIVE_THRESHOLD;

/** The bars a carried draught answers, hunger first. */
type DraughtBar = 'hunger' | 'fatigue';
const DRAUGHT_BARS: readonly DraughtBar[] = ['hunger', 'fatigue'];

/**
 * The level at which a settler drinks the mead it stops for where it stands rather than on its next walk,
 * and a loaded walker stops for it on the way: halfway from the drive level to the critical one the HUD
 * marks. Owner's rule, an approximation of where: mead is drunk on the way, not in a doorway, yet before
 * the player hears the settler is hungry.
 */
export const DRINK_IN_PLACE_LEVEL: Fixed = fx.div(
  fx.add(NEED_DRIVE_THRESHOLD, NEED_CRITICAL_THRESHOLD),
  fx.fromInt(2),
);

/** Legs a stop for mead keeps clear of at either end of a route, so it is not taken in a doorway.
 *  Approximation: two legs make about one cell. */
const DRINK_STOP_CLEARANCE_LEGS = 2;

/**
 * Drink one carried draught for each of hunger and fatigue whose bar is at the drive level, hunger first,
 * where the settler stands and without stopping what it does. A draught its bearer stops for is left to
 * {@link stopToDrink}. Original behavior: checked whenever the settler plans and at every node it walks
 * onto, before any other answer to the need, and never while a player's need order is pending.
 */
export function drinkPressingDraughts(world: World, ctx: SystemContext, e: Entity): void {
  const bars = world.tryGet(e, SettlerNeeds);
  if (
    bars === undefined ||
    !(pressing(needLevel(bars, 'hunger', ctx.tick)) || pressing(needLevel(bars, 'fatigue', ctx.tick)))
  )
    return;
  if (world.has(e, NeedOrder) || !carriesNeeds(world, ctx.content, e)) return;
  for (const need of DRAUGHT_BARS) {
    if (!pressing(needLevel(world.get(e, SettlerNeeds), need, ctx.tick))) continue;
    const draught = draughtFor(world, ctx, e, need, 'onTheSpot');
    if (draught !== null) sip(world, ctx, e, draught);
  }
}

/**
 * {@link drinkPressingDraughts} for a settler nobody sees, a rider inside a ship: the draught it would stop
 * for on land is sipped at once too, as there is no clip to play. Owner's rule kept: not by a soldier whose
 * regeneration is prohibited ({@link stoppingDraughtFor}).
 */
export function drinkPressingDraughtsUnseen(world: World, ctx: SystemContext, e: Entity): void {
  drinkPressingDraughts(world, ctx, e);
  if (!world.has(e, SettlerNeeds)) return;
  for (const need of DRAUGHT_BARS) {
    if (!pressing(needLevel(world.get(e, SettlerNeeds), need, ctx.tick))) continue;
    const draught = stoppingDraughtFor(world, ctx, e, need);
    if (draught !== null) sip(world, ctx, e, draught);
  }
}

/**
 * The draught `e` would stop to drink for `need` (mead), or null. Owner's rule: never for a soldier whose
 * regeneration the player prohibited, who would stand drinking in the line, and, like every draught, never
 * while a player's need order is pending.
 */
export function stoppingDraughtFor(
  world: World,
  ctx: SystemContext,
  e: Entity,
  need: DraughtBar,
): CarriedDraught | null {
  if (world.has(e, NoRegeneration) || world.has(e, NeedOrder) || !carriesNeeds(world, ctx.content, e)) {
    return null;
  }
  return draughtFor(world, ctx, e, need, 'stopping');
}

/**
 * Start drinking where `e` stands a {@link stoppingDraughtFor} draught for the first of `bars` at or past
 * `level`, once the draughts it drinks on the spot have had their turn; false when none is due.
 */
export function stopToDrink(
  world: World,
  ctx: SystemContext,
  e: Entity,
  level: Fixed,
  bars: readonly DraughtBar[] = DRAUGHT_BARS,
): boolean {
  const draught = drinkDue(world, ctx, e, level, bars);
  if (draught === null) return false;
  beginDrink(world, ctx, e, draught);
  return true;
}

/**
 * The draught walker `e` stops for on the stop of its route it stands on, or null. Only on a stop at least
 * {@link DRINK_STOP_CLEARANCE_LEGS} legs from both ends of the route, never in flight or on the way to
 * cover, and at the drive level unless it carries a load or pulls its hauling cart, which the eat clip
 * would hide: such a walker stops once the bar reaches {@link DRINK_IN_PLACE_LEVEL}. Owner's rule: mead is
 * drunk on the way, not on arrival. The caller drops or parks the walk before {@link beginDrink}.
 */
export function drinkDueOnTheWay(world: World, ctx: SystemContext, e: Entity): CarriedDraught | null {
  // Asked at every stop of every walk, so the bars answer first: few walkers are at the drive level.
  const needs = world.tryGet(e, SettlerNeeds);
  if (needs === undefined || !anyAtOrPast(needs, DRAUGHT_BARS, NEED_DRIVE_THRESHOLD, ctx.tick)) return null;
  const loaded = world.has(e, Carrying) || pullsHaulingCart(world, e);
  const level = loaded ? DRINK_IN_PLACE_LEVEL : NEED_DRIVE_THRESHOLD;
  if (loaded && !anyAtOrPast(needs, DRAUGHT_BARS, level, ctx.tick)) return null;
  if (world.has(e, Fleeing) || world.has(e, Frightened) || world.has(e, Sheltering)) return null;
  const at = (world.tryGet(e, PathFollow)?.index ?? 0) - 1;
  const stops = world.tryGet(e, PathRoute)?.waypoints.length ?? 0;
  if (at < DRINK_STOP_CLEARANCE_LEGS || stops - 1 - at < DRINK_STOP_CLEARANCE_LEGS) return null;
  return drinkDue(world, ctx, e, level, DRAUGHT_BARS);
}

/** Start drinking `draught` on the eat clip where `e` stands. */
export function beginDrink(world: World, ctx: SystemContext, e: Entity, draught: CarriedDraught): void {
  startDrink(world, ctx, e, world.get(e, Settler), draught);
}

function drinkDue(
  world: World,
  ctx: SystemContext,
  e: Entity,
  level: Fixed,
  bars: readonly DraughtBar[],
): CarriedDraught | null {
  const needs = world.tryGet(e, SettlerNeeds);
  if (needs === undefined || !anyAtOrPast(needs, bars, level, ctx.tick)) return null;
  drinkPressingDraughts(world, ctx, e);
  for (const need of bars) {
    if (needLevel(world.get(e, SettlerNeeds), need, ctx.tick) < level) continue;
    const draught = stoppingDraughtFor(world, ctx, e, need);
    if (draught !== null) return draught;
  }
  return null;
}

function anyAtOrPast(
  needs: SettlerNeedsView,
  bars: readonly DraughtBar[],
  level: Fixed,
  tick: number,
): boolean {
  for (const need of bars) if (needLevel(needs, need, tick) >= level) return true;
  return false;
}

/** The sip a finished drink clip lands: one of the draught of `goodType` in misc `slot`, while it is still
 *  there with a sip left. */
export function drinkSip(world: World, ctx: SystemContext, e: Entity, slot: number, goodType: number): void {
  const held = world.tryGet(e, Equipment)?.misc[slot];
  if (held == null || held.goodType !== goodType || held.degreeOfUse >= ONE) return;
  const restore = contentIndex(ctx.content).goods.get(goodType)?.equip?.restorePct;
  if (restore !== undefined) sip(world, ctx, e, { slot, goodType, restore });
}

/** One sip restores every bar its good names, so mead drunk for hunger also rests. */
function sip(world: World, ctx: SystemContext, e: Entity, draught: CarriedDraught): void {
  const s = mutNeeds(world, e, ctx.tick);
  const { hunger, fatigue } = draught.restore;
  if (hunger !== undefined) s.hunger = applyNeedUnits(s.hunger, reserveUnits(hunger));
  if (fatigue !== undefined) s.fatigue = applyNeedUnits(s.fatigue, reserveUnits(fatigue));
  spendSip(world, ctx, e, draught.slot);
}
