import {
  createSyntheticAtlasSource,
  type SpriteSheet,
  SYNTHETIC_BINDINGS,
  syntheticAtlasFrames,
} from '@open-northland/render';
import { diag } from '../../diag/index.js';
import { MissingAtlasError } from '../ir.js';
import type { GoodRef } from '../settler-gfx/index.js';
import { loadHumanSpriteSheet } from './human-sheet.js';

/** The reproducible synthetic atlas used when a checkout has no decoded graphics. */
export function syntheticSpriteSheet(): SpriteSheet {
  return {
    source: createSyntheticAtlasSource(),
    atlas: syntheticAtlasFrames(),
    bindings: SYNTHETIC_BINDINGS,
  };
}

/**
 * Load decoded world sprites for normal map and scene play. A checkout without decoded content falls back
 * to the reproducible hand-authored markers; renderer verification overrides remain confined to `?shot`.
 */
export async function resolveSpriteSheet(
  /** The goods of the content set the sim will run (demo/scene) — keys the per-good carry looks; the
   *  ids are content-relative numbers, so only the entry that builds the sim knows them. */
  goods: readonly GoodRef[] = [],
): Promise<SpriteSheet> {
  try {
    return await loadHumanSpriteSheet(goods);
  } catch (err) {
    if (!(err instanceof MissingAtlasError)) throw err;
    diag.warn(
      'content',
      'real atlas unavailable (is content/ populated?) — falling back to synthetic markers',
      err,
    );
    return syntheticSpriteSheet();
  }
}
