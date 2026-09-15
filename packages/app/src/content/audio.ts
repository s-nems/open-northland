import { buildSoundIndex, defaultBindings, SoundDriver } from '@open-northland/audio';
import type { SoundBank } from '@open-northland/data';
import type { ContentIr } from './ir/rows.js';

/**
 * The audio content boundary: build the {@link SoundDriver} the live loop pumps from the decoded sound
 * bank in the shared IR.
 */

/**
 * True when the bank carries at least one clip in any category. The one "is there anything to play?" test,
 * so a consumer's silent/empty decision cannot drift from another's.
 */
export function hasSoundContent(sounds: SoundBank | undefined): sounds is SoundBank {
  return (
    sounds !== undefined && sounds.staticGroups.length + sounds.ambient.length + sounds.jingles.length > 0
  );
}

/**
 * Build a {@link SoundDriver} from the fetched IR, or `null` when content is absent - the caller then
 * runs silent.
 */
export function createSoundDriver(ir: ContentIr | null): SoundDriver | null {
  const sounds = ir?.sounds;
  if (!hasSoundContent(sounds)) return null;
  const index = buildSoundIndex(sounds, ir?.gfxPatterns ?? [], ir?.terrainPatterns ?? []);
  return new SoundDriver(index, defaultBindings(), {
    baseUrl: '/sounds/',
    musicBaseUrl: '/music/',
  });
}
