import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import type { Args } from '../args.js';
import {
  type SourceRef,
  decodeIni,
  extractAnimals,
  extractArmor,
  extractAtomicAnimations,
  extractBuildings,
  extractConstructionCosts,
  extractGoods,
  extractJobExperience,
  extractJobs,
  extractLandscape,
  extractTribes,
  extractVehicles,
  extractWeapons,
  fillBuildingRecipes,
  parseIniSections,
} from '../decoders/ini.js';
import { decodeMapTree } from './maps.js';

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
  readonly layer: 'base' | 'mod';
}

/**
 * Resolves the readable `.ini` sources for the type tables we can extract today, **preferring the
 * mod's readable `.ini` over the base game** (CLAUDE.md golden rule #4): tribes + atomic animations +
 * weapons + buildings live only under `DataCnmd/types/` (the base game's twins are encrypted `.cif`),
 * while goods/jobs/landscape/vehicles/armor/animals are base `Data/logic/*.ini`. A source whose file is missing on disk is
 * dropped with a warning — a partial install (or no mod) still produces an IR from whatever is present,
 * rather than aborting the whole batch.
 */
export async function resolveIniSources(gameDir: string, mod: string | undefined): Promise<IniSource[]> {
  const base: { rel: string; layer: 'base' | 'mod' }[] = [
    { rel: join('Data', 'logic', 'goodtypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'jobtypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'humanjobexperiencetypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'landscapetypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'vehicletypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'armortypes.ini'), layer: 'base' },
    { rel: join('Data', 'logic', 'animaltypes.ini'), layer: 'base' },
  ];
  if (mod !== undefined) {
    base.push(
      { rel: join(mod, 'tribetypes12', 'tribetypes.ini'), layer: 'mod' },
      { rel: join(mod, 'atomicanimations12', 'atomicanimations.ini'), layer: 'mod' },
      { rel: join(mod, 'types', 'weapons.ini'), layer: 'mod' },
      { rel: join(mod, 'types', 'houses.ini'), layer: 'mod' },
      // The graphics-table twin: its `[GfxHouse]` records carry the `LogicConstructionGoods` build
      // costs (and the home level chain), which the logic table above does not — overlaid onto the
      // buildings by `typeId` in `buildIr` (see `extractConstructionCosts`).
      { rel: join(mod, 'budynki12', 'houses', 'houses.ini'), layer: 'mod' },
    );
  }
  const sources: IniSource[] = [];
  for (const { rel, layer } of base) {
    const path = join(gameDir, rel);
    try {
      await access(path);
    } catch {
      console.warn(`[pipeline] ini source not found, skipping: ${rel}`);
      continue;
    }
    sources.push({ path, file: rel, layer });
  }
  return sources;
}

/**
 * Reads + parses every resolved `.ini` source and runs the typed extractors, then assembles and
 * **validates** a {@link ContentSet} via `parseContentSet` (zod + cross-reference checks). Decoding
 * stays pure (`decodeIni`/`parseIniSections`/`extract*` take bytes/text, not the filesystem); the
 * only I/O here is reading the resolved files. Each extractor pulls only its own `[section]`s from a
 * file, so passing every file's sections to every extractor is correct and order-independent.
 */
export async function buildIr(args: Args): Promise<ContentSet> {
  const sources = await resolveIniSources(args.game, args.mod);
  const goods = [];
  const jobs = [];
  const jobExperience = [];
  const buildings = [];
  const landscape = [];
  const tribes = [];
  const atomicAnimations = [];
  const weapons = [];
  const armor = [];
  const animals = [];
  const vehicles = [];
  // typeId -> build-material cost, overlaid from the graphics table's `[GfxHouse]` records onto the
  // logic-table buildings below (the logic table carries no construction cost — see `resolveIniSources`).
  const constructionCosts = new Map<number, { goodType: number; amount: number }[]>();
  for (const { path, file, layer } of sources) {
    const sections = parseIniSections(decodeIni(await readFile(path)));
    const src: SourceRef = { file, layer };
    goods.push(...extractGoods(sections, src));
    jobs.push(...extractJobs(sections, src));
    jobExperience.push(...extractJobExperience(sections, src));
    buildings.push(...extractBuildings(sections, src));
    landscape.push(...extractLandscape(sections, src));
    tribes.push(...extractTribes(sections, src));
    atomicAnimations.push(...extractAtomicAnimations(sections, src));
    weapons.push(...extractWeapons(sections, src));
    armor.push(...extractArmor(sections, src));
    animals.push(...extractAnimals(sections, src));
    vehicles.push(...extractVehicles(sections, src));
    for (const [typeId, cost] of extractConstructionCosts(sections)) {
      constructionCosts.set(typeId, cost);
    }
  }
  const maps = await decodeMapTree(args.game);
  // Overlay each building's build-material cost from the graphics table (joined by `typeId`); a
  // building the graphics table omits keeps the schema-default empty cost.
  const buildingsWithCosts = buildings.map((b) => {
    const cost = constructionCosts.get(b.typeId);
    return cost ? { ...b, construction: cost } : b;
  });
  // Output-side recipe join: a workplace's `produces` output good -> that good's `productionInputs`
  // materializes each producing building's `recipe` (cross-table, so after the tables are built).
  // The recipe `ticks` is resolved through the produce-atomic animation length of the reference
  // tribe, so the tribes + atomicAnimations tables feed in too (fall back to a default otherwise).
  const buildingsWithRecipes = fillBuildingRecipes(buildingsWithCosts, goods, tribes, atomicAnimations);
  return parseContentSet({
    manifest: {
      version: IR_VERSION,
      generatedFrom: { game: args.game, mod: args.mod },
    },
    goods,
    jobs,
    jobExperience,
    buildings: buildingsWithRecipes,
    weapons,
    armor,
    animals,
    vehicles,
    landscape,
    tribes,
    atomicAnimations,
    maps,
  });
}

/**
 * Builds the validated IR and writes it to `<out>/ir.json` (pretty-printed for diff-legibility).
 * Returns the assembled set so the caller can report record counts. The write target lives under the
 * gitignored `content/` — no copyrighted bytes enter the repo source.
 */
export async function writeIr(args: Args): Promise<ContentSet> {
  const set = await buildIr(args);
  await mkdir(args.out, { recursive: true });
  await writeFile(join(args.out, 'ir.json'), `${JSON.stringify(set, null, 2)}\n`);
  return set;
}
