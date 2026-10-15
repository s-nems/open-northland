import {
  type BmdPaletteBinding,
  cifBytesToSections,
  extractBuildingBobs,
  extractBuildingGraphics,
  extractBuildingOverlays,
  extractConstructionLayers,
  extractGraphicsBindings,
  extractJobBaseGraphics,
  extractJobChangeGraphics,
  extractLandscapeGraphics,
  extractPaletteIndex,
  extractParticleGraphics,
  iniBytesToSections,
  type JobBaseGraphicsBinding,
  type PaletteAlias,
  type RuleSection,
} from '@open-northland/formats/ini';
import {
  BASE_BUILDING_GRAPHICS_FILE,
  BUILDING_GRAPHICS_FILE,
  HUMAN_GRAPHICS_FILE,
  VEHICLE_GRAPHICS_FILE,
} from '../../data-layout.js';
import { readSourceFile, resolveSourceFile, type SourceRoots } from '../../roots.js';
import { loadBaseOnlyHouseRecords } from '../base-houses.js';

/**
 * One graphics-binding resolution: every `(bmd, palette)` binding, the palette `editname` index, and per
 * `.bmd` the bob ids that bake build-time alpha.
 */
export interface GraphicsBindingSet {
  readonly bindings: readonly BmdPaletteBinding[];
  readonly palettes: readonly PaletteAlias[];
  readonly buildTimeBobs: ReadonlyMap<string, ReadonlySet<number>>;
}

/** The `(bmd, palette)` identity of a binding - the unit an atlas file is emitted (and deduped) per. */
export function bindingKey(binding: Pick<BmdPaletteBinding, 'bmd' | 'paletteName'>): string {
  return `${binding.bmd} ${binding.paletteName}`;
}

/**
 * Drops `(bmd, palette)` duplicates within one source's records, keeping the first. Scoped to the
 * source, not to the bindings already accumulated: a pair a later source repeats dedups at conversion.
 */
