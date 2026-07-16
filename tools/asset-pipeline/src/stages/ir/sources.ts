import { join } from 'node:path';
import { CULTURESNATION_MOD } from '../../probe.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';

/**
 * One readable `.ini` rule source to parse, with where it came from (`base` = `Data/logic`,
 * `mod` = `DataCnmd`). The extractor selects which `[section]`s it cares about, so a file with no
 * matching sections contributes nothing rather than erroring.
 */
export interface IniSource {
  /** Absolute path of the `.ini` file to read. */
  readonly path: string;
  /** Path stamped onto each record's `source.file` — relative so the IR is location-agnostic. */
  readonly file: string;
  /** The path's namespace (`Data/logic` vs `DataCnmd`), not which root supplied the bytes — a mod
   * overlay patching a base file still stamps `base`, matching the old in-place provenance. */
  readonly layer: 'base' | 'mod';
}

/**
 * Resolves the readable `.ini` sources for the type tables we can extract today, preferring the
 * mod's readable `.ini` over the base game (AGENTS.md golden rule #4): tribes + atomic animations +
 * weapons + buildings live only under `DataCnmd/types/` (the base game's twins are encrypted `.cif`),
 * while goods/jobs/landscape/vehicles/armor/animals are `Data/logic/*.ini` — themselves resolved
 * overlay-first ({@link resolveSourceFile}), because the CnMod zip ships patched copies of those base
 * files too. A source missing in every root is dropped with a warning — a partial install still
 * produces an IR from whatever is present, rather than aborting the whole batch.
 */
export async function resolveIniSources(roots: SourceRoots): Promise<IniSource[]> {
  const wanted: { rel: string; layer: 'base' | 'mod' }[] = [
    { rel: join('Data', 'logic', 'goodtypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'jobtypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'humanjobexperiencetypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'landscapetypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'vehicletypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'armortypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'animaltypes.ini'), layer: 'base' },
    { rel: join(CULTURESNATION_MOD, 'tribetypes12', 'tribetypes.ini'), layer: 'mod' },
    { rel: join(CULTURESNATION_MOD, 'atomicanimations12', 'atomicanimations.ini'), layer: 'mod' },
    { rel: join(CULTURESNATION_MOD, 'types', 'weapons.ini'), layer: 'mod' },
    { rel: join(CULTURESNATION_MOD, 'types', 'houses.ini'), layer: 'mod' },
    // The renderer's animation table: `[bobseq]` named frame ranges (`seq "<name>" <start> <length>`)
    // → IR `bobSequences`, so the render reads its walk/chop cycles from data instead of hard-coded
    // constants (see `extractBobSequences`). Mod-only readable; the base twin is encrypted `.cif`.
    { rel: join(CULTURESNATION_MOD, 'animation', 'mapmoveableanimations', 'animations.ini'), layer: 'mod' },
    // The graphics-table twin: its `[GfxHouse]` records carry the `LogicConstructionGoods` build
    // costs (and the home level chain), which the logic table above does not — overlaid onto the
    // buildings by `typeId` in `buildIr` (see `extractConstructionCosts`).
    { rel: join(CULTURESNATION_MOD, 'budynki12', 'houses', 'houses.ini'), layer: 'mod' },
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
