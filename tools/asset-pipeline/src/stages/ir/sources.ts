import { type ReadableVfs, vjoin } from '@open-northland/vfs';
import { CULTURESNATION_MOD } from '../../probe.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';

export interface IniSource {
  /** Resolved root-joined path of the `.ini` file to read. */
  readonly path: string;
  /** Path stamped onto each record's `source.file` - relative so the IR is location-agnostic. */
  readonly file: string;
  /** The path's namespace (`Data/logic` vs `DataCnmd`), not which root supplied the bytes: a mod
   * overlay patching a base file still stamps `base`. */
  readonly layer: 'base' | 'mod';
}

/**
 * Resolves the readable `.ini` rule sources, mod-first: tribes, atomic animations, weapons, and
 * buildings are readable text only under `DataCnmd/` (their base twins are encrypted `.cif`), while the
 * `Data/logic/*.ini` tables resolve overlay-first because the mod ships patched copies of them too. A
 * source missing from every root is skipped with a warning, so a partial install still yields an IR.
 */
export async function resolveIniSources(fs: ReadableVfs, roots: SourceRoots): Promise<IniSource[]> {
  const wanted: { rel: string; layer: 'base' | 'mod' }[] = [
    { rel: vjoin('Data', 'logic', 'goodtypes.ini'), layer: 'base' },
    { rel: vjoin('Data', 'logic', 'jobtypes.ini'), layer: 'base' },
    { rel: vjoin('Data', 'logic', 'humanjobexperiencetypes.ini'), layer: 'base' },
    { rel: vjoin('Data', 'logic', 'landscapetypes.ini'), layer: 'base' },
    { rel: vjoin('Data', 'logic', 'vehicletypes.ini'), layer: 'base' },
    { rel: vjoin('Data', 'logic', 'armortypes.ini'), layer: 'base' },
    { rel: vjoin('Data', 'logic', 'animaltypes.ini'), layer: 'base' },
    { rel: vjoin(CULTURESNATION_MOD, 'tribetypes12', 'tribetypes.ini'), layer: 'mod' },
    { rel: vjoin(CULTURESNATION_MOD, 'atomicanimations12', 'atomicanimations.ini'), layer: 'mod' },
    { rel: vjoin(CULTURESNATION_MOD, 'types', 'weapons.ini'), layer: 'mod' },
    { rel: vjoin(CULTURESNATION_MOD, 'types', 'houses.ini'), layer: 'mod' },
    // The renderer's `[bobseq]` animation table.
    { rel: vjoin(CULTURESNATION_MOD, 'animation', 'mapmoveableanimations', 'animations.ini'), layer: 'mod' },
    // The `[GfxHouse]` graphics twin of the logic house table above.
    { rel: vjoin(CULTURESNATION_MOD, 'budynki12', 'houses', 'houses.ini'), layer: 'mod' },
  ];
  const sources: IniSource[] = [];
  for (const { rel, layer } of wanted) {
    const path = await resolveSourceFile(fs, roots, rel);
    if (path === undefined) {
      console.warn(`[pipeline] ini source not found, skipping: ${rel}`);
      continue;
    }
    sources.push({ path, file: rel, layer });
  }
  return sources;
}
