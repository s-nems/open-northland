import { type MapBriefView, mapBriefOf, zoneOfNode } from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { World } from '../../../ecs/world.js';
import { scoutLossZones, scoutTurnBackZones } from '../knowledge/intel/index.js';

/** How long the seat sends no scout into a zone where it lost one (owner ruling: a scout sent after scout
 *  into a wolf den feeds the wolves; authored length): thirty game minutes, then one more look. */
export const SCOUT_LOSS_MEMORY_TICKS = 30 * 60 * TICKS_PER_SECOND;

/** How long the scout aims no look at a zone whose goal turned him back (authored, untuned): ten game
 *  minutes, so he looks at the other due zones before trying the same route past a tower again. */
export const SCOUT_TURN_BACK_MEMORY_TICKS = 10 * 60 * TICKS_PER_SECOND;

/** A set of zones the scout keeps out of, asked by zone or by node. */
export interface LostZones {
  readonly zone: (zone: number) => boolean;
  readonly node: (hx: number, hy: number) => boolean;
}

const NOWHERE: LostZones = { zone: () => false, node: () => false };

/** The zones the seat lost a scout in within {@link SCOUT_LOSS_MEMORY_TICKS} at `tick`; none without a map
 *  brief or a recent loss. */
export function scoutLostZones(world: World, player: number, tick: number): LostZones {
  const brief = mapBriefOf(world);
  if (brief === null) return NOWHERE;
  return zoneSet(brief, scoutLossZones(world, player, tick, SCOUT_LOSS_MEMORY_TICKS));
}

/** The zones the seat's scout turned back from a goal in within {@link SCOUT_TURN_BACK_MEMORY_TICKS} at
 *  `tick`. */
export function scoutTurnedBackZones(world: World, player: number, tick: number): LostZones {
  const brief = mapBriefOf(world);
  if (brief === null) return NOWHERE;
  return zoneSet(brief, scoutTurnBackZones(world, player, tick, SCOUT_TURN_BACK_MEMORY_TICKS));
}

function zoneSet(brief: MapBriefView, zones: readonly number[]): LostZones {
  if (zones.length === 0) return NOWHERE;
  return {
    zone: (zone) => zones.includes(zone),
    node: (hx, hy) => zones.includes(zoneOfNode(brief, hx, hy)),
  };
}
