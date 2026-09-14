import {
  type OwnCharacterManifest,
  type OwnStoredClip,
  ownCharacterFrameCount,
} from '@open-northland/art-contracts';

export { type OwnCharacterManifest, ownCharacterManifest } from '@open-northland/art-contracts';

import type {
  AtlasFrame,
  DirectionalAnim,
  SettlerStateBinding,
  SpriteAtlas,
  SpriteFrameRef,
} from '@open-northland/render';
import { TICKS_PER_SECOND } from '@open-northland/sim';
import type { GoodRef } from '../settler-gfx/index.js';

const FACINGS = 8;

export function ownCharacterAtlas(m: OwnCharacterManifest): SpriteAtlas {
  const frames = new Map<number, AtlasFrame>();
  const count = ownCharacterFrameCount(m);
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

type StoredClip = Readonly<OwnStoredClip>;

function clipRef(m: OwnCharacterManifest, clip: StoredClip, start: number): DirectionalAnim {
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

function walkClip(m: OwnCharacterManifest): StoredClip {
  return {
    frames: m.walkFrames,
    duration: m.walkDuration,
    frameDurations: m.walkFrameDurations,
    frameOrder: m.walkFrameOrder,
  };
}

function carryStart(m: OwnCharacterManifest): number {
  const atomicFrames = (m.atomicClips ?? []).reduce((sum, clip) => sum + clip.frames, 0);
  return FACINGS * (m.walkFrames + m.idleFrames + atomicFrames);
}

/** The loaded looks by good slug: the walk's clip fields over the carry cells, and the first pose while
 *  standing loaded (the original-asset binding's rule; the source has no loaded wait). */
export function ownCharacterCarryLooks(m: OwnCharacterManifest): ReadonlyMap<string, LoadedLook> {
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
export function ownCharacterBinding(m: OwnCharacterManifest, goods: readonly GoodRef[]): SettlerStateBinding {
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
  for (const clip of m.atomicClips ?? []) {
    byAtomic[clip.atomicId] = clipRef(m, clip, start);
    start += clip.frames * FACINGS;
  }
  const byGood: Record<number, LoadedLook> = {};
  for (const [slug, look] of ownCharacterCarryLooks(m)) {
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
