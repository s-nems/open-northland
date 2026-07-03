import { SoundDriver, buildSoundIndex, defaultBindings } from '@vinland/audio';
import type { GfxPattern, SoundBank, TerrainPattern } from '@vinland/data';

/**
 * The audio content boundary: fetch the decoded sound bank from the served `content/ir.json` and build
 * the {@link SoundDriver} the live loop pumps. Mirrors the terrain/atlas loaders in this folder — it
 * reads the gitignored `content/` over the dev-server `/ir.json` + `/sounds` routes and **degrades to
 * silence** (returns `null`) when the content is absent or predates the sound bank, so a checkout
 * without `content/` still boots. The pipeline wrote `ir.json` through the zod schema, so casting the
 * fetched JSON to the relevant IR slices at this I/O boundary is the same stance the sibling loaders take.
 */

/** The slice of `content/ir.json` the audio layer reads (structurally the validated IR). */
interface AudioIr {
  readonly sounds?: SoundBank;
  readonly gfxPatterns?: readonly GfxPattern[];
  readonly terrainPatterns?: readonly TerrainPattern[];
}

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

/** Fetch the served IR, or null when it is absent/unreadable (a checkout without `content/`). */
export async function fetchAudioIr(): Promise<AudioIr | null> {
  try {
    const res = await fetch('/ir.json');
    if (!res.ok) return null;
    return (await res.json()) as AudioIr;
  } catch {
    return null;
  }
}

/**
 * Build a {@link SoundDriver} from the fetched IR, or `null` when it carries no sound bank (content
 * absent, or an `ir.json` generated before sounds were extracted) — the caller then runs silent.
 * `chopAtomicId` binds the woodcutter-chop atomic (a content id the app owns) to its axe SFX.
 */
export function createSoundDriver(
  ir: AudioIr | null,
  opts?: { readonly chopAtomicId?: number },
): SoundDriver | null {
  const sounds = ir?.sounds;
  if (!hasSoundContent(sounds)) return null;
  const index = buildSoundIndex(sounds, ir?.gfxPatterns ?? [], ir?.terrainPatterns ?? []);
  return new SoundDriver(index, defaultBindings(opts), { baseUrl: '/sounds/' });
}
