import type { OwnCharacterManifest } from '@open-northland/art-contracts';

export { type OwnCharacterManifest, ownCharacterManifest } from '@open-northland/art-contracts';

import type { AtlasFrame, SettlerStateBinding, SpriteAtlas, SpriteFrameRef } from '@open-northland/render';
import { TICKS_PER_SECOND } from '@open-northland/sim';

export function ownCharacterAtlas(m: OwnCharacterManifest): SpriteAtlas {
  const frames = new Map<number, AtlasFrame>();
  const count =
    8 * (m.walkFrames + m.idleFrames + (m.atomicClips ?? []).reduce((sum, clip) => sum + clip.frames, 0));
  if (m.columns * m.cellWidth !== m.width || Math.ceil(count / m.columns) * m.cellHeight !== m.height) {
    throw new Error('Character atlas dimensions disagree with clip coverage');
  }
  for (let i = 0; i < count; i++)
    frames.set(i, {
      x: (i % m.columns) * m.cellWidth,
      y: Math.floor(i / m.columns) * m.cellHeight,
      width: m.cellWidth,
      height: m.cellHeight,
      offsetX: -m.anchorX,
      offsetY: -m.anchorY,
    });
  return { width: m.width, height: m.height, frames };
}

export function ownCharacterShadowAtlas(m: OwnCharacterManifest): SpriteAtlas | undefined {
  if (!m.shadow) return undefined;
  return ownCharacterAtlas({ ...m, ...m.shadow });
}

export function ownCharacterBinding(m: OwnCharacterManifest): SettlerStateBinding {
  const byAtomic: Record<number, SpriteFrameRef> = {};
  let start = 8 * (m.walkFrames + m.idleFrames);
  for (const clip of m.atomicClips ?? []) {
    byAtomic[clip.atomicId] = {
      start,
      dirs: 8,
      stride: clip.frames,
      subtick: m.smoothMotion === true,
      ticksPerFrame: (clip.duration * TICKS_PER_SECOND) / clip.frames,
      ...(clip.frameDurations === undefined
        ? {}
        : { frameDurations: clip.frameDurations.map((hold) => hold * TICKS_PER_SECOND) }),
    };
    start += clip.frames * 8;
  }
  return {
    ...(m.atomicClips?.length ? { byAtomic } : {}),
    moving: {
      ...(m.walkTravelPerCycle === undefined ? {} : { travelPerCycle: m.walkTravelPerCycle }),
      subtick: m.smoothMotion === true,
      start: 0,
      dirs: 8,
      stride: m.walkFrames,
      ticksPerFrame: (m.walkDuration * TICKS_PER_SECOND) / m.walkFrames,
    },
    idle: {
      ...(m.idleFrameDurations === undefined
        ? {}
        : { frameDurations: m.idleFrameDurations.map((seconds) => seconds * TICKS_PER_SECOND) }),
      subtick: m.smoothMotion === true,
      start: 8 * m.walkFrames,
      dirs: 8,
      stride: m.idleFrames,
      ticksPerFrame: (m.idleDuration * TICKS_PER_SECOND) / m.idleFrames,
    },
  };
}
