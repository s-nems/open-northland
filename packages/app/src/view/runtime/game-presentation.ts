import type { SoundDriver } from '@open-northland/audio';
import type { WorldRenderer } from '@open-northland/render';
import { createSoundDriver } from '../../content/audio.js';
import { loadSettlerBubbleGfx } from '../../content/bubbles.js';
import { loadBuildingSignGfx } from '../../content/building-signs.js';
import { loadIr } from '../../content/ir/load.js';
import { loadMusicManifest } from '../../content/music.js';
import { loadCombatBones } from '../../content/objects.js';
import { assetSetFor } from '../asset-settings.js';
import { readStoredSettings } from '../settings-store.js';
import { startSound } from '../sound-start.js';
import { gameSoundEnabled } from './game-settings.js';

/** Hand the driver the map's `musictype` and the rendered-music manifest, after which each frame picks
 *  the mood variant; playback starts once audio is unlocked. A missing manifest degrades to "no music". */
async function startMapMusic(sound: SoundDriver, musicType: number): Promise<void> {
  const manifest = await loadMusicManifest();
  if (manifest === null) return;
  sound.setMusicMap({ musicType, manifest });
}

/** Load the optional decoded assets the game view's sound and combat rendering share, and return the
 *  sound driver they were loaded for. */
export async function mountGamePresentation(
  params: URLSearchParams,
  renderer: WorldRenderer,
  /** The map's `[misc_music]` code; null for a world that plays no music. */
  musicType: number | null,
): Promise<ReturnType<typeof createSoundDriver> | null> {
  const ir = await loadIr();
  const sound = createSoundDriver(ir);
  if (sound !== null) {
    const settings = readStoredSettings();
    sound.setEnabled(gameSoundEnabled(params, settings.soundEnabled));
    sound.setSfxVolume(settings.soundVolume);
    sound.setMusicVolume(settings.musicVolume);
    startSound(sound);
    if (musicType !== null) void startMapMusic(sound, musicType);
  }
  if (assetSetFor(params) === 'own') return sound;
  renderer.setCombatBonesGfx(ir !== null ? await loadCombatBones(ir) : null);
  renderer.setSettlerBubbleGfx(await loadSettlerBubbleGfx());
  renderer.setBuildingSignGfx(await loadBuildingSignGfx());
  return sound;
}
