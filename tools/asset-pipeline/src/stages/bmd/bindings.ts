import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeCifStringArray } from '../../decoders/cif.js';
import {
  type BmdPaletteBinding,
  cifLinesToSections,
  decodeIni,
  extractBuildingGraphics,
  extractGraphicsBindings,
  extractJobBaseGraphics,
  extractJobChangeGraphics,
  extractLandscapeGraphics,
  extractPaletteIndex,
  type JobBaseGraphicsBinding,
  type PaletteAlias,
  parseIniSections,
  type RuleSection,
} from '../../decoders/ini.js';

/**
 * The graphics-binding resolution {@link resolveGraphicsBindings} produces and
 * {@link import('./convert.js').convertBmdTree} consumes: every `(bmd, palette)` binding, the palette
 * `editname` index, and the `.bmd`s that bake build-time alpha. The three always travel together.
 */
export interface GraphicsBindingSet {
  readonly bindings: readonly BmdPaletteBinding[];
  readonly palettes: readonly PaletteAlias[];
  readonly buildTimeBmds: ReadonlySet<string>;
}

/** The `(bmd, palette)` identity of a binding — the unit an atlas file is emitted (and deduped) per. */
function bindingKey(binding: Pick<BmdPaletteBinding, 'bmd' | 'paletteName'>): string {
  return `${binding.bmd} ${binding.paletteName}`;
}

/**
 * Appends `records` to `target`, dropping `(bmd, palette)` duplicates within `records` — a repeated
 * bob+palette pair would only make `convertBmdTree` re-emit identical atlas bytes. Each call dedups
 * only its own records (the landscape and house tables both repeat a bob across variants), not the
 * bindings already accumulated. `onEach` runs for every record before the dedup, duplicates included.
 */
function pushDeduped(
  target: BmdPaletteBinding[],
  records: Iterable<BmdPaletteBinding>,
  onEach?: (binding: BmdPaletteBinding) => void,
): void {
  const seen = new Set<string>();
  for (const binding of records) {
    onEach?.(binding);
    const key = bindingKey(binding);
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(binding);
  }
}

/**
 * Flattens the mod's richer `[jobbasegraphics]` records ({@link JobBaseGraphicsBinding}) into the flat
 * {@link BmdPaletteBinding} shape {@link import('./convert.js').convertBmdTree} already consumes — so the
 * human body/head bob sets reuse the exact same resolve→decode→atlas path as the readable `[jobgraphics]`
 * animals leg, with no second copy of the conversion logic. A human draws from a body bob (coloured by
 * `gfxpalettebasebody`) plus numbered head bobs (coloured by `gfxpalettebasehead`), so each indexed slot
 * becomes one binding paired with the matching palette. A slot whose palette `editname` is absent
 * is dropped here (there is nothing to resolve it against — not even a name `convertBmdTree` could
 * warn about); the `gfxpaletterandom` tint is a per-settler runtime range, not a bob palette, so it is
 * not emitted. The `logictribe`/`logicjob` cross-refs ride along on each binding. Head bobs carry no
 * shadow `.bmd` (the extractor never sets one); body shadows are left for the later shadow-palette step,
 * exactly as the `[jobgraphics]` leg leaves `shadowBmd` unconverted today.
 */
export function jobBaseGraphicsToBindings(records: readonly JobBaseGraphicsBinding[]): BmdPaletteBinding[] {
  const bindings: BmdPaletteBinding[] = [];
  for (const rec of records) {
    for (const slot of rec.body) {
      if (rec.bodyPalette === undefined) continue;
      bindings.push({
        bmd: slot.bmd,
        shadowBmd: slot.shadowBmd,
        paletteName: rec.bodyPalette,
        tribeId: rec.tribeId,
        jobId: rec.jobId,
      });
    }
    for (const slot of rec.head) {
      if (rec.headPalette === undefined) continue;
      bindings.push({
        bmd: slot.bmd,
        shadowBmd: slot.shadowBmd,
        paletteName: rec.headPalette,
        tribeId: rec.tribeId,
        jobId: rec.jobId,
      });
    }
  }
  return bindings;
}

