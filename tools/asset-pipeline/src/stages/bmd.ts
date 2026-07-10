import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { type AtlasAlphaMode, type BobAtlas, packBobAtlas } from '../decoders/atlas.js';
import { decodeBmd } from '../decoders/bmd.js';
import { decodeCifStringArray } from '../decoders/cif.js';
import {
  type BmdPaletteBinding,
  type JobBaseGraphicsBinding,
  type PaletteAlias,
  type RuleSection,
  cifLinesToSections,
  decodeIni,
  extractBuildingGraphics,
  extractGraphicsBindings,
  extractJobBaseGraphics,
  extractJobChangeGraphics,
  extractLandscapeGraphics,
  extractPaletteIndex,
  parseIniSections,
} from '../decoders/ini.js';
import { decodePcx } from '../decoders/pcx.js';
import { encodePng } from '../decoders/png.js';
import { walkFiles } from '../walk.js';

/**
 * Pure composition: `.bmd` bytes + a 768-byte RGB palette -> a packed bob atlas (the RGBA sheet to
 * PNG-encode + the JSON manifest of per-bob frame rects/metadata). Mirrors {@link pcxToPng}: the
 * decoders stay pure, this is the only wiring between them. The atlas PNG is `encodePng(atlas.image)`;
 * the manifest serializes straight to JSON. Throws a `bmd:`/`atlas:`-prefixed error for a malformed
 * container or a wrong-sized palette — the batch tree-walk (a later step) catches it per-file. The
 * **palette source** for a given `.bmd` (which `palettes.ini` entry / `.pcx` trailer pairs with it) is
 * the open question that gates the full tree-walk, so this seam takes the palette as a parameter today.
 * `alpha` picks the bake mode — see {@link AtlasAlphaMode}; the house atlases need `'opaque'`.
 */
export function bmdToAtlas(
  bmdBytes: Uint8Array,
  palette: Uint8Array,
  alpha: AtlasAlphaMode = 'per-pixel',
): BobAtlas {
  return packBobAtlas(decodeBmd(bmdBytes), palette, { alpha });
}

/**
 * Builds a case-insensitive index of the unpacked tree: `normalizeAssetPath(rel)` -> the real on-disk
 * relative path (native separators). The binding extractors lower-case + forward-slash their `.bmd`/
 * `.pcx` references, but the unpacked `.lib` members keep the archive's original (mixed) case, so a
 * direct `join(out, ref)` would miss on a case-sensitive filesystem. This map bridges the two: look a
 * normalized reference up to get the real path under `outDir`. Built once per run and shared by every
 * binding. Mirrors the `normalizeAssetPath` the extractors use (forward slashes, lower-case).
 */
export async function indexOutTree(outDir: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  for await (const file of walkFiles(outDir)) {
    const rel = relative(outDir, file);
    index.set(rel.replace(/\\/g, '/').toLowerCase(), rel);
  }
  return index;
}

/** One emitted bob atlas: the binding it came from plus the relative atlas PNG / manifest JSON paths. */
export interface BmdConversion {
  /** The body `.bmd`'s path under `outDir`, normalized (forward slashes, lower-case) — the binding key. */
  readonly bmd: string;
  /** The palette `editname` this atlas was recoloured with — the per-creature differentiator. */
  readonly paletteName: string;
  /** The atlas PNG's path relative to `outDir` (native separators). */
  readonly png: string;
  /** The atlas manifest JSON's path relative to `outDir` (native separators). */
  readonly manifest: string;
}

/**
 * Filesystem-safe slug of a palette `editname` for use as an output-filename component. Palette names
 * are already lower-cased ({@link normalizePaletteName}) and in the real data are bare identifiers like
 * `bear01`/`vik_man_base`/`test_human_00`, but a stray space or punctuation would otherwise leak into a
 * path — collapse every non-`[a-z0-9_]` run to a single `_` so the atlas name stays portable and stable.
 */
function paletteSlug(name: string): string {
  return name.replace(/[^a-z0-9_]+/g, '_');
}

/** The `(bmd, palette)` identity of a binding — the unit an atlas file is emitted (and deduped) per. */
function bindingKey(binding: Pick<BmdPaletteBinding, 'bmd' | 'paletteName'>): string {
  return `${binding.bmd} ${binding.paletteName}`;
}