function dedupeBindings(records: readonly BmdPaletteBinding[]): BmdPaletteBinding[] {
  const seen = new Set<string>();
  return records.filter((binding) => {
    const key = bindingKey(binding);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Flattens `[jobbasegraphics]` records into the flat {@link BmdPaletteBinding} shape. A human draws from
 * a body bob (coloured by `gfxpalettebasebody`) plus numbered head bobs (`gfxpalettebasehead`), so each
 * indexed slot becomes one binding paired with its palette. A body without `gfxpalettebasebody` uses the
 * same `test_human_00` floor as the runtime look join, which keeps body-only hero records such as Grizzu
 * decodable.
 * A head whose palette `editname` is absent is dropped.
 */
export function jobBaseGraphicsToBindings(records: readonly JobBaseGraphicsBinding[]): BmdPaletteBinding[] {
  const bindings: BmdPaletteBinding[] = [];
  for (const rec of records) {
    for (const slot of rec.body) {
      bindings.push({
        bmd: slot.bmd,
        shadowBmd: slot.shadowBmd,
        paletteName: rec.bodyPalette ?? 'test_human_00',
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

/** One binding skin: where it lives, how its records reach the flat {@link BmdPaletteBinding} shape,
 *  and the per-source handling applied to them. */
interface GraphicsBindingSource {
  /** Path under the data root: binary base tables or readable rule tables. */
  readonly path: string;
  readonly encrypted?: true;
  /** Reads the sections in place of decoding `path` whole. */
  readonly load?: (roots: SourceRoots) => Promise<RuleSection[] | undefined>;
  readonly read: (sections: readonly RuleSection[]) => readonly BmdPaletteBinding[];
  readonly dedupe?: true;
  /** The bobs whose second byte is a construction-progress threshold rather than coverage
   *  (`AtlasAlphaMode`). */
  readonly buildTimeBobs?: (sections: readonly RuleSection[]) => Iterable<HouseDrawnBob>;
}

interface HouseDrawnBob {
  readonly bmd: string;
  readonly bobId: number;
}

/** Every bob a `[GfxHouse]` record draws: finished bodies, construction stages and state overlays. Other
 *  bobs of the same `.bmd` (a landscape element such as the lighthouse light) keep per-pixel alpha. */
function* houseDrawnBobs(sections: readonly RuleSection[]): Generator<HouseDrawnBob> {
  const src = { file: 'GfxHouse' }; // the extractors stamp provenance; only bmd and bob ids are kept
  for (const row of extractBuildingBobs(sections, src)) yield row;
  for (const row of extractConstructionLayers(sections, src)) yield row;
  for (const row of extractBuildingOverlays(sections, src))
    for (const bobId of row.frames) yield { bmd: row.bmd, bobId };
}

const INIS = 'Data/engine2d/inis';

/** Both `[jobbasegraphics]` (base appearance) and `[jobchangegraphics]` (per-job equipment skin) layers
 *  of a human graphics file, flattened onto the one binding shape the conversion consumes. */
function readHumanJobGraphics(sections: readonly RuleSection[]): BmdPaletteBinding[] {
  return [
    ...jobBaseGraphicsToBindings(extractJobBaseGraphics(sections)),
    ...jobBaseGraphicsToBindings(extractJobChangeGraphics(sections)),
  ];
}

/** The binding skins, in the order their records enter the binding list. */
const GRAPHICS_BINDING_SOURCES: readonly GraphicsBindingSource[] = [
  { path: `${INIS}/animals/jobgraphics.ini`, read: extractGraphicsBindings },
  /** Carts and ships. Same flat `[jobgraphics]` grammar as the animals `.ini`, differing only in
   *  cross-ref key (`logicvehicle`, which leaves `jobId` undefined). */
  {
    path: `${INIS}/vehicles/jobgraphics.cif`,
    encrypted: true,
    read: extractGraphicsBindings,
  },
  /** The human body/head bob sets, `.cif`-only (no readable twin). */
  {
    path: `${INIS}/humans/jobgraphics.cif`,
    encrypted: true,
    read: readHumanJobGraphics,
  },
  /** The map's pre-placed landscape-object bobs (trees, bushes, signs, wonders, harbours). The ~99 tree
   *  species share a dozen palettes, so records repeat a `(bmd, palette)` pair. */
  {
    path: `${INIS}/landscapes/landscapes.cif`,
    encrypted: true,
    read: extractLandscapeGraphics,
    dedupe: true,
  },
  /** The shots, trails and puffs the engine flies or stages (`Rock` in `ls_smoke` under `rock03`). */
  {
    path: `${INIS}/particel/particel.cif`,
    encrypted: true,
    read: extractParticleGraphics,
    dedupe: true,
  },
  /** The readable human graphics rules. */
  { path: HUMAN_GRAPHICS_FILE, read: readHumanJobGraphics },
  /** The readable per-tribe cart/ship set (22 records across tribes 1..4 against the base `.cif`'s
   *  6 across tribes 1 and 4); the base pairs are a strict subset and dedup at conversion. */
  {
    path: VEHICLE_GRAPHICS_FILE,
    read: extractGraphicsBindings,
  },
  /** Every settlement house bound to its `ls_houses_*.bmd` body and palette. Records repeat a
   *  bob+palette across tribes and levels (the ~25 viking-home records all bind `ls_houses_viking` with
   *  `house01`/`house02`). The only source claiming build-time bobs. */
  {
    path: BUILDING_GRAPHICS_FILE,
    read: extractBuildingGraphics,
    dedupe: true,
    buildTimeBobs: houseDrawnBobs,
  },
  /** The base houses whose names the readable table above does not define. */
  {
    path: BASE_BUILDING_GRAPHICS_FILE,
    load: async (roots) =>
      loadBaseOnlyHouseRecords(roots, (await readSections(roots, BUILDING_GRAPHICS_FILE)) ?? []),
    read: extractBuildingGraphics,
    dedupe: true,
    buildTimeBobs: houseDrawnBobs,
  },
];

/** The palette `editname` index every binding's `paletteName` resolves against. */
const PALETTE_INDEX_INI = `${INIS}/palettes/palettes.ini`;

/**
 * The scout's guidepost is bound by the engine, not by any data table: "guidepost" appears in no
 * decodable binding (landscapes.cif and palettes.ini both checked), so it is hand-authored here.
 * Decoded frame layout: bob 0 is the post, bobs 1..18 the direction board in ~20 degree steps around
 * the post top. `bridge01` is a named approximation, the single-colour fallback for the per-player
 * atlases `convertGuidepostPlayerAtlases` bakes.
 */
const GUIDEPOST_BINDING: BmdPaletteBinding = {
  bmd: 'data/engine2d/bin/bobs/ls_guidepost.bmd',
  shadowBmd: 'data/engine2d/bin/bobs/ls_guidepost_s.bmd',
  paletteName: 'bridge01',
  tribeId: undefined,
  jobId: undefined,
};

/** The fish manager chooses this bob set and palette directly; no landscape record binds the pair. */
const FISH_BINDING: BmdPaletteBinding = {
  bmd: 'data/engine2d/bin/bobs/ls_fishes.bmd',
  shadowBmd: undefined,
  paletteName: 'fishes',
  tribeId: undefined,
  jobId: undefined,
};

/** Decodes one source into sections, or warns and yields nothing so a partial install still converts. */
async function readSections(
  roots: SourceRoots,
  relPath: string,
  encrypted = false,
): Promise<RuleSection[] | undefined> {
  try {
    const path = await resolveSourceFile(roots, relPath);
    if (path === undefined) throw new Error('unresolved');
    const bytes = await readSourceFile(roots, path);
    return encrypted ? cifBytesToSections(bytes) : iniBytesToSections(bytes);
  } catch {
    console.warn(`[pipeline] graphics binding source not found or corrupt, skipping: ${relPath}`);
    return undefined;
  }
}

/**
 * Reads every {@link GRAPHICS_BINDING_SOURCES} skin and merges their `.bmd`-to-palette pairings into one
 * flat list, followed by the engine-owned fish and guidepost bindings.
 *
 * The goods graphics table (`goods/goodgraphics.cif`) is deliberately absent: its `[goodgraphics]`
 * records carry only a `graphicshumanrandompalette` runtime-tint name and no `gfxbobmanagerbody`, so
 * there is no bob set to atlas.
 */
export async function resolveGraphicsBindings(roots: SourceRoots): Promise<GraphicsBindingSet> {
  const bindings: BmdPaletteBinding[] = [];
  const buildTimeBobs = new Map<string, Set<number>>();
  for (const source of GRAPHICS_BINDING_SOURCES) {
    const sections = await (source.load?.(roots) ?? readSections(roots, source.path, source.encrypted));
    if (sections === undefined) continue;
    const records = source.read(sections);
    for (const { bmd, bobId } of source.buildTimeBobs?.(sections) ?? []) {
      let bobs = buildTimeBobs.get(bmd);
      if (bobs === undefined) {
        bobs = new Set();
        buildTimeBobs.set(bmd, bobs);
      }
      bobs.add(bobId);
    }
    bindings.push(...(source.dedupe ? dedupeBindings(records) : records));
  }
  bindings.push(FISH_BINDING, GUIDEPOST_BINDING);
  const palettesIni = await readSections(roots, PALETTE_INDEX_INI);
  return {
    bindings,
    palettes: palettesIni ? extractPaletteIndex(palettesIni) : [],
    buildTimeBobs,
  };
}