/**
 * Reads the graphics-binding sources and extracts the `.bmd`→palette pairing from every binding skin,
 * merging them for {@link import('./convert.js').convertBmdTree}:
 *
 *  - base `Data/engine2d/inis/animals/jobgraphics.ini` `[jobgraphics]` (the one binding file shipped as
 *    plain `.ini`);
 *  - base `.../vehicles/jobgraphics.cif` `[jobgraphics]` (carts/ships) — same flat grammar as the animals
 *    `.ini`, differing only in cross-ref key (`logicvehicle`, left `undefined`), so it reuses
 *    {@link extractGraphicsBindings}; ships only as encrypted `.cif`;
 *  - base `.../humans/jobgraphics.cif` `[jobbasegraphics]` (base appearance) and `[jobchangegraphics]`
 *    (per-job equipment skin) — the human body/head bob sets, `.cif`-only (no readable twin), decoded via
 *    {@link decodeCifStringArray} → {@link cifLinesToSections} into the same {@link RuleSection} model;
 *  - base `.../landscapes/landscapes.cif` `[GfxLandscape]` — the map's pre-placed landscape-object bobs;
 *  - with `--mod`, the mod's readable twins (golden rule #4): `types/humanstype/jobgraphics.ini`,
 *    `types/vehiclestype/jobgraphics.ini` (broader per-tribe cart/ship recolours), and
 *    `budynki12/houses/houses.ini` `[GfxHouse]` building bindings ({@link extractBuildingGraphics}).
 *
 * All human/vehicle sources flatten via {@link jobBaseGraphicsToBindings}/{@link extractGraphicsBindings}
 * into one flat shape; landscape and house bindings dedup on `(bmd, palette)` (see the push sites). The
 * palette index comes from `.../palettes/palettes.ini`. `.ini` sources decode as CP1250 (Polish display
 * names) via {@link decodeIni}; `.cif` text is latin1. A missing/corrupt file contributes nothing (with a
 * warning) so a partial install still runs the rest of the pipeline.
 *
 * The goods graphics table (`goods/goodgraphics.cif`) is intentionally not read: its `[goodgraphics]`
 * records carry only a `graphicshumanrandompalette` runtime-tint name and no `gfxbobmanagerbody`, so there
 * is no bob set to atlas (carried-good sprites live in the human/vehicle sheets, tinted at runtime).
 */
