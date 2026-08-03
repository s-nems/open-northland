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

/** The localized real content a playable entry boots on. Both fields degrade on their own, so a
 *  checkout without `content/` still boots on the authored fallbacks. */
export interface LocalizedRealContent {
  /** The app-wide `?lang=` good-name map. */
  readonly goodNames: ReadonlyMap<string, string>;
  /** The merged real content, or `null` when `content/` is absent. */
  readonly realContent: RealContentMerge | null;
}

export async function loadLocalizedRealContent(params: URLSearchParams): Promise<LocalizedRealContent> {
  const goodNames = await loadGoodNameMap(goodLocaleParam(params));
  const realContent = await loadRuntimeRealContent(goodNames);
  if (realContent !== null) logRealContentGaps(realContent);
  return { goodNames, realContent };
}

/**
 * The retained world renderer both playable entries draw through; the caller still sets the terrain.
 * `?postfx=off` is a renderer opt-out, not a player setting.
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

/** Halt a playable boot on a missing-terrain error, offering the way back to the menu, which boots
 *  without `content/`. */
export function haltOnMissingContent(err: Error): void {
  const copy = messages().common;
  diag.warn('content', `real terrain unavailable: ${err.message}`);
  dismissBootProgress();
  mountMessage(copy.missingContentTitle, copy.missingTerrainDetail, [navButton(copy.backToMenu, false, '')]);
}

/** The minimap's ground colours from the terrain set's per-type debug colours. */
export function terrainColourOption(terrain: TerrainTextureSet): Pick<GameViewDeps, 'terrainColour'> {
  return { terrainColour: (t: number) => terrain.cellFor(t)?.fallbackColour };
}
