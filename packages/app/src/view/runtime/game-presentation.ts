import type { SoundDriver } from '@open-northland/audio';
import type { WorldRenderer } from '@open-northland/render';
import { createSoundDriver } from '../../content/audio.js';
import { loadSettlerBubbleGfx } from '../../content/bubbles.js';
import { loadBuildingSignGfx } from '../../content/building-signs.js';
import { loadIr } from '../../content/ir/load.js';
import { loadMusicManifest } from '../../content/music.js';
import { loadCombatBones, loadWreckDebris } from '../../content/objects.js';
import { diag } from '../../diag/index.js';
import { presentationPack } from '../../presentation/pack.js';
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

/** Bytes in the megabyte the preload log reports in. */
const BYTES_PER_MB = 1e6;

/** Decode the bank in the background once audio has started, and log what the cache then holds and
 *  how long it took. A first click or fight after it plays from memory. */
async function preloadSounds(sound: SoundDriver): Promise<void> {
  const report = await sound.preload();
  if (report === null) return;
  diag.info('audio', 'sound bank preloaded', {
    ...report,
    cachedMB: Math.round(report.cachedBytes / BYTES_PER_MB),
    pinnedMB: Math.round(report.pinnedBytes / BYTES_PER_MB),
    elapsedMs: Math.round(report.elapsedMs),
  });
}

/** Load the optional decoded assets the game view's sound and combat rendering share, and return the
 *  sound driver they were loaded for. */
export async function mountGamePresentation(
  params: URLSearchParams,
  renderer: WorldRenderer,
  /** The map's `[misc_music]` code; null for a world that plays no music. */
  musicType: number | null,
  /** The view's lifetime; it ends the gesture listeners that start and restore audio. */
  signal: AbortSignal,
): Promise<ReturnType<typeof createSoundDriver> | null> {
  const ir = await loadIr();
  const sound = createSoundDriver(ir);
  const settings = readStoredSettings();
  renderer.setWeatherEnabled(settings.weather);
  try {
    if (sound !== null) {
      const enabled = gameSoundEnabled(params, settings.soundEnabled);
      sound.setEnabled(enabled);
      sound.setVolumes(settings.volumes);
      sound.setWeatherEnabled(settings.weather);
      startSound(sound, { signal });
      // A game started muted decodes on demand if it is unmuted later.
      if (enabled) void preloadSounds(sound);
      if (musicType !== null) void startMapMusic(sound, musicType);
    }
    if (presentationPack(params) !== null) return sound;
    renderer.setCombatBonesGfx(ir !== null ? await loadCombatBones(ir) : null);
    renderer.setWreckGfx(ir !== null ? await loadWreckDebris(ir) : null);
    renderer.setSettlerBubbleGfx(await loadSettlerBubbleGfx());
    renderer.setBuildingSignGfx(await loadBuildingSignGfx());
    return sound;
  } catch (error) {
    sound?.close();
    throw error;
  }
}
