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

/** The `(bmd, palette)` identity of a binding — the unit an atlas file is emitted (and deduped) per. */
function bindingKey(binding: Pick<BmdPaletteBinding, 'bmd' | 'paletteName'>): string {
  return `${binding.bmd} ${binding.paletteName}`;
}

/**
 * Flattens the mod's richer `[jobbasegraphics]` records ({@link JobBaseGraphicsBinding}) into the flat
 * {@link BmdPaletteBinding} shape {@link import('./convert.js').convertBmdTree} already consumes — so the
 * human body/head bob sets reuse the exact same resolve→decode→atlas path as the readable `[jobgraphics]`
 * animals leg, with no second copy of the conversion logic. A human draws from a **body** bob (coloured by
 * `gfxpalettebasebody`) plus numbered **head** bobs (coloured by `gfxpalettebasehead`), so each indexed
 * slot becomes one binding paired with the matching palette. A slot whose palette `editname` is absent
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
 * Reads the graphics-binding sources and extracts the `.bmd`→palette pairing from every binding skin:
 *
 *  - the base `Data/engine2d/inis/animals/jobgraphics.ini` `[jobgraphics]` records (the one animals
 *    binding file shipped as plain `.ini`);
 *  - the base `Data/engine2d/inis/vehicles/jobgraphics.cif` `[jobgraphics]` records (carts/ships) — the
 *    **same flat grammar** as the animals `.ini` (`gfxbobmanagerbody`/`gfxpalettebody`), differing only
 *    in the cross-ref key (`logicvehicle` instead of `logicjob`, which is simply left `undefined`), so it
 *    reuses {@link extractGraphicsBindings} verbatim; it ships *only* as encrypted `.cif`;
 *  - the base `Data/engine2d/inis/humans/jobgraphics.cif` `[jobbasegraphics]` (base appearance) **and**
 *    `[jobchangegraphics]` (per-job equipment skin) records — the **base-game human body/head bob
 *    sets**, which ship *only* as encrypted `.cif` (no readable `.ini` twin, so this is the `.cif`-only
 *    graphics binding leg), decoded via {@link decodeCifStringArray} → {@link cifLinesToSections} into
 *    the same {@link RuleSection} model the `.ini` parser yields;
 *  - and, when a `--mod` is given, the mod's `<mod>/types/humanstype/jobgraphics.ini`
 *    `[jobbasegraphics]` + `[jobchangegraphics]` records (the readable mod human skin, golden rule #4 —
 *    overlays the base-game humans above), plus the mod's `<mod>/types/vehiclestype/jobgraphics.ini`
 *    `[jobgraphics]` records — the readable twin of the base vehicles `.cif` (golden rule #4 again),
 *    carrying the culturesnation mod's broader per-tribe cart/ship recolours (tribes 1..4, not just the
 *    base's 1 & 4). Same flat grammar, so it reuses {@link extractGraphicsBindings}; the base bindings'
 *    `(bmd, palette)` pairs are a subset of the mod's, so {@link import('./convert.js').convertBmdTree}
 *    (which keys atlases on `(bmd, palette)`) emits the same atlas files either way while gaining the
 *    extra tribes' cross-refs.
 *  - and the mod's `<mod>/budynki12/houses/houses.ini` `[GfxHouse]` records (the readable graphics twin
 *    of the logic `houses.ini`) — the **building** binding ({@link extractBuildingGraphics}): every
 *    settlement house's `ls_houses_*.bmd` body bound to its palette(s), the leg that makes the house bobs
 *    atlases (the warehouse's `ls_houses_viking` + `house02` among them, the missing-asset gap). A house
 *    record can list several palettes on one `GfxPalette` line (one body, many skins), so it is deduped on
 *    `(bmd, palette)` here as the landscape leg is.
 *
 * Both the base-appearance (`[jobbasegraphics]`) and equipment-skin (`[jobchangegraphics]`) layers share
 * the same grammar, so all four sources flatten via {@link jobBaseGraphicsToBindings} into the same flat
 * shape as the `[jobgraphics]` animals. The palette index comes from
 * `Data/engine2d/inis/palettes/palettes.ini`. The `.ini` sources are decoded as CP1250 (display names
 * carry Polish glyphs) via {@link decodeIni}, like every other rule source; the `.cif` text is latin1
 * (structural keywords are ASCII). A missing/corrupt file contributes nothing (with a warning) — a
 * partial install (or no mod) still runs the rest of the pipeline rather than aborting.
 *
 * Returns the merged bindings + the `palettes.ini` name→`.pcx` index, ready to hand to
 * {@link import('./convert.js').convertBmdTree}. The goods graphics table (`goods/goodgraphics.cif`) is
 * intentionally *not* read here: its `[goodgraphics]` records carry only a `graphicshumanrandompalette`
 * runtime-tint name and **no `gfxbobmanagerbody`** — there is no bob set to colour into an atlas, so it
 * contributes zero bindings (the carried-good sprites live in the human/vehicle bob sheets, tinted at runtime).
 */
