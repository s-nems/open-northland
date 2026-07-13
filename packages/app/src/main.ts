import { renderAnimationGallery } from './entries/anim.js';
import { renderIconGallery } from './entries/icons.js';
import { renderMap } from './entries/map.js';
import { renderMenu } from './entries/menu.js';
import { renderSceneMode } from './entries/scene.js';
import { renderShot } from './entries/shot.js';
import { renderSoundGallery } from './entries/sound.js';

/**
 * App shell entry point — the URL DISPATCHER. It reads `window.location.search`, picks exactly one entry
 * (each in `entries/`), and hands off. This is the ONLY package that depends on both `sim` and `render`,
 * but the wiring lives in the entries; here we only route. See packages/app/AGENTS.md "URL-flag entries".
 *
 *  - `?shot`            → deterministic, headless screenshot entry (`entries/shot.ts`) — the harness waits
 *                         on `window.__opennorthlandShotReady`; no menu, no RAF loop.
 *  - `?scene=<id>`      → a registered acceptance scene with its checklist overlay (`entries/scene.ts`).
 *  - `?anim`            → the character animation gallery (`entries/anim.ts`).
 *  - `?icons[&atlas=]`  → the ICON gallery (`entries/icons.ts`) — browse every decoded bob-atlas frame by
 *                         index, to find a sprite for a feature. Dev-only (needs decoded `content/`).
 *  - `?sounds`          → the sound VERIFICATION gallery (`entries/sound.ts`) — click ▶ to audition every
 *                         wired clip. Distinct from the `?sound=off` MUTE modifier on live/scene (key `sound`).
 *  - `?map=<id>`        → the decoded-map viewer (`entries/map.ts`) — a real `content/maps/<id>.json` grid.
 *  - otherwise          → the MAIN MENU to pick any of the above (`entries/menu.ts`) — the default landing,
 *                         so a human never has to remember a `?…` string.
 */
async function main(): Promise<void> {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #game canvas');

  const params = new URLSearchParams(window.location.search);
  if (params.has('shot')) return renderShot(canvas);
  const sceneId = params.get('scene');
  if (sceneId !== null) return renderSceneMode(canvas, sceneId, params);
  if (params.has('anim')) return renderAnimationGallery(canvas, params);
  if (params.has('icons')) return renderIconGallery(canvas, params);
  if (params.has('sounds')) return renderSoundGallery(canvas, params);
  if (params.has('map')) return renderMap(canvas, params);
  return renderMenu(canvas, params);
}

void main();