export async function resolveGraphicsBindings(
  gameDir: string,
  mod: string | undefined,
): Promise<GraphicsBindingSet> {
  const readIni = async (rel: string): Promise<RuleSection[] | undefined> => {
    const path = join(gameDir, rel);
    try {
      return parseIniSections(decodeIni(await readFile(path)));
    } catch {
      console.warn(`[pipeline] graphics binding source not found, skipping: ${rel}`);
      return undefined;
    }
  };
  const readCif = async (rel: string): Promise<RuleSection[] | undefined> => {
    const path = join(gameDir, rel);
    try {
      return cifLinesToSections(decodeCifStringArray(await readFile(path)).lines);
    } catch {
      console.warn(`[pipeline] graphics binding source not found or corrupt, skipping: ${rel}`);
      return undefined;
    }
  };
  const jobgraphics = await readIni(join('Data', 'engine2d', 'inis', 'animals', 'jobgraphics.ini'));
  const vehiclesCif = await readCif(join('Data', 'engine2d', 'inis', 'vehicles', 'jobgraphics.cif'));
  const humansCif = await readCif(join('Data', 'engine2d', 'inis', 'humans', 'jobgraphics.cif'));
  const landscapesCif = await readCif(join('Data', 'engine2d', 'inis', 'landscapes', 'landscapes.cif'));
  const palettesIni = await readIni(join('Data', 'engine2d', 'inis', 'palettes', 'palettes.ini'));
  const bindings: BmdPaletteBinding[] = jobgraphics ? extractGraphicsBindings(jobgraphics) : [];
  // Vehicles use the identical flat [jobgraphics] grammar as the animals .ini (carts/ships), so the
  // same extractor applies; only the cross-ref differs (logicvehicle, left undefined as jobId).
  if (vehiclesCif) bindings.push(...extractGraphicsBindings(vehiclesCif));
  if (humansCif) {
    // The base humans .cif carries both layers: [jobbasegraphics] (base appearance) and
    // [jobchangegraphics] (per-job equipment skins). Both flatten through the same path.
    bindings.push(...jobBaseGraphicsToBindings(extractJobBaseGraphics(humansCif)));
    bindings.push(...jobBaseGraphicsToBindings(extractJobChangeGraphics(humansCif)));
  }
  if (landscapesCif) {
    // The base-only [GfxLandscape] table (.cif, no .ini twin): the map's pre-placed landscape-object
    // bobs (trees `ls_trees.bmd`, bushes, signs, wonders, harbours, …) bound to their palette editname —
    // the leg that makes `ls_trees.bmd` (the woodcutter's tree) an atlas. The ~99 tree species share a
    // dozen palettes and decor records repeat one bob across variants, so the records dedup on (bmd, palette).
    pushDeduped(bindings, extractLandscapeGraphics(landscapesCif));
  }
  // The `.bmd`s claimed by a [GfxHouse] record bake `'build-time'` (`convertBmdTree`'s `buildTimeBmds`):
  // a house bob's Double8Bit second bytes are measured construction-progress thresholds, not coverage
  // (they span ~0–255 and are strongly row-correlated bottom-up — foundation low, roof high; read as
  // alpha they draw the solid buildings as 40% ghosts). The colour plane bakes opaque (the engine's
  // plain PrintBob blit) and the thresholds bake into the sibling `.build.png` the renderer's
  // per-pixel construction reveal reads (PrintBob_UsingTimeMask semantics; the oracle has no call
  // sites, so the routing is inferred from the measurements). Keyed on the `.bmd` path alone so every
  // palette variant — including the [GfxLandscape] residence/wonder twins — bakes the same way.
  // Caveat: [GfxHouse] is read only from the mod's houses.ini, so a mod-less run bakes house-family
  // bmds per-pixel — acceptable while the documented run always passes --mod.
  const buildTimeBmds = new Set<string>();
  if (mod !== undefined) {
    const humanGraphics = await readIni(join(mod, 'types', 'humanstype', 'jobgraphics.ini'));
    if (humanGraphics) {
      bindings.push(...jobBaseGraphicsToBindings(extractJobBaseGraphics(humanGraphics)));
      bindings.push(...jobBaseGraphicsToBindings(extractJobChangeGraphics(humanGraphics)));
    }
    // The mod ships a readable [jobgraphics] twin of the base vehicles .cif (golden rule #4):
    // `types/vehiclestype/jobgraphics.ini` overlays the base cart/ship recolours, and the
    // culturesnation mod carries the broader per-tribe set (22 records across tribes 1..4 vs the
    // base .cif's 6 across tribes 1 & 4 only). The flat [jobgraphics] grammar is identical, so the
    // same extractor applies; `convertBmdTree` keys atlases on (bmd, palette), so the base bindings'
    // (bmd, palette) pairs — a strict subset of the mod's — emit the same atlas files either way,
    // while the mod's extra tribe-2/3 rows carry the per-tribe logicvehicle cross-refs.
    const vehicleGraphics = await readIni(join(mod, 'types', 'vehiclestype', 'jobgraphics.ini'));
    if (vehicleGraphics) bindings.push(...extractGraphicsBindings(vehicleGraphics));
    // The mod's readable [GfxHouse] graphics table (`budynki12/houses/houses.ini`): every settlement
    // house bound to its `ls_houses_*.bmd` body + palette — the leg that turns the house bobs into
    // atlases (the warehouse's `ls_houses_viking.house02` among them). Like the landscape leg, a house
    // record commonly repeats one bob+palette across tribes/levels (the ~25 viking-home records all bind
    // `ls_houses_viking` + `house01`/`house02`), so the records dedup on (bmd, palette).
    const buildingGraphics = await readIni(join(mod, 'budynki12', 'houses', 'houses.ini'));
    if (buildingGraphics) {
      pushDeduped(bindings, extractBuildingGraphics(buildingGraphics), (b) => buildTimeBmds.add(b.bmd));
    }
  }
  // The scout's guidepost (the signpost object) is bound by the ENGINE, not by any data table —
  // "guidepost" appears in no decodable binding (landscapes.cif and palettes.ini both checked), only in
  // the executables — so this one binding is hand-authored, appended last, to emit its atlas. Frame
  // layout (decoded): bob 0 is the post, bobs 1..18 the direction board in ~20° angular steps around
  // the post top. The engine draws the guidepost through the OWNER'S full player palette (the
  // board-text indices 23–30 sit inside the `playerNN.pcx` player ramp) — served as 16 per-player BAKED
  // atlases (`convertGuidepostPlayerAtlases`, stages/player-colors.ts; the indexed+LUT path would
  // flatten the sprite's graded edge alpha). This baked `bridge01` variant stays as the single-colour
  // fallback (a plausible wooden palette, a named approximation). Skipped silently by convertBmdTree on
  // an install with no such file/palette.
  bindings.push({
    bmd: 'data/engine2d/bin/bobs/ls_guidepost.bmd',
    shadowBmd: 'data/engine2d/bin/bobs/ls_guidepost_s.bmd',
    paletteName: 'bridge01',
    tribeId: undefined,
    jobId: undefined,
  });
  return {
    bindings,
    palettes: palettesIni ? extractPaletteIndex(palettesIni) : [],
    buildTimeBmds,
  };
}
