import {
  Female,
  Health,
  Marriage,
  Rider,
  Settler,
  Vehicle,
  vehiclePassengers,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { DeepReadonly, Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { colonyLands, colonySettlersOn, homeSettlers } from '../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { builderJobOf } from '../../ai-shared/workforce/pool.js';
import { isAdultSettler } from '../../family/eligibility.js';
import { CIVILIST_JOB } from '../../lifecycle/ageclass.js';
import { passengerJobAllowed } from '../../vehicles/crew.js';
import { type Share, shareOf } from '../difficulty.js';
import { minutesToTicks } from '../game-phase.js';
import { freeShips, LANDING_SAIL_TIMEOUT_TICKS, otherShore } from '../military/operations/landing.js';
import { strandedShip } from '../sea-route.js';
import { colonists } from './founding.js';
import { garrisonOwed } from './garrison.js';
import { tradesmenFor } from './overflow.js';
import { boardOrders, sparePartyMen, standsOn, topUpParty } from './people.js';
import { handsWanted, menPastWork } from './posts.js';
import { colonyHand } from './school.js';
import { clearWay, lineWayClear, withDanger, withoutLapsed } from './sea-danger.js';
import {
  type ColonyEnv,
  type ColonyView,
  dock,
  homeLandOf,
  lyingStill,
  mooredOn,
  mooringOf,
  unloadAt,
} from './voyage.js';

// A colony's people cross on a free ship of the seat's: the trader's pinned ship seats only its carriers. The
// ferry takes on at home the tradesmen, garrison and settlers the colony is owed, lands them there, takes the
// colony's men past work home and lands them, and the ship is free again. An abandoned colony's survivors
// come home the same way.

type FerryView = DeepReadonly<NonNullable<ColonyView['ferry']>>;

/** How long riders may take to board before the ship sails without them (authored). */
const FERRY_BOARD_TICKS = minutesToTicks(4);
/** How long a crossing may take before the ship is let go at its next mooring (authored: a landing's sail
 *  limit). */
const FERRY_SAIL_TICKS = LANDING_SAIL_TIMEOUT_TICKS;
/** The passengers a ferry takes once fire has found its colony's ships (authored): what a sunk hull may
 *  cost. */
const RIDERS_NEAR_FIRE = 2;

/** The orders that sail `ship` for `to`, round the fire the colony's ships have met, and straight when no
 *  way is clear: a ship already out has to come in. */
export function sailOrders(
  env: ColonyEnv,
  colony: ColonyView,
  ship: Entity,
  to: DeepReadonly<HalfCellNode>,
): PlayerCommand[] {
  const from = anchorNodeOf(env.world, ship);
  const way = from === null ? null : clearWay(env.terrain, colony.dangers, from, to);
  if (way === null || way.via === null) return [dock(ship, to)];
  const { hx: x, hy: y } = way.via;
  return [
    { kind: 'moveVehicle', vehicle: ship, x, y },
    { kind: 'dockVehicle', vehicle: ship, x: to.hx, y: to.hy, queued: true },
  ];
}

/** The ship's riders, the helm first. */
function ridersOf(world: World, ship: Entity): Entity[] {
  const state = world.tryGet(ship, Vehicle);
  return state === undefined
    ? []
    : vehiclePassengers(state)
        .map((seat) => seat.entity)
        .filter((e) => world.isAlive(e));
}

/** The colony's people `ship` may seat: its jobs leave out children, who stay. */
export function survivorsFor(env: ColonyEnv, ship: Entity): Entity[] {
  const { world, ctx } = env;
  const state = world.tryGet(ship, Vehicle);
  const type = state === undefined ? undefined : contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined) return [];
  return colonists(env).filter((e) => passengerJobAllowed(type, world.get(e, Settler).jobType));
}

/** Who goes home from the colony: its men past work but a husband whose wife lives there, as a couple split
 *  by water bears no child, or every survivor of an abandoned one. */
function homeward(env: ColonyEnv, colony: ColonyView, ship: Entity): Entity[] {
  if (colony.phase === 'abandoned') return survivorsFor(env, ship);
  const { world, ctx, seat } = env;
  const here = new Set(colonySettlersOn(world, ctx, seat, colony.land));
  return menPastWork(env, colony).filter((e) => {
    const wife = world.tryGet(e, Marriage)?.spouse;
    return wife === undefined || !here.has(wife);
  });
}

/** The free seats of `ship` for passengers: the fewest once fire has found the colony's ships. */
function freeSeats(env: ColonyEnv, colony: ColonyView, ship: Entity): number {
  const state = env.world.get(ship, Vehicle);
  const empty = state.passengers.length - vehiclePassengers(state).length;
  return colony.dangers.length > 0 ? Math.min(empty, RIDERS_NEAR_FIRE) : empty;
}

/** Drop from the colony's lists whoever no ship holds and no colony land bears, as a boarding the door
 *  refused, and `gone` besides: those are home's again. Only a change writes. */
function forgetListed(env: ColonyEnv, colony: ColonyView, gone: readonly Entity[]): void {
  const { world, ctx } = env;
  const stays = (e: Entity): boolean =>
    world.isAlive(e) && !gone.includes(e) && (world.has(e, Rider) || standsOn(world, ctx, e, colony.land));
  if (colony.people.every(stays) && colony.rest.every(stays) && colony.garrison.every(stays)) return;
  const live = env.edit();
  live.people = live.people.filter(stays);
  live.rest = live.rest.filter(stays);
  live.garrison = live.garrison.filter(stays);
}

/** The share of home's men the seat's colonies may hold in hands the ferry brings (authored: about what
 *  the colony line delivered). Home's men are its army and its births, so past this a colony waits for its
 *  own sons. */
const COLONY_MEN_SHARE: Share = { num: 1, den: 4 };

/** How many more hands the seat's colonies may take: {@link COLONY_MEN_SHARE} of home's men, less the men
 *  its colonies hold. */
function colonyMenRoom(env: ColonyEnv): number {
  const { world, ctx, seat } = env;
  const man = (e: Entity): boolean => !world.has(e, Female) && isAdultSettler(world, e);
  const home = homeSettlers(world, ctx, seat).filter(man).length;
  let away = 0;
  for (const land of colonyLands(world, seat))
    away += colonySettlersOn(world, ctx, seat, land).filter((e) => colonyHand(world, ctx, e)).length;
  return shareOf(home, COLONY_MEN_SHARE) - away;
}

/** Who home owes the colony now, in `seats`: the craftsmen no colonist can stand in for, the garrison and the
 *  hands it lacks; listed as the colony's, with the lessons that make the next craftsman. */
function outward(
  env: ColonyEnv,
  colony: ColonyView,
  seats: number,
): { riders: Entity[]; lessons: PlayerCommand[] } {
  const { world, ctx, seat } = env;
  const home = homeLandOf(env);
  const people = colonists(env);
  const men = people.filter((e) => colonyHand(world, ctx, e)).length;
  const women = people.filter((e) => world.has(e, Female) && isAdultSettler(world, e)).length;
  const wanted = handsWanted(env, colony);
  const room = colonyMenRoom(env);
  // Women sail for the colony's free home slots past the men's share, a wife with her husband: the share
  // keeps home's hands, a married man is the last home drafts, and a roomy colony grows people (owner ruling).
  const lacking = { men: Math.min(wanted.men - men, room), women: wanted.women - women };
  const trades = tradesmenFor(env, people, home, seats);
  const tradesmen = [...trades.sailing];
  const garrison = garrisonOwed(env, colony).slice(0, Math.max(0, seats - tradesmen.length));
  const party = topUpParty(
    world,
    ctx,
    seat,
    home,
    lacking,
    seats - tradesmen.length - garrison.length,
  ).filter((e) => !tradesmen.includes(e) && !garrison.includes(e));
  if (tradesmen.length + party.length > 0) env.edit().rest.push(...tradesmen, ...party);
  if (garrison.length > 0) env.edit().garrison.push(...garrison);
  return { riders: [...tradesmen, ...garrison, ...party], lessons: [...trades.lessons] };
}

/** A ship takes up the ferry at `side`, boarding `riders`. */
function startFerry(
  env: ColonyEnv,
  ship: Entity,
  side: 'home' | 'colony',
  helm: Entity | null,
  riders: readonly Entity[],
): PlayerCommand[] {
  const hull = env.world.tryGet(ship, Health)?.hitpoints ?? 0;
  env.edit().ferry = { ship, side, leg: 'board', since: env.ctx.tick, helm, hull, tried: [] };
  return boardOrders(env.world, helm === null ? riders : [helm, ...riders], ship);
}

/** A ferry starts when someone is owed a crossing and a ship lies free: at home for those it owes the colony
 *  and the men past work there, with a spare man of home at the helm to bring the ship back; or, for an
 *  abandoned colony, at the colony itself, a survivor at the helm. */
function claimFerry(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx, seat } = env;
  if (!lineWayClear(env.terrain, colony.dangers, colony.berth, colony.shore)) return [];
  if (colony.berth === null || colony.shore === null) return [];
  const home = homeLandOf(env);
  const atColony = colony.phase === 'abandoned' ? freeShips(env, colony.land)[0] : undefined;
  if (atColony !== undefined) {
    const survivors = survivorsFor(env, atColony).slice(0, freeSeats(env, colony, atColony));
    return survivors.length === 0 ? [] : startFerry(env, atColony, 'colony', null, survivors);
  }
  const ship = freeShips(env, home)[0];
  if (ship === undefined) return [];
  const back = homeward(env, colony, ship).length;
  if (back === 0 && colony.phase === 'abandoned') return [];
  const helm = sparePartyMen(world, ctx, seat, home)[0] ?? null;
  const seats = freeSeats(env, colony, ship) - (helm === null ? 0 : 1);
  const out = colony.phase === 'abandoned' ? { riders: [], lessons: [] } : outward(env, colony, seats);
  if (out.riders.length === 0 && back === 0) return out.lessons;
  if (helm === null && out.riders.length === 0) return out.lessons;
  return [...out.lessons, ...startFerry(env, ship, 'home', helm, out.riders)];
}

