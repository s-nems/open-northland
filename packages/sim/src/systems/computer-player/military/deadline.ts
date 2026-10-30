import { diplomacyStance, mapBriefOf, seatPeaceEndTick } from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { minutesToTicks } from '../game-phase.js';
import {
  type IntentPoint,
  type SeatThreat,
  seatMapIntentOf,
  seatTerritoryOf,
  type Trigger,
} from '../knowledge/map-intent/index.js';

/** The peace a seat outside a lobby peace plans for (owner ruling): an hour of game time, economy first,
 *  as under the lobby's usual peace. Being attacked still brings the defence forward at once. */
export const ASSUMED_PEACE_TICKS = minutesToTicks(60);

/** How long before its deadline the seat's barracks stands (owner ruling): about 15 game minutes, so a
 *  peace of 60 minutes sees it by minute 45, the army drilling in it before the peace ends. */
export const BARRACKS_STANDS_BEFORE_TICKS = minutesToTicks(15);

/** How long a barracks site takes to rise (measured): 2.5-20 game minutes from placement to standing on
 *  magiczny_las and mroczny_las, about 7 the median. */
const BARRACKS_SITE_TICKS = minutesToTicks(7);

/** How long before its deadline the seat places its barracks, and its defence lines go first ahead of a
 *  forecast attack (`build-order/seat-order.ts`): the barracks then stands about
 *  {@link BARRACKS_STANDS_BEFORE_TICKS} ahead of it. */
export const BARRACKS_LEAD_TICKS = BARRACKS_STANDS_BEFORE_TICKS + BARRACKS_SITE_TICKS;

/** How long before its deadline the seat raises its first tower ring (measured, owner ruling: towers
 *  finish just before the deadline, never much earlier, since an early tower wastes builders and goods):
 *  on krwawa_rzeka under a 60-minute peace a lower tower placed at minute 45 stood at minutes 54-64, so a
 *  ring opening at this lead stands about as the peace ends. */
export const TOWER_LEAD_TICKS = minutesToTicks(20);

/** {@link TOWER_LEAD_TICKS} for a ring that rises at the upper tier, a seat whose attacks come late
 *  (`build-order/direct-tier.ts`; measured): on magiczny_las under a 60-minute peace upper towers placed at
 *  minute 40 stood at minutes 59-69, one seat's not by minute 90. */
export const UPPER_TOWER_LEAD_TICKS = minutesToTicks(30);

/** The tick `seat`'s peace ends for its planning: the lobby peace binding it ({@link seatPeaceEndTick}),
 *  else {@link ASSUMED_PEACE_TICKS}. Unlike `seatPeaceEndTick`, whose 0 lets a seat without a peace march
 *  at once, this is when the seat must be ready. */
export function peaceDeadlineTick(world: World, seat: number): number {
  const end = seatPeaceEndTick(world, seat);
  return end > 0 ? end : ASSUMED_PEACE_TICKS;
}

/** The first tick a forecast scripted attack may land: an exact tick or a window's start; null for a
 *  trigger with no forecast tick (`conditional` waits on world state, as `nearestThreatIn` leaves out). */
function forecastAttackTick(trigger: Trigger): number | null {
  if (trigger.kind === 'atTick') return trigger.tick;
  if (trigger.kind === 'window') return trigger.fromTick;
  return null;
}

/** The earlier of `peaceEnd` and the first forecast tick among `attacks`. A past attack keeps the deadline
 *  past, so the seat stays ready between scripted waves. */
export function earliestDeadline(peaceEnd: number, attacks: readonly Trigger[]): number {
  let deadline = peaceEnd;
  for (const trigger of attacks) {
    const at = forecastAttackTick(trigger);
    if (at !== null && at < deadline) deadline = at;
  }
  return deadline;
}

/**
 * The tick by which `seat` must stand ready to fight (owner ruling: economy first, the military shortly
 * before this): the end of its peace ({@link peaceDeadlineTick}) or the first forecast scripted attack on
 * it ({@link firstForecastAttackTick}), whichever comes first. Nothing is saved.
 */
export function militaryDeadlineTick(world: World, ctx: SystemContext, seat: number): number {
  const peaceEnd = peaceDeadlineTick(world, seat);
  const attack = firstForecastAttackTick(world, ctx, seat);
  return attack === null ? peaceEnd : Math.min(peaceEnd, attack);
}

/** The first tick a forecast scripted attack on `seat` may land, past ones included, or null for none. */
function firstForecastAttackTick(world: World, ctx: SystemContext, seat: number): number | null {
  const first = earliestDeadline(
    Number.POSITIVE_INFINITY,
    forecastThreats(world, ctx, seat).map((threat) => threat.trigger),
  );
  return first === Number.POSITIVE_INFINITY ? null : first;
}

/** The distinct ticks the forecast scripted attacks on `seat` may first land, ascending, past ones included;
 *  a conditional attack has none. */
export function forecastAttackTicks(world: World, ctx: SystemContext, seat: number): number[] {
  const ticks = new Set<number>();
  for (const threat of forecastThreats(world, ctx, seat)) {
    const at = forecastAttackTick(threat.trigger);
    if (at !== null) ticks.add(at);
  }
  return [...ticks].sort((a, b) => a - b);
}

/**
 * Where `seat`'s forecast scripted attacks set out from: the mean over every forecast attack naming any
 * origin of the rounded mean of the points its scripts name ({@link SeatThreat.from}), or null when none does.
 * Owner ruling: the towers stand as a line on the side the attacks come from, so the line faces all the
 * waves, not only the first.
 */
export function forecastAttackOrigin(world: World, ctx: SystemContext, seat: number): IntentPoint | null {
  let hx = 0;
  let hy = 0;
  let attacks = 0;
  for (const threat of forecastThreats(world, ctx, seat)) {
    if (threat.from.length === 0) continue;
    let sx = 0;
    let sy = 0;
    for (const point of threat.from) {
      sx += point.hx;
      sy += point.hy;
    }
    hx += Math.round(sx / threat.from.length);
    hy += Math.round(sy / threat.from.length);
    attacks++;
  }
  if (attacks === 0) return null;
  return { hx: Math.round(hx / attacks), hy: Math.round(hy / attacks) };
}

/** The scripted attacks forecast on `seat` by an enemy or an unknown owner, from the map's scripts, the
 *  seat's start and live relations. */
function forecastThreats(world: World, ctx: SystemContext, seat: number): SeatThreat[] {
  const territory = seatTerritoryOf(mapBriefOf(world), seat);
  if (territory === null) return [];
  return seatMapIntentOf(ctx, seat, territory).threats.filter(
    (threat) => threat.player === null || diplomacyStance(world, seat, threat.player) === 'enemy',
  );
}

/** Whether the clock still lies more than `leadTicks` before `seat`'s {@link militaryDeadlineTick}. */
export function beforeDeadlineLead(
  world: World,
  ctx: SystemContext,
  seat: number,
  leadTicks: number,
): boolean {
  return ctx.tick < militaryDeadlineTick(world, ctx, seat) - leadTicks;
}
