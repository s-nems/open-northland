import type { SoundDriver } from '@open-northland/audio';
import type { WorldRenderer } from '@open-northland/render';
import { createSoundDriver } from '../../content/audio.js';
import { loadSettlerBubbleGfx } from '../../content/bubbles.js';
import { loadBuildingSignGfx } from '../../content/building-signs.js';
import { loadIr } from '../../content/ir/load.js';
import { loadMapMusicType } from '../../content/map-loader.js';
import { loadMusicManifest } from '../../content/music.js';
import { loadCombatBones } from '../../content/objects.js';
import { readStoredSettings } from '../settings-store.js';
import { startSound } from '../sound-start.js';

/** Hand the driver the map's `musictype` and the rendered-music manifest, after which each frame picks
 *  the mood variant; playback starts once audio is unlocked. Both fetches degrade to "no music". */
async function startMapMusic(sound: SoundDriver, mapId: string): Promise<void> {
  const [musicType, manifest] = await Promise.all([loadMapMusicType(mapId), loadMusicManifest()]);
  if (musicType === null || manifest === null) return;
  sound.setMusicMap({ musicType, manifest });
}

/** Load the optional decoded assets the game view's sound and combat rendering share, and return the
 *  sound driver they were loaded for. */
export async function mountGamePresentation(
  params: URLSearchParams,
  renderer: WorldRenderer,
): Promise<ReturnType<typeof createSoundDriver> | null> {
  const ir = await loadIr();
  const sound = params.get('sound') === 'off' ? null : createSoundDriver(ir);
  if (sound !== null) {
    const settings = readStoredSettings();
    sound.setSfxVolume(settings.soundVolume);
    sound.setMusicVolume(settings.musicVolume);
    startSound(sound);
    const mapId = params.get('map');
    if (mapId !== null) void startMapMusic(sound, mapId);
  }
  renderer.setCombatBonesGfx(ir !== null ? await loadCombatBones(ir) : null);
  renderer.setSettlerBubbleGfx(await loadSettlerBubbleGfx());
  renderer.setBuildingSignGfx(await loadBuildingSignGfx());
  return sound;
}
