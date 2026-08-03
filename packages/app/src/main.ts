import { installCrashCapture, logBootHeader } from './diag/index.js';
import { renderAnimationGallery } from './entries/anim.js';
import { renderBackdrop } from './entries/backdrop.js';
import { renderIconGallery } from './entries/icons.js';
import { renderMainMenu } from './entries/main-menu/index.js';
import { renderMap } from './entries/map.js';
import { renderSceneMode } from './entries/scene.js';
import { renderShot } from './entries/shot.js';
import { renderSoundGallery } from './entries/sound.js';
import { localeParam, setActiveLocale } from './i18n/index.js';
import { dismissBootProgress } from './view/boot-progress.js';

/**
 * App shell entry point: reads `window.location.search`, picks exactly one entry, and hands off. All
 * sim and render wiring lives in the entries; this file only routes.
 */
async function main(): Promise<void> {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #game canvas');

  logBootHeader();
  installCrashCapture();
  const params = new URLSearchParams(window.location.search);
  setActiveLocale(localeParam(params));
  return route(canvas, params);
}

async function route(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  if (params.has('shot')) return renderShot(canvas);
  if (params.has('backdrop')) return renderBackdrop(canvas, params);
  const sceneId = params.get('scene');
  if (sceneId !== null) return renderSceneMode(canvas, sceneId, params);
  if (params.has('anim')) return renderAnimationGallery(canvas, params);
  if (params.has('icons')) return renderIconGallery(canvas, params);
  if (params.has('sounds')) return renderSoundGallery(canvas, params);
  if (params.has('map')) return renderMap(canvas, params);
  return renderMainMenu(canvas, params);
}

// A boot that throws never reaches its own `finish()`, so the progress card would sit there for good,
// covering the crash banner.
void main().catch((err: unknown) => {
  dismissBootProgress();
  throw err; // installCrashCapture's unhandledrejection hook owns the reporting
});