/** The ferry is done: riders off where the ship lies, and it is free again. The riders are home's again
 *  unless `landed` says they step off at the colony. */
function releaseFerry(env: ColonyEnv, colony: ColonyView, ship: Entity, landed = false): PlayerCommand[] {
  const mooring = mooringOf(env.world, ship);
  forgetListed(env, colony, landed ? [] : ridersOf(env.world, ship));
  env.edit().ferry = null;
  return mooring === null ? [] : [unloadAt(ship, mooring)];
}

function enterLeg(env: ColonyEnv, leg: 'board' | 'sail', side: 'home' | 'colony'): void {
  const live = env.edit().ferry;
  if (live === null) return;
  live.leg = leg;
  live.side = side;
  live.since = env.ctx.tick;
  live.tried = [];
}

/** A ferry every shore refused past its crossing's time: one bound for the colony sails its riders home, one
 *  bound home is let go where it lies, its civilians brought in with the seat's stray crews. */
function turnBack(env: ColonyEnv, colony: ColonyView, ferry: FerryView): PlayerCommand[] {
  if (ferry.side === 'home' || colony.berth === null) return releaseFerry(env, colony, ferry.ship);
  enterLeg(env, 'sail', 'home');
  return sailOrders(env, colony, ferry.ship, colony.berth);
}

