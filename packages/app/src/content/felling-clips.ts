import type { MapObjectSprite, SpriteLayer } from '@open-northland/render';
import {
  drawsAsFlatDecor,
  drawsInGroundPass,
  playsOnceThenRests,
  servedAtlasStem,
  servedShadowStem,
} from './ir/joins.js';
import { loadLayer, MissingAtlasError } from './ir/load.js';
import type { ContentIr, LandscapeGfxRow } from './ir/rows.js';
import { pairedStateFrames } from './objects.js';
import { representativeRecord } from './resource-gfx/refs.js';
import type { GoodRef } from './settler-gfx/index.js';

/** A falling clip as the map-object layer draws it, placed and timed by the caller. */
export type FellingClipArt = Pick<MapObjectSprite, 'source' | 'frames' | 'shadow' | 'decor' | 'groundPass'>;

export interface FellingClips {
  /** The clip of the felled record `gfxIndex`; without one, of the record the renderer draws `goodType`'s
   *  nodes by. Undefined when that record has no clip or its atlas did not load. */
  clipOf(gfxIndex: number | undefined, goodType: number): FellingClipArt | undefined;
}

/** A clip record's full-state frames from its loaded atlas, or undefined when none draws. */
function clipArt(record: LandscapeGfxRow, layer: SpriteLayer): FellingClipArt | undefined {
  const bobIds = record.frames?.[0]?.bobIds;
  const paired = bobIds === undefined ? null : pairedStateFrames(layer, bobIds);
  if (paired === null) return undefined;
  const shadowSource = layer.shadow?.source;
  const hasShadow = shadowSource !== undefined && paired.shadowFrames.some((s) => s !== undefined);
  return {
    source: layer.source,
    frames: paired.frames,
    ...(hasShadow ? { shadow: { source: shadowSource, frames: paired.shadowFrames } } : {}),
    decor: drawsAsFlatDecor(record),
    ...(drawsInGroundPass(record) ? { groundPass: true } : {}),
  };
}

/**
 * The falling clips felled trees play: each record's `GfxTransition 11` target when that is a one-shot
 * stage ({@link playsOnceThenRests}, a `<tree> falling` record), resolved once against its atlas. The
 * atlases are the standing trees' own pages under other palettes, which the sprite sheet loads already,
 * so the loads are memo hits.
 */
export async function loadFellingClips(ir: ContentIr, goods: readonly GoodRef[]): Promise<FellingClips> {
  const byIndex = new Map((ir.landscapeGfx ?? []).map((row) => [row.index, row]));
  const clipRecordOf = new Map<number, LandscapeGfxRow>();
  const shadowOfStem = new Map<string, string | undefined>();
  for (const record of byIndex.values()) {
    const clip = record.cutTarget === undefined ? undefined : byIndex.get(record.cutTarget);
    if (clip === undefined || !playsOnceThenRests(clip)) continue;
    clipRecordOf.set(record.index, clip);
    const stem = servedAtlasStem(clip);
    if (stem !== undefined && !shadowOfStem.has(stem))
      shadowOfStem.set(stem, servedShadowStem(clip.shadowBmd));
  }
  const layers = new Map<string, SpriteLayer>();
  await Promise.all(
    [...shadowOfStem].map(async ([stem, shadowStem]) => {
      try {
        layers.set(stem, await loadLayer(stem, shadowStem));
      } catch (err) {
        if (!(err instanceof MissingAtlasError)) throw err;
      }
    }),
  );
  // Several trees fall through one record, so the art is resolved per clip record.
  const artByClip = new Map<number, FellingClipArt>();
  for (const clip of clipRecordOf.values()) {
    if (artByClip.has(clip.index)) continue;
    const stem = servedAtlasStem(clip);
    const layer = stem === undefined ? undefined : layers.get(stem);
    const art = layer === undefined ? undefined : clipArt(clip, layer);
    if (art !== undefined) artByClip.set(clip.index, art);
  }
  // A node without its own record draws as its good's representative (`resolveGatheringRefs`).
  const typeIdOf = new Map(goods.map((good) => [good.id, good.typeId]));
  const recordOfGood = new Map<number, number>();
  for (const pipeline of ir.gatheringPipeline ?? []) {
    const typeId = typeIdOf.get(pipeline.goodId);
    const record = representativeRecord(pipeline.harvest ?? pipeline.pickup, byIndex);
    if (typeId !== undefined && record !== undefined) recordOfGood.set(typeId, record.index);
  }
  return {
    clipOf: (gfxIndex, goodType) => {
      const record = gfxIndex ?? recordOfGood.get(goodType);
      const clip = record === undefined ? undefined : clipRecordOf.get(record);
      return clip === undefined ? undefined : artByClip.get(clip.index);
    },
  };
}