export async function resolveGraphicsBindings(
  gameDir: string,
  mod: string | undefined,
): Promise<{ bindings: BmdPaletteBinding[]; palettes: PaletteAlias[]; opaqueAlphaBmds: Set<string> }> {
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
    // dozen palettes, and decor records repeat one bob across variants, so dedup on (bmd, palette)
    // BEFORE pushing: a duplicate would only make `convertBmdTree` re-emit identical bytes. Scoped to the
    // landscape additions so the human/animal/vehicle bindings array stays byte-identical to before.
    const seen = new Set<string>();
    for (const b of extractLandscapeGraphics(landscapesCif)) {
      const key = bindingKey(b);
      if (seen.has(key)) continue;
      seen.add(key);
      bindings.push(b);
    }
  }
  // The `.bmd`s claimed by a [GfxHouse] record bake OPAQUE (`convertBmdTree`'s `opaqueAlphaBmds`):
  // a house bob's Double8Bit alpha bytes are measured NON-coverage (mean ≈100 across solid
  // walls/roofs — used as alpha, the original's solid buildings would draw as 40% ghosts; the corpus
  // shows them solid), so the house atlases replay the engine's plain PrintBob blit, which skips that
  // byte. The routing is inferred from those measurements + the corpus — the oracle documents both
  // blit paths' pixel semantics but has no call sites. Keyed on the `.bmd` path alone (the alpha bytes
  // live in the shared bob geometry), so EVERY palette variant — including the [GfxLandscape] twins
  // (residence houses / wonders placed as map decor) — bakes the same way. CAVEAT: [GfxHouse] is read
  // only from the mod's houses.ini, so a mod-less run bakes house-family bmds per-pixel — acceptable
  // while the documented run always passes --mod; revisit if a base-game-only run becomes real.
  const opaqueAlphaBmds = new Set<string>();
  if (mod !== undefined) {
    const humanGraphics = await readIni(join(mod, 'types', 'humanstype', 'jobgraphics.ini'));
    if (humanGraphics) {
      bindings.push(...jobBaseGraphicsToBindings(extractJobBaseGraphics(humanGraphics)));
      bindings.push(...jobBaseGraphicsToBindings(extractJobChangeGraphics(humanGraphics)));
    }
    // The mod ships a readable [jobgraphics] twin of the base vehicles .cif (golden rule #4):
    // `types/vehiclestype/jobgraphics.ini` overlays the base cart/ship recolours, and the
    // culturesnation mod carries the BROADER per-tribe set (22 records across tribes 1..4 vs the
    // base .cif's 6 across tribes 1 & 4 only). The flat [jobgraphics] grammar is identical, so the
    // same extractor applies; `convertBmdTree` keys atlases on (bmd, palette), so the base bindings'
    // (bmd, palette) pairs — a strict subset of the mod's — emit the same atlas files either way,
    // while the mod's extra tribe-2/3 rows carry the per-tribe logicvehicle cross-refs.
    const vehicleGraphics = await readIni(join(mod, 'types', 'vehiclestype', 'jobgraphics.ini'));
    if (vehicleGraphics) bindings.push(...extractGraphicsBindings(vehicleGraphics));
    // The mod's readable [GfxHouse] graphics table (`budynki12/houses/houses.ini`): every settlement
    // house bound to its `ls_houses_*.bmd` body + palette — the leg that turns the house bobs into
    // atlases (the warehouse's `ls_houses_viking.house02` among them). Like the landscape leg, dedup on
    // (bmd, palette) BEFORE pushing: a house record commonly repeats one bob+palette across tribes/levels
    // (the ~25 viking-home records all bind `ls_houses_viking` + `house01`/`house02`), and a duplicate
    // would only make convertBmdTree re-emit identical bytes. Scoped to the building additions so the
    // human/animal/vehicle/landscape bindings array stays byte-identical to before.
    const buildingGraphics = await readIni(join(mod, 'budynki12', 'houses', 'houses.ini'));
    if (buildingGraphics) {
      const seen = new Set<string>();
      for (const b of extractBuildingGraphics(buildingGraphics)) {
        opaqueAlphaBmds.add(b.bmd);
        const key = bindingKey(b);
        if (seen.has(key)) continue;
        seen.add(key);
        bindings.push(b);
      }
    }
  }
  return {
    bindings,
    palettes: palettesIni ? extractPaletteIndex(palettesIni) : [],
    opaqueAlphaBmds,
  };
}