/** Arrived at the colony: everyone but the helm steps ashore and the homeward men board; with no helm the
 *  crossing ends there. */
function landAtColony(env: ColonyEnv, colony: ColonyView, ferry: FerryView): PlayerCommand[] {
  const { world } = env;
  const helm = ferry.helm !== null && world.isAlive(ferry.helm) ? ferry.helm : null;
  if (helm === null) return releaseFerry(env, colony, ferry.ship, true);
  const off = ridersOf(world, ferry.ship)
    .filter((e) => e !== helm)
    .map((entity): PlayerCommand => ({ kind: 'detachFromVehicle', entity }));
  const seats = freeSeats(env, colony, ferry.ship) + off.length;
  const back = homeward(env, colony, ferry.ship).slice(0, Math.max(0, seats));
  enterLeg(env, 'board', 'colony');
  return [...off, ...boardOrders(world, back, ferry.ship)];
}

/** Arrived home: everyone steps off, and the builders the colony had no work for step off civilians, so
 *  home's workforce posts or drafts them rather than leaving them idle builders, who hold its births. */
function landAtHome(env: ColonyEnv, colony: ColonyView, ferry: FerryView): PlayerCommand[] {
  const { world, ctx } = env;
  const builder = builderJobOf(ctx);
  const retrades = ridersOf(world, ferry.ship)
    .filter((e) => e !== ferry.helm && builder !== null && world.get(e, Settler).jobType === builder)
    .map((entity): PlayerCommand => ({ kind: 'setJob', entity, jobType: CIVILIST_JOB }));
  return [...retrades, ...releaseFerry(env, colony, ferry.ship)];
}

