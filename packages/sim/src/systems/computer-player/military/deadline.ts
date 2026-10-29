import { diplomacyStance, mapBriefOf, seatPeaceEndTick } from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { minutesToTicks } from '../game-phase.js';
import { seatMapIntentOf, seatTerritoryOf, type Trigger } from '../knowledge/map-intent/index.js';

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
 *  finish just before the deadline, never earlier, since an early tower wastes builders and goods): near a
 *  60-minute deadline on magiczny_las a tower site took 6-22 game minutes to stand and the ring waits for
 *  the barracks' site first; at a 12-minute lead the first towers stood at minutes 60-81, at this one 55-74. */
export const TOWER_LEAD_TICKS = minutesToTicks(20);

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
 * it by an enemy or an unknown owner, whichever comes first. Derived from the map's scripts, the seat's
 * start and live relations; nothing is saved.
 */
export function militaryDeadlineTick(world: World, ctx: SystemContext, seat: number): number {
  const peaceEnd = peaceDeadlineTick(world, seat);
  const territory = seatTerritoryOf(mapBriefOf(world), seat);
  if (territory === null) return peaceEnd;
  const attacks: Trigger[] = [];
  for (const threat of seatMapIntentOf(ctx, seat, territory).threats) {
    if (threat.player !== null && diplomacyStance(world, seat, threat.player) !== 'enemy') continue;
    attacks.push(threat.trigger);
  }
  return earliestDeadline(peaceEnd, attacks);
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
