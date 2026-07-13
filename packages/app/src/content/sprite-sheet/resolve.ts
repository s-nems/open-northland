import {
  createSyntheticAtlasSource,
  type SpriteSheet,
  SYNTHETIC_BINDINGS,
  syntheticAtlasFrames,
} from '@vinland/render';
import { MissingAtlasError } from '../ir.js';
import type { GoodRef } from '../settler-gfx/index.js';
import { loadHumanSpriteSheet } from './human-sheet.js';

/** The reproducible synthetic atlas (flat-coloured markers, no copyrighted data) — the graceful fallback,
 *  also the `?shot`/`?atlas=synthetic` sheet (shared with `entries/shot.ts` so the two can't drift). */
export function syntheticSpriteSheet(): SpriteSheet {
  return {
    source: createSyntheticAtlasSource(),
    atlas: syntheticAtlasFrames(),
    bindings: SYNTHETIC_BINDINGS,
  };
}

/**
 * Resolve the sprite sheet for the `?atlas` flag — the single answer shared by the map (`entries/map.ts`)
 * and scene (`entries/scene.ts`) entries so both honour it identically. **Real decoded graphics are the
 * DEFAULT** (we always want to see the real thing): absent OR `?atlas=real` → the decoded atlases, degrading
 * to the synthetic marker atlas when `content/` is missing (a checkout without decoded bytes must still
 * boot). Explicit opt-outs: `?atlas=synthetic` (or `=1`/`=true`/empty) → the synthetic markers; `?atlas=none`
 * (or `=off`) → `undefined`, so sprites draw as placeholder geometry. NOTE: the reproducible `?shot` entry
 * does NOT use this — it keeps its own content-free default so the committed screenshot never depends on
 * gitignored bytes.
 */
export async function resolveSpriteSheet(
  params: URLSearchParams,
  /** The goods of the content set the sim will RUN (demo/scene) — keys the per-good carry looks; the
   *  ids are content-relative numbers, so only the entry that builds the sim knows them. */
  goods: readonly GoodRef[] = [],
): Promise<SpriteSheet | undefined> {
  const atlas = params.get('atlas');
  if (atlas === 'synthetic' || atlas === '1' || atlas === 'true' || atlas === '') {
    return syntheticSpriteSheet();
  }
  if (atlas === 'none' || atlas === 'off') return undefined;
  // Default (absent) and `?atlas=real`: draw real decoded graphics, falling back to synthetic markers ONLY
  // when the decoded atlases aren't present (a checkout without content/). A MissingAtlasError is that
  // expected precondition; any other error is a real bug and propagates rather than being masked as markers.
  try {
    return await loadHumanSpriteSheet(goods);
  } catch (err) {
    if (!(err instanceof MissingAtlasError)) throw err;
    console.warn('real atlas unavailable (is content/ populated?) — falling back to synthetic markers', err);
    return syntheticSpriteSheet();
  }
}