/** Keep the record of the ferry's hull: a drop marks where it lies as danger. Only a change writes. */
function noteHull(env: ColonyEnv, colony: ColonyView, ferry: FerryView): void {
  const hull = env.world.tryGet(ferry.ship, Health)?.hitpoints ?? 0;
  if (hull === ferry.hull) return;
  if (hull < ferry.hull) {
    const at = anchorNodeOf(env.world, ferry.ship);
    const dangers = at === null ? null : withDanger(colony.dangers, at, env.ctx.tick);
    if (dangers !== null) env.edit().dangers = dangers;
  }
  const live = env.edit().ferry;
  if (live !== null) live.hull = hull;
}

/** Forget the dangers whose fire has had time to move on; only a change writes. */
function forgetLapsedDangers(env: ColonyEnv, colony: ColonyView): void {
  const kept = withoutLapsed(colony.dangers, env.ctx.tick);
  if (kept !== null) env.edit().dangers = kept;
}

/**
 * What a colony's ferry does this decision. Boarding, it sails once every rider is aboard, or past
 * {@link FERRY_BOARD_TICKS} without the late ones, and is let go with nobody aboard. Sailing, it docks at the
 * colony's shore or home's berth, another shore of that land when refused, round known fire; late it is let go
 * where it lies moored, or turned back once every shore has refused it ({@link turnBack}), and lost at sea it
 * is let go. At the colony it lands its riders and takes the homeward men; at home everyone steps off and the
 * ship is free.
 */
export function runFerry(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx, seat } = env;
  forgetLapsedDangers(env, colony);
  const ferry = colony.ferry;
  if (ferry === null) return claimFerry(env, colony);
  const ship = ferry.ship;
  if (!world.has(ship, Vehicle)) {
    forgetListed(env, colony, []);
    env.edit().ferry = null;
    return [];
  }
  if (ferry.since === ctx.tick) return [];
  noteHull(env, colony, ferry);
  const state = world.get(ship, Vehicle);
  const toColony = ferry.side === 'home';
  if (ferry.leg === 'board') {
    const riders = vehiclePassengers(state);
    const late = ctx.tick - ferry.since >= FERRY_BOARD_TICKS;
    if (!late && !riders.every((r) => r.inside)) return [];
    const stragglers = riders
      .filter((r) => !r.inside)
      .map((r): PlayerCommand => ({ kind: 'detachFromVehicle', entity: r.entity }));
    if (riders.every((r) => !r.inside)) return [...stragglers, ...releaseFerry(env, colony, ship)];
    const to = toColony ? colony.shore : colony.berth;
    if (to === null) return [...stragglers, ...releaseFerry(env, colony, ship)];
    enterLeg(env, 'sail', toColony ? 'colony' : 'home');
    return [...stragglers, ...sailOrders(env, colony, ship, to)];
  }
  const arriving = ferry.side === 'colony';
  const land = arriving ? colony.land : homeLandOf(env);
  if (mooredOn(env, ship, land))
    return arriving ? landAtColony(env, colony, ferry) : landAtHome(env, colony, ferry);
  const moored = mooringOf(world, ship) !== null;
  const late = ctx.tick - ferry.since >= FERRY_SAIL_TICKS;
  if ((late && moored) || strandedShip(world, ctx, seat, ship)) return releaseFerry(env, colony, ship);
  const at = arriving ? colony.shore : colony.berth;
  if (!lyingStill(world, ship) || at === null) return [];
  const next = otherShore(env, ship, at, ferry.tried);
  if (next === null && late) return turnBack(env, colony, ferry);
  if (next === null) return sailOrders(env, colony, ship, at);
  // The colony's shore stays by its store, where its trader stops and its first tower looks: a refused dock
  // there sends this leg elsewhere and moves nothing.
  if (!arriving) env.edit().berth = { hx: next.hx, hy: next.hy };
  env.edit().ferry?.tried.push({ hx: next.hx, hy: next.hy });
  return sailOrders(env, colony, ship, next);
}
