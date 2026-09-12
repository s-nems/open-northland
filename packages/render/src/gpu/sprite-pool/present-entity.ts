import type { DrawItem } from '../../data/scene/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import { atomicPose, interpolateAtomicPose } from './atomic-pose.js';
import { characterGaitRate, characterInterpolatesMotion } from './character-layers.js';
import { drawAlphaForKind, trackMotion } from './motion.js';
import type { PooledEntity } from './pooled-entity.js';
import { easeReveal, motionClocks, revealedItem, walkPose } from './presentation.js';
import { resolveLayers } from './resolve-layers.js';
import type { PoolFrame } from './sprite-pool.js';

export function presentEntity(
  pe: PooledEntity,
  item: DrawItem,
  frame: PoolFrame,
  sheet: SpriteSheet | undefined,
) {
  if (pe.motion.tick === -1) pe.atomicPose.item = undefined;
  const atomic = atomicPose(item, frame.tick, pe.atomicPose);
  const smooth = characterInterpolatesMotion(sheet?.characters, item);
  const alpha = drawAlphaForKind(pe.kind, frame.alpha, smooth);
  const pose = smooth ? interpolateAtomicPose(atomic, alpha) : atomic;
  trackMotion(
    pe.motion,
    frame.tick,
    item.x,
    item.y - (item.lift ?? 0),
    alpha,
    characterGaitRate(sheet?.characters, item, pe.lastFacing),
  );
  pe.container.position.set(pe.motion.drawX, pe.motion.drawY);
  if (item.facing !== undefined) pe.lastFacing = item.facing;
  // `upgradePct` and `builtPct` are mutually exclusive by construction, so an upgrade site rides the
  // same eased reveal as a from-scratch one.
  pe.reveal = easeReveal(pe.reveal, item.builtPct ?? item.upgradePct);
  const clocks = motionClocks(item, frame.tick, alpha, pe.motion, smooth);
  return resolveLayers(
    sheet,
    revealedItem(walkPose(pose, pe.kind, pe.motion, pe.lastFacing), pe.reveal),
    clocks.animation,
    clocks.gait,
  );
}
