import { defaultBindings, SoundDriver } from '@open-northland/audio';
import { hasSoundContent, soundIndexOf } from '../../content/audio.js';
import { loadIr } from '../../content/ir/load.js';
import { loadMusicManifest } from '../../content/music.js';
import { messages } from '../../i18n/index.js';
import { el, pageInnerStyle, pageRootStyle } from '../../view/overlay.js';
import { readStoredSettings } from '../../view/settings-store.js';
import { buildSoundGalleryModel } from './model.js';
import { createSoundStudio, runStudioClock } from './studio.js';

/**
 * The `?sounds` verification gallery: the human-oracle seam for audio, since whether a sound is the
 * right sound cannot be self-judged. It lists every group the game sounds and plays each through the
 * game's own driver, under the player's stored mixer settings.
 */

const ROOT_STYLE = pageRootStyle(32, 14);
const INNER_STYLE = pageInnerStyle(1040);

function mountFullPageMessage(title: string, detail: string): void {
  const root = el('div', ROOT_STYLE);
  const inner = el('div', INNER_STYLE);
  inner.append(
    el('div', 'font-weight:700;font-size:22px', title),
    el('div', 'opacity:0.8;margin-top:8px', detail),
  );
  root.append(inner);
  document.body.append(root);
}

/** Degrades to a "run the pipeline" message when `content/`, and with it the sound bank, is absent. */
export async function renderSoundGallery(
  _canvas: HTMLCanvasElement,
  _params: URLSearchParams,
): Promise<void> {
  const [ir, music] = await Promise.all([loadIr(), loadMusicManifest()]);
  const sounds = ir?.sounds;
  if (ir === null || !hasSoundContent(sounds)) {
    mountFullPageMessage(messages().soundGallery.missingTitle, messages().soundGallery.missingDetail);
    return;
  }

  // The tribe table names people and animal species alike; the first record naming a tribe wins.
  const namedTribes = new Map<number, string>();
  for (const tribe of ir.tribes ?? []) {
    if (tribe.typeId !== undefined && tribe.name !== undefined && !namedTribes.has(tribe.typeId)) {
      namedTribes.set(tribe.typeId, tribe.name);
    }
  }
  const index = soundIndexOf(ir, sounds);
  const bindings = defaultBindings();
  const model = buildSoundGalleryModel(sounds, index, bindings, (tribe) => namedTribes.get(tribe));
  const { volumes } = readStoredSettings();
  const driver = new SoundDriver(index, bindings, { volumes });
  const studio = createSoundStudio(driver, index, model, music, volumes);

  const root = el('div', ROOT_STYLE);
  const inner = el('div', INNER_STYLE);
  inner.append(
    el('div', 'font-weight:700;font-size:24px', messages().soundGallery.title),
    el('div', 'opacity:0.78;margin-top:4px;font-size:13px;line-height:1.5', messages().soundGallery.intro),
    ...studio.sections,
  );
  root.append(inner);
  document.body.append(root);
  runStudioClock(studio.idleFrame, window);
}
