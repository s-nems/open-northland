import {
  aiControlEntity,
  ComputerStrategy,
  diplomacyStance,
  mapBriefOf,
  seatPeaceEndTick,
} from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { minutesToTicks } from '../game-phase.js';
import { seatMapIntentOf, seatTerritoryOf, type Trigger } from '../knowledge/map-intent/index.js';

/** The peace a seat outside a lobby peace plans for (owner ruling): an hour of game time, economy first,
 *  as under the lobby's usual peace. Being attacked still brings the defence forward at once. */
export const ASSUMED_PEACE_TICKS = minutesToTicks(60);

/** The tick `seat`'s peace ends for its planning: the lobby peace binding it ({@link seatPeaceEndTick}),
 *  else {@link ASSUMED_PEACE_TICKS}. Unlike `seatPeaceEndTick`, whose 0 lets a seat without a peace march
 *  at once, this is when the seat must be ready. */
export function peaceDeadlineTick(world: World, seat: number): number {
  const end = seatPeaceEndTick(world, seat);
  return end > 0 ? end : ASSUMED_PEACE_TICKS;
}

/** The first tick a forecast scripted attack may land: an exact tick or a window's start; null for a
 *  trigger with no forecast tick (`conditional` waits on world state, as `nearestThreatIn` leaves out). */
export function forecastAttackTick(trigger: Trigger): number | null {
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

/** Whether `seat` is fighting off a raid on its settlement now, as its last posture review saw it (the
 *  `underAttack` evidence of a `defend` posture). False before its strategy is decided. */
export function seatUnderAttack(world: World, seat: number): boolean {
  const carrier = aiControlEntity(world, seat);
  const military = carrier === null ? undefined : world.tryGet(carrier, ComputerStrategy)?.military;
  return military?.posture === 'defend' && military.evidence.includes('underAttack');
}
