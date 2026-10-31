import { mapBriefOf, zoneOfNode } from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { World } from '../../../ecs/world.js';
import { scoutLossZones } from '../knowledge/intel/index.js';

/** How long the seat sends no scout into a zone where it lost one (owner ruling: a scout sent after scout
 *  into a wolf den feeds the wolves; authored length): thirty game minutes, then one more look. */
export const SCOUT_LOSS_MEMORY_TICKS = 30 * 60 * TICKS_PER_SECOND;

/** The zones the seat lost a scout in within {@link SCOUT_LOSS_MEMORY_TICKS}, asked by zone or by node. */
export interface LostZones {
  readonly zone: (zone: number) => boolean;
  readonly node: (hx: number, hy: number) => boolean;
}

const NOWHERE: LostZones = { zone: () => false, node: () => false };

/** The seat's {@link LostZones} at `tick`; none without a map brief or a recent loss. */
export function scoutLostZones(world: World, player: number, tick: number): LostZones {
  const brief = mapBriefOf(world);
  if (brief === null) return NOWHERE;
  const zones = scoutLossZones(world, player, tick, SCOUT_LOSS_MEMORY_TICKS);
  if (zones.length === 0) return NOWHERE;
  return {
    zone: (zone) => zones.includes(zone),
    node: (hx, hy) => zones.includes(zoneOfNode(brief, hx, hy)),
  };
}
