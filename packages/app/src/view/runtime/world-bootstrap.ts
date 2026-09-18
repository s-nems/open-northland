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
import { graphicsEnhancementsFor } from '../graphics-enhancements.js';
import { mountMessage, navButton } from '../overlay.js';
import { pixelArtScalerParam, postFxParam, shadowStyleParam, walkPlacementParam } from '../params.js';
import { readStoredSettings } from '../settings-store.js';
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
 * Post-fx follows the stored graphics setting; an explicit `?postfx` wins for the session, so
 * captures and diagnostics stay reproducible whatever the machine's stored choice.
 */
export function createWorldRenderer(
  app: Application,
  params: URLSearchParams,
  sheet: SpriteSheet | undefined,
  playerColourOf?: (player: number) => number,
): WorldRenderer {
  return new WorldRenderer(app, {
    enhancements: graphicsEnhancementsFor(params, readStoredSettings()),
    pixelArtScaler: pixelArtScalerParam(params) ?? undefined,
    shadowStyle: shadowStyleParam(params) ?? undefined,
    walkPlacement: walkPlacementParam(params) ?? undefined,
    sheet,
    viewSmoothing: true,
    spriteSmoothing: readStoredSettings().spriteSmoothing,
    postFx: postFxParam(params) ?? readStoredSettings().postFxEnabled,
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

/** Halt a boot whose staged save failed to restore. The staged bytes are already consumed, so the
 *  next boot of the same URL starts fresh instead of looping the failure. */
export function haltOnFailedRestore(err: unknown): void {
  const copy = messages().common;
  diag.warn('boot', `staged save restore failed: ${String(err)}`);
  dismissBootProgress();
  mountMessage(copy.loadFailedTitle, copy.loadFailedDetail, [navButton(copy.backToMenu, false, '')]);
}

/** The minimap's ground colours from the terrain set's per-type debug colours. */
export function terrainColourOption(terrain: TerrainTextureSet): Pick<GameViewDeps, 'terrainColour'> {
  return { terrainColour: (t: number) => terrain.cellFor(t)?.fallbackColour };
}
