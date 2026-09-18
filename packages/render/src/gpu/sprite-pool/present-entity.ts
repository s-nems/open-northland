import type { DrawItem } from '../../data/scene/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { PooledEntity } from './pooled-entity.js';
import { presentItem } from './present-item.js';
import type { PoolFrame } from './sprite-pool.js';
import { DEFAULT_WALK_PLACEMENT, walkPlacementAlpha } from './walk-placement.js';

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
    frame.walkPlacement,
  );
  pe.container.position.set(pe.motion.drawX, pe.motion.drawY);
  return layers;
}
