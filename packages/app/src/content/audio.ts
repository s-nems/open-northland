import { buildSoundIndex, defaultBindings, SoundDriver } from '@vinland/audio';
import type { SoundBank } from '@vinland/data';
import type { ContentIr } from './ir.js';

/**
 * The audio content boundary: build the {@link SoundDriver} the live loop pumps from the decoded
 * sound bank in the shared IR ({@link import('./ir.js').loadIr}). Reads the gitignored `content/`
 * over the dev-server `/sounds` route and **degrades to silence** (returns `null`) when the content
 * is absent or predates the sound bank, so a checkout without `content/` still boots.
 */

/**
 * True when the bank actually carries at least one clip (in any category) — the ONE "is there anything
 * to play / show?" test shared by the live {@link createSoundDriver} and the `?sounds` gallery, so their
 * silent/empty decisions can't drift (add a 4th category and both update together). Narrows `sounds` to a
 * present, non-empty {@link SoundBank}.
 */
export function hasSoundContent(sounds: SoundBank | undefined): sounds is SoundBank {
  return (
    sounds !== undefined && sounds.staticGroups.length + sounds.ambient.length + sounds.jingles.length > 0
  );
}

/**
 * Build a {@link SoundDriver} from the fetched IR, or `null` when it carries no sound bank (content
 * absent, or an `ir.json` generated before sounds were extracted) — the caller then runs silent.
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
