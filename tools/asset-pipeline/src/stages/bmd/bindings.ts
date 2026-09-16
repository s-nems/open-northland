import { readFile } from 'node:fs/promises';
import {
  type BmdPaletteBinding,
  cifBytesToSections,
  extractBuildingGraphics,
  extractGraphicsBindings,
  extractJobBaseGraphics,
  extractJobChangeGraphics,
  extractLandscapeGraphics,
  extractPaletteIndex,
  iniBytesToSections,
  type JobBaseGraphicsBinding,
  type PaletteAlias,
  type RuleSection,
} from '../../decoders/ini.js';
import { CULTURESNATION_MOD } from '../../mod-root.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';

/**
 * One graphics-binding resolution: every `(bmd, palette)` binding, the palette `editname` index, and the
 * `.bmd`s that bake build-time alpha.
 */
export interface GraphicsBindingSet {
  readonly bindings: readonly BmdPaletteBinding[];
  readonly palettes: readonly PaletteAlias[];
  readonly buildTimeBmds: ReadonlySet<string>;
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
 * same `test_human_00` floor as the runtime look join; this keeps body-only hero records such as Grizzu
 * decodable while their `gfxpaletterandom` tint remains a separate, currently unsupported runtime range.
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
  /** Path under the mod root: `Data/` for the base tables, `DataCnmd/` for the mod's readable twins. */
  readonly path: string;
  readonly encrypted?: true;
  readonly read: (sections: readonly RuleSection[]) => readonly BmdPaletteBinding[];
  readonly dedupe?: true;
  /** The source's `.bmd`s bake construction-progress thresholds rather than coverage (`AtlasAlphaMode`). */
  readonly buildTime?: true;
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
  /** The mod's readable human twin. */
  { path: `${CULTURESNATION_MOD}/types/humanstype/jobgraphics.ini`, read: readHumanJobGraphics },
  /** The mod's broader per-tribe cart/ship set (22 records across tribes 1..4 against the base `.cif`'s
   *  6 across tribes 1 and 4); the base pairs are a strict subset and dedup at conversion. */
  {
    path: `${CULTURESNATION_MOD}/types/vehiclestype/jobgraphics.ini`,
    read: extractGraphicsBindings,
  },
  /** Every settlement house bound to its `ls_houses_*.bmd` body and palette. Records repeat a
   *  bob+palette across tribes and levels (the ~25 viking-home records all bind `ls_houses_viking` with
   *  `house01`/`house02`). The only source claiming build-time `.bmd`s. */
  {
    path: `${CULTURESNATION_MOD}/budynki12/houses/houses.ini`,
    read: extractBuildingGraphics,
    dedupe: true,
    buildTime: true,
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

/** Decodes one source into sections, or warns and yields nothing so a partial install still converts. */
async function readSections(
  roots: SourceRoots,
  relPath: string,
  encrypted = false,
): Promise<RuleSection[] | undefined> {
  try {
    const path = await resolveSourceFile(roots, relPath);
    if (path === undefined) throw new Error('unresolved');
    const bytes = await readFile(path);
    return encrypted ? cifBytesToSections(bytes) : iniBytesToSections(bytes);
  } catch {
    console.warn(`[pipeline] graphics binding source not found or corrupt, skipping: ${relPath}`);
    return undefined;
  }
}

/**
 * Reads every {@link GRAPHICS_BINDING_SOURCES} skin and merges their `.bmd`-to-palette pairings into one
 * flat list, followed by the {@link GUIDEPOST_BINDING}.
 *
 * The goods graphics table (`goods/goodgraphics.cif`) is deliberately absent: its `[goodgraphics]`
 * records carry only a `graphicshumanrandompalette` runtime-tint name and no `gfxbobmanagerbody`, so
 * there is no bob set to atlas.
 */
export async function resolveGraphicsBindings(roots: SourceRoots): Promise<GraphicsBindingSet> {
  const bindings: BmdPaletteBinding[] = [];
  const buildTimeBmds = new Set<string>();
  for (const source of GRAPHICS_BINDING_SOURCES) {
    const sections = await readSections(roots, source.path, source.encrypted);
    if (sections === undefined) continue;
    const records = source.read(sections);
    if (source.buildTime) for (const record of records) buildTimeBmds.add(record.bmd);
    bindings.push(...(source.dedupe ? dedupeBindings(records) : records));
  }
  bindings.push(GUIDEPOST_BINDING);
  const palettesIni = await readSections(roots, PALETTE_INDEX_INI);
  return {
    bindings,
    palettes: palettesIni ? extractPaletteIndex(palettesIni) : [],
    buildTimeBmds,
  };
}
