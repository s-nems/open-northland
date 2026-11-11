import type { DrawItem } from '../../../data/scene/index.js';
import type { SpriteSheet } from '../../textures/sprite-sheet.js';
import type { PooledEntity } from '../pooled-entity.js';
import type { PoolFrame } from '../sprite-pool.js';
import { presentItem } from './present-item.js';

export function presentEntity(
  pe: PooledEntity,
  item: DrawItem,
  frame: PoolFrame,
  sheet: SpriteSheet | undefined,
) {
  const layers = presentItem(
    pe,
    item,
    frame.tick,
    frame.alpha,
    sheet,
    frame.environmentMotion === true,
    frame.environmentMotion === true || frame.sailWind === true ? frame.wind : undefined,
    frame.seaClock,
    frame.detail?.motion === false,
  );
  pe.container.position.set(pe.motion.drawX, pe.motion.drawY);
  return layers;
}
