import {
  type AudioEngineOptions,
  buildSoundIndex,
  DEFAULT_MUSIC_BASE_URL,
  DEFAULT_SOUNDS_BASE_URL,
  defaultBindings,
  SoundDriver,
  type SoundIndex,
} from '@open-northland/audio';
import type { SoundBank, SoundQuality } from '@open-northland/data';
import { timedAudioContext } from '../../diag/audio-context.js';
import type { ContentIr } from '../ir/rows.js';
import { moddedContentAssetUrl } from '../net.js';
import { contentUrl } from '../url.js';

/**
 * The audio content boundary: build the {@link SoundDriver} the live loop pumps from the decoded sound
 * bank in the shared IR.
 */

/** Where an audio engine of this page reads the content tree's clips and music. */
const CONTENT_AUDIO_URLS = {
  baseUrl: contentUrl(DEFAULT_SOUNDS_BASE_URL),
  musicBaseUrl: contentUrl(DEFAULT_MUSIC_BASE_URL),
} as const satisfies AudioEngineOptions;

/** The engine options of this page's content tree, loading its sound banks at `soundQuality`. */
export function contentAudioOptions(soundQuality: SoundQuality): AudioEngineOptions {
  return {
    ...CONTENT_AUDIO_URLS,
    soundQuality,
    createContext: timedAudioContext(),
    fetchBytes: async (url) => {
      const response = await fetch(await moddedContentAssetUrl(url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    },
  };
}

/**
 * True when the bank carries at least one clip in any category. The one "is there anything to play?" test,
 * so a consumer's silent/empty decision cannot drift from another's.
 */
export function hasSoundContent(sounds: SoundBank | undefined): sounds is SoundBank {
  return (
    sounds !== undefined && sounds.staticGroups.length + sounds.ambient.length + sounds.jingles.length > 0
  );
}

/** The sound index over `sounds`, joined with the IR rows that place, voice and bed it. */
export function soundIndexOf(ir: ContentIr, sounds: SoundBank): SoundIndex {
  return buildSoundIndex(
    sounds,
    ir.gfxPatterns ?? [],
    ir.terrainPatterns ?? [],
    ir.jobs ?? [],
    ir.tribes ?? [],
    ir.landscapeGfx ?? [],
  );
}

/**
 * Build a {@link SoundDriver} from the fetched IR, or `null` when content is absent - the caller then
 * runs silent.
 */
export function createSoundDriver(ir: ContentIr | null, soundQuality: SoundQuality): SoundDriver | null {
  const sounds = ir?.sounds;
  if (ir === null || !hasSoundContent(sounds)) return null;
  return new SoundDriver(soundIndexOf(ir, sounds), defaultBindings(), contentAudioOptions(soundQuality));
}
