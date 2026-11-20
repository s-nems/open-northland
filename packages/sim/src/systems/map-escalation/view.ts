import type { ContentSet, MapSiege } from '@open-northland/data';
import { mapEscalationProgress } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { keepStands } from './keep.js';
import { attackEndsTick, launchTick } from './schedule.js';

/** What the HUD and render read of a map's siege. */
export interface MapEscalationView {
  /** The running attack's number, else the last launch that fell due; 0 before the first. */
  readonly wave: number;
  readonly attackRunning: boolean;
  /** The tick the running attack ends by at the latest; null between attacks. */
  readonly attackEndsByTick: number | null;
  /** The tick the next attack launches on, should a keep stand then. */
  readonly nextAttackTick: number;
  /** A finished keep stands, so the next launch sends men; while none does, the schedule only ticks on. */
  readonly scheduleLive: boolean;
}

export function mapEscalationView(world: World, content: ContentSet, siege: MapSiege): MapEscalationView {
  const { launches, attack } = mapEscalationProgress(world);
  return {
    wave: attack?.wave ?? launches,
    attackRunning: attack !== null,
    attackEndsByTick: attack === null ? null : attackEndsTick(siege, attack.launchedTick),
    nextAttackTick: launchTick(siege, launches),
    scheduleLive: keepStands(world, content, siege),
  };
}
