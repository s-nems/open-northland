import { CoinDrillOrder, Settler } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { coinDrillClip } from '../../../progression/coin-drill.js';
import { grantDrillPoints } from '../../../progression/experience.js';
import {
  ATOMIC_EVENT_TYPE_CHANGE_GOLD,
  ATOMIC_EVENT_TYPE_GET_TRAINING,
  clipFrameAt,
} from '../../../readviews/animations.js';
import { payDrillCoins, turnBackFromCoinDrill } from '../../drives/coin-drill.js';

/**
 * Apply the coin-drill clip's events at this tick's frame: `CHANGE_GOLD` takes its coins off `house`'s
 * shelf and `GET_TRAINING` adds its points to the soldier's personal fight counter. False when the
 * repetition is void: his order is gone, or the coin was taken first, which turns him back.
 */
export function applyCoinDrillEvents(
  world: World,
  ctx: SystemContext,
  e: Entity,
  house: Entity,
  elapsed: number,
): boolean {
  if (world.tryGet(e, CoinDrillOrder)?.house !== house) return false;
  const settler = world.tryGet(e, Settler);
  const clip = settler === undefined ? undefined : coinDrillClip(ctx.content, settler);
  if (clip === undefined) return false;
  const frame = clipFrameAt(elapsed, clip.length);
  for (const event of clip.events) {
    if (event.at !== frame) continue;
    const value = event.value ?? 0;
    if (event.type === ATOMIC_EVENT_TYPE_CHANGE_GOLD && value < 0) {
      if (payDrillCoins(world, ctx, e, house, -value)) continue;
      turnBackFromCoinDrill(world, e);
      return false;
    }
    if (event.type === ATOMIC_EVENT_TYPE_GET_TRAINING && value > 0) grantDrillPoints(world, e, value);
  }
  return true;
}
