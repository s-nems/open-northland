import { CULTURESNATION_MOD } from '../../mod-root.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';

export interface IniSource {
  /** Resolved root-joined path of the `.ini` file to read. */
  readonly path: string;
  /** Path stamped onto each record's `source.file` - relative so the IR is location-agnostic. */
  readonly file: string;
  /** The path's namespace (`Data/logic` vs `DataCnmd`): the mod's patched copy of a base table still
   *  stamps `base`. */
  readonly layer: 'base' | 'mod';
}

/**
 * Resolves the readable `.ini` rule sources: tribes, atomic animations, weapons, and buildings are
 * readable text only under `DataCnmd/` (their base twins are encrypted `.cif`), while the
 * `Data/logic/*.ini` tables are the mod's patched copies of the base ones. A missing source is skipped
 * with a warning, so a partial mod tree still yields an IR.
 */
export async function resolveIniSources(roots: SourceRoots): Promise<IniSource[]> {
  const wanted: { rel: string; layer: 'base' | 'mod' }[] = [
    { rel: 'Data/logic/goodtypes.ini', layer: 'base' },
    { rel: 'Data/logic/jobtypes.ini', layer: 'base' },
    { rel: 'Data/logic/humanjobexperiencetypes.ini', layer: 'base' },
    { rel: 'Data/logic/landscapetypes.ini', layer: 'base' },
    { rel: 'Data/logic/vehicletypes.ini', layer: 'base' },
    { rel: 'Data/logic/armortypes.ini', layer: 'base' },
    { rel: 'Data/logic/animaltypes.ini', layer: 'base' },
    { rel: `${CULTURESNATION_MOD}/tribetypes12/tribetypes.ini`, layer: 'mod' },
    { rel: `${CULTURESNATION_MOD}/atomicanimations12/atomicanimations.ini`, layer: 'mod' },
    { rel: `${CULTURESNATION_MOD}/types/weapons.ini`, layer: 'mod' },
    { rel: `${CULTURESNATION_MOD}/types/houses.ini`, layer: 'mod' },
    // The renderer's `[bobseq]` animation table.
    { rel: `${CULTURESNATION_MOD}/animation/mapmoveableanimations/animations.ini`, layer: 'mod' },
    // The `[GfxHouse]` graphics twin of the logic house table above.
    { rel: `${CULTURESNATION_MOD}/budynki12/houses/houses.ini`, layer: 'mod' },
  ];
  const sources: IniSource[] = [];
  for (const { rel, layer } of wanted) {
    const path = await resolveSourceFile(roots, rel);
    if (path === undefined) {
      console.warn(`[pipeline] ini source not found, skipping: ${rel}`);
      continue;
    }
    sources.push({ path, file: rel, layer });
  }
  return sources;
}
