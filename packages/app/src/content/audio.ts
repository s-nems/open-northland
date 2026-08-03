import { buildSoundIndex, defaultBindings, SoundDriver } from '@open-northland/audio';
import type { SoundBank } from '@open-northland/data';
import type { ContentIr } from './ir/rows.js';

/**
 * The audio content boundary: build the {@link SoundDriver} the live loop pumps from the decoded sound
 * bank in the shared IR. Degrades to silence when the gitignored `content/` is absent or predates the
 * sound bank, so a checkout without it still boots.
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
 * Build a {@link SoundDriver} from the fetched IR, or `null` when it carries no sound bank (content
 * absent, or an `ir.json` generated before sounds were extracted) - the caller then runs silent.
 * `chopAtomicId`/`buildAtomicId` bind the woodcutter-chop / builder-hammer atomics (content ids the app
 * owns) to their axe / hammer SFX.
 */
export function createSoundDriver(
  ir: ContentIr | null,
  opts?: { readonly chopAtomicId?: number; readonly buildAtomicId?: number },
): SoundDriver | null {
  const sounds = ir?.sounds;
  if (!hasSoundContent(sounds)) return null;
  const index = buildSoundIndex(sounds, ir?.gfxPatterns ?? [], ir?.terrainPatterns ?? []);
  return new SoundDriver(index, defaultBindings(opts), { baseUrl: '/sounds/' });
}
