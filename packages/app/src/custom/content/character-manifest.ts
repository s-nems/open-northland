import {
  type CustomCharacterManifest,
  type CustomStoredClip,
  customCharacterFrameCount,
} from '@open-northland/art-contracts/custom';

export { type CustomCharacterManifest, customCharacterManifest } from '@open-northland/art-contracts/custom';

import type {
  AtlasFrame,
  DirectionalAnim,
  SettlerStateBinding,
  SpriteAtlas,
  SpriteFrameRef,
} from '@open-northland/render';
import { TICKS_PER_SECOND } from '@open-northland/sim';
import type { GoodRef } from '../../content/settler-gfx/index.js';

const FACINGS = 8;

export function customCharacterAtlas(m: CustomCharacterManifest): SpriteAtlas {
  const frames = new Map<number, AtlasFrame>();
  const count = customCharacterFrameCount(m);
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

export function customCharacterShadowAtlas(m: CustomCharacterManifest): SpriteAtlas | undefined {
  if (!m.shadow) return undefined;
  return customCharacterAtlas({ ...m, ...m.shadow });
}

type StoredClip = Readonly<CustomStoredClip>;

function clipRef(m: CustomCharacterManifest, clip: StoredClip, start: number): DirectionalAnim {
  return {
    ...(clip.frameOrder === undefined ? {} : { frameOrder: clip.frameOrder }),
    ...(clip.frameDurations === undefined
      ? {}
      : { frameDurations: clip.frameDurations.map((seconds) => seconds * TICKS_PER_SECOND) }),
    subtick: m.smoothMotion === true,
    start,
    dirs: FACINGS,
    stride: clip.frames,
    ticksPerFrame: (clip.duration * TICKS_PER_SECOND) / clip.frames,
  };
}

interface LoadedLook {
  readonly idle: SpriteFrameRef;
  readonly moving: SpriteFrameRef;
}

function walkClip(m: CustomCharacterManifest): StoredClip {
  return {
    frames: m.walkFrames,
    duration: m.walkDuration,
    frameDurations: m.walkFrameDurations,
    frameOrder: m.walkFrameOrder,
  };
}

function carryStart(m: CustomCharacterManifest): number {
  return customCharacterFrameCount({ ...m, carryClips: [] });
}

/** The loaded looks by good slug: the walk's clip fields over the carry cells, and the first pose while
 *  standing loaded (the original-asset binding's rule; the source has no loaded wait). */
export function customCharacterCarryLooks(m: CustomCharacterManifest): ReadonlyMap<string, LoadedLook> {
  const looks = new Map<string, LoadedLook>();
  const walk = walkClip(m);
  const travel = m.walkTravelPerCycle === undefined ? {} : { travelPerCycle: m.walkTravelPerCycle };
  let start = carryStart(m);
  for (const clip of m.carryClips ?? []) {
    const moving: DirectionalAnim = { ...clipRef(m, walk, start), ...travel };
    const idle: DirectionalAnim = { start, dirs: FACINGS, stride: clip.frames, frames: 1 };
    looks.set(clip.good, { moving, idle });
    start += clip.frames * FACINGS;
  }
  return looks;
}

/** `goods` joins each carry clip's slug to the running content set; a slug the set lacks binds nothing. */
export function customCharacterBinding(
  m: CustomCharacterManifest,
  goods: readonly GoodRef[],
): SettlerStateBinding {
  const idle: StoredClip = {
    frames: m.idleFrames,
    duration: m.idleDuration,
    frameDurations: m.idleFrameDurations,
    frameOrder: m.idleFrameOrder,
  };
  const walk = walkClip(m);
  const travel = m.walkTravelPerCycle === undefined ? {} : { travelPerCycle: m.walkTravelPerCycle };
  const moving: DirectionalAnim = { ...clipRef(m, walk, 0), ...travel };
  let start = walk.frames * FACINGS;
  const idleRef = clipRef(m, idle, start);
  start += idle.frames * FACINGS;
  const byAtomic: Record<number, SpriteFrameRef> = {};
  const storedStart = new Map<number, number>();
  for (const clip of m.atomicClips ?? []) {
    if (clip.poses !== undefined) {
      const shared = storedStart.get(clip.poses);
      if (shared === undefined) throw new Error('Shared poses name no stored clip');
      byAtomic[clip.atomicId] = clipRef(m, clip, shared);
      continue;
    }
    byAtomic[clip.atomicId] = clipRef(m, clip, start);
    storedStart.set(clip.atomicId, start);
    start += clip.frames * FACINGS;
  }
  const byGood: Record<number, LoadedLook> = {};
  for (const [slug, look] of customCharacterCarryLooks(m)) {
    const good = goods.find((g) => g.id === slug);
    if (good !== undefined) byGood[good.typeId] = look;
  }
  return {
    ...(m.atomicClips?.length ? { byAtomic } : {}),
    ...(Object.keys(byGood).length > 0 ? { carrying: { byGood } } : {}),
    moving,
    idle: idleRef,
  };
}
