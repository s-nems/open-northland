import type { SpriteSheet, TerrainTextureSet } from '@open-northland/render';
import { WorldRenderer } from '@open-northland/render';
import type { Application } from 'pixi.js';
import { goodLocaleParam, loadGoodNameMap } from '../../content/good-names.js';
import {
  loadRuntimeRealContent,
  logRealContentGaps,
  type RealContentMerge,
} from '../../content/real-content.js';
import { diag } from '../../diag/index.js';
import { messages } from '../../i18n/index.js';
import { dismissBootProgress } from '../boot-progress.js';
import { mountMessage, navButton } from '../overlay.js';
import type { GameViewDeps } from './game-view.js';

/**
 * The world bootstrap both playable entries (`?map=` and `?scene=`) share: the decoded content each
 * needs, the renderer they build over it, and the URL flags that reshape either. The entries keep
 * their own assembly order and their genuinely per-mode parts (the map's static→dynamic resource
 * handover, the scene's tick-1 framing); only these seams are one implementation.
 */

/** The localized real content a playable entry boots on. Both fields degrade on their own so a checkout
 *  without `content/` still boots (no real content - the authored fallbacks stand). */
export interface LocalizedRealContent {
  /** The app-wide `?lang=` good-name map the HUD and the real content read. */
  readonly goodNames: ReadonlyMap<string, string>;
  /** The merged real content, or `null` when `content/` is absent. Its gaps are logged once here. */
  readonly realContent: RealContentMerge | null;
}

/**
 * Load the `?lang=` good names and the real content they localize. A value-returning loader, not a
 * lifecycle hook: the entries interleave it with their own IR/sprite/sim assembly in different orders,
 * and report their own boot phases around it. The IR itself is not loaded here - each entry reads it at
 * the point its boot phases need it, and `loadIr` is memoized, so asking twice costs one fetch.
 */
export async function loadLocalizedRealContent(params: URLSearchParams): Promise<LocalizedRealContent> {
  const goodNames = await loadGoodNameMap(goodLocaleParam(params));
  const realContent = await loadRuntimeRealContent(goodNames);
  if (realContent !== null) logRealContentGaps(realContent);
  return { goodNames, realContent };
}

/**
 * The retained world renderer both entries draw through: mesh the terrain once, then reuse a pooled
 * sprite graph each frame (no per-frame object churn), so large maps and deep zoom-outs stay within the
 * GPU budget. `?postfx=off` opts out of the post-processing pass (a renderer opt-out, not a player
 * setting - see `WorldRenderer`'s `postFx` option). The caller still sets the terrain.
 */
export function createWorldRenderer(
  app: Application,
  params: URLSearchParams,
  sheet: SpriteSheet | undefined,
  playerColourOf?: (player: number) => number,
): WorldRenderer {
  return new WorldRenderer(app, {
    sheet,
    viewSmoothing: true,
    postFx: params.get('postfx') !== 'off',
    ...(playerColourOf !== undefined ? { playerColourOf } : {}),
  });
}

/**
 * Halt a playable boot on missing decoded content (a {@link import('../../content/terrain.js').MissingTerrainError}):
 * one bounded diagnostic, the boot card down, and the how-to-fix notice up, with a way back to the
 * menu (the menu boots without `content/`, so a bare checkout is never dead-ended).
 */
export function haltOnMissingContent(err: Error): void {
  const copy = messages().common;
  diag.warn('content', `real terrain unavailable: ${err.message}`);
  dismissBootProgress();
  mountMessage(copy.missingContentTitle, copy.missingTerrainDetail, [navButton(copy.backToMenu, false, '')]);
}

/** The minimap's ground colours from the real terrain set's per-type debug colours, as a spreadable
 *  {@link GameViewDeps} fragment. The set is required: a playable entry never boots without one. */
export function terrainColourOption(terrain: TerrainTextureSet): Pick<GameViewDeps, 'terrainColour'> {
  return { terrainColour: (t: number) => terrain.cellFor(t)?.fallbackColour };
}