/**
 * Flattens the mod's richer `[jobbasegraphics]` records ({@link JobBaseGraphicsBinding}) into the flat
 * {@link BmdPaletteBinding} shape {@link convertBmdTree} already consumes — so the human body/head bob
 * sets reuse the exact same resolve→decode→atlas path as the readable `[jobgraphics]` animals leg, with
 * no second copy of the conversion logic. A human draws from a **body** bob (coloured by
 * `gfxpalettebasebody`) plus numbered **head** bobs (coloured by `gfxpalettebasehead`), so each indexed
 * slot becomes one binding paired with the matching palette. A slot whose palette `editname` is absent
 * is dropped here (there is nothing to resolve it against — not even a name {@link convertBmdTree} could
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
 * Converts the body `.bmd` of every readable `[jobgraphics]` binding into a packed atlas PNG + a
 * manifest JSON, written as siblings of the `.bmd` under `outDir`. This wires the `.bmd`→palette
 * pairing graph end-to-end: {@link extractGraphicsBindings} names each `.bmd`'s palette `editname`,
 * {@link extractPaletteIndex} resolves that name to a palette `.pcx`, and the `.pcx` trailer palette
 * colours the bob frames via {@link bmdToAtlas}. Both the `.bmd` and the palette `.pcx` are read from
 * the unpacked `--out` tree (the `.lib` unpack stage extracted them there); {@link indexOutTree}
 * resolves the extractors' lower-cased references to the real (mixed-case) on-disk paths.
 *
 * Per-binding boundary failures are warned-and-skipped, never fatal — an unresolvable palette name, a
 * `.pcx`/`.bmd` missing from `--out`, a palette-less `.pcx`, or a malformed `.bmd` only drops that one
 * atlas, matching the other tree-walk stages. Each binding emits `<bmd>.<palette>.png` (the atlas sheet)
 * and `<bmd>.<palette>.atlas.json` (the per-bob frame manifest), keyed by the palette `editname`: many
 * bindings share one body `.bmd` recoloured per creature (the animals are a single geometry, the humans
 * one body re-tinted per tribe/job), so naming on the `.bmd` alone would collapse them onto one file
 * (last-palette-wins). The palette name is the only per-creature differentiator, so it goes in the
 * filename — `(bmd, palette)` now names a distinct atlas. The shadow `.bmd` is left for a later step
 * (shadows use a separate, single-colour palette path).
 *
 * `opaqueAlphaBmds` (the `.bmd` paths claimed by a `[GfxHouse]` record — see
 * {@link resolveGraphicsBindings}) bake with the plain opaque blit instead of the Double8Bit
 * per-pixel alpha: a house bob's alpha bytes are measured non-coverage, so drawing them as alpha
 * ghosts the buildings. Keyed on the `.bmd` path alone — NOT `(bmd, palette)` — because the alpha
 * bytes live in the bob geometry the recolours share: every palette variant of a claimed `.bmd`
 * (including the `[GfxLandscape]` twins — residence houses / wonders placed as map decor) must bake
 * the same way, or identical pixels would go ghost-vs-solid by recolour name. REQUIRED (no default):
 * an accidentally-empty set silently ghosts every building, so the one production caller passes the
 * set explicitly.
 */
export async function convertBmdTree(
  bindings: readonly BmdPaletteBinding[],
  palettes: readonly PaletteAlias[],
  outDir: string,
  opaqueAlphaBmds: ReadonlySet<string>,
): Promise<BmdConversion[]> {
  const done: BmdConversion[] = [];
  const paletteByName = new Map<string, string>();
  for (const alias of palettes) {
    // First alias wins on a duplicate name; the real palettes.ini has none, but stay deterministic.
    if (!paletteByName.has(alias.name)) paletteByName.set(alias.name, alias.gfxFile);
  }
  const tree = await indexOutTree(outDir);
  for (const binding of bindings) {
    const pcxRel = paletteByName.get(binding.paletteName);
    if (pcxRel === undefined) {
      console.warn(`[pipeline] skipped ${binding.bmd}: unknown palette "${binding.paletteName}"`);
      continue;
    }
    const pcxOnDisk = tree.get(pcxRel);
    const bmdOnDisk = tree.get(binding.bmd);
    if (pcxOnDisk === undefined || bmdOnDisk === undefined) {
      const missing = pcxOnDisk === undefined ? `palette ${pcxRel}` : `bmd ${binding.bmd}`;
      console.warn(`[pipeline] skipped ${binding.bmd}: ${missing} not found under out`);
      continue;
    }
    let atlas: BobAtlas;
    try {
      const palette = decodePcx(await readFile(join(outDir, pcxOnDisk))).palette;
      if (palette === undefined) {
        console.warn(`[pipeline] skipped ${binding.bmd}: palette ${pcxRel} has no trailer`);
        continue;
      }
      const alpha: AtlasAlphaMode = opaqueAlphaBmds.has(binding.bmd) ? 'opaque' : 'per-pixel';
      atlas = bmdToAtlas(await readFile(join(outDir, bmdOnDisk)), palette, alpha);
    } catch (err) {
      console.warn(`[pipeline] skipped ${binding.bmd}: ${(err as Error).message}`);
      continue;
    }
    if (!/\.bmd$/i.test(bmdOnDisk)) {
      // A `.bmd`-less name would make the output paths collide with the source — skip rather than
      // clobber the input bytes. The extractor only emits `gfxbobmanagerbody` `.bmd` paths, so this is
      // a defensive guard, not an expected case.
      console.warn(`[pipeline] skipped ${binding.bmd}: source has no .bmd extension`);
      continue;
    }
    // Name on (bmd, palette), not the .bmd alone: many bindings share one body bob recoloured per
    // creature, so `<bmd>.png` would collapse them last-palette-wins. The palette editname is the only
    // per-creature differentiator, so it rides in the filename — `<bmd-stem>.<palette>.png`.
    const suffix = paletteSlug(binding.paletteName);
    const pngRel = bmdOnDisk.replace(/\.bmd$/i, `.${suffix}.png`);
    const manifestRel = bmdOnDisk.replace(/\.bmd$/i, `.${suffix}.atlas.json`);
    await writeFile(join(outDir, pngRel), encodePng(atlas.image));
    await writeFile(join(outDir, manifestRel), `${JSON.stringify(atlas.manifest, null, 2)}\n`);
    done.push({ bmd: binding.bmd, paletteName: binding.paletteName, png: pngRel, manifest: manifestRel });
  }
  return done;
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
 *    `(bmd, palette)` pairs are a subset of the mod's, so {@link convertBmdTree} (which keys atlases on
 *    `(bmd, palette)`) emits the same atlas files either way while gaining the extra tribes' cross-refs.
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
 * {@link convertBmdTree}. The goods graphics table (`goods/goodgraphics.cif`) is intentionally *not*
 * read here: its `[goodgraphics]` records carry only a `graphicshumanrandompalette` runtime-tint name
 * and **no `gfxbobmanagerbody`** — there is no bob set to colour into an atlas, so it contributes zero
 * bindings (the carried-good sprites live in the human/vehicle bob sheets, tinted at runtime).
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
