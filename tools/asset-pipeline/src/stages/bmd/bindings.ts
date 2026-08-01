import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
import { CULTURESNATION_MOD } from '../../probe.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';

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
export function bindingKey(binding: Pick<BmdPaletteBinding, 'bmd' | 'paletteName'>): string {
  return `${binding.bmd} ${binding.paletteName}`;
}

/**
 * Drops `(bmd, palette)` duplicates within one source's records, keeping the first: the repeats carry
 * no extra cross-refs worth keeping in the binding list. Scoped to the source, not to the bindings
 * already accumulated - a pair a later source repeats is kept and dedups again at conversion.
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
 * Flattens the mod's richer `[jobbasegraphics]` records ({@link JobBaseGraphicsBinding}) into the flat
 * {@link BmdPaletteBinding} shape {@link import('./convert.js').convertBmdTree} already consumes — so the
 * human body/head bob sets reuse the exact same resolve→decode→atlas path as the readable `[jobgraphics]`
 * animals leg, with no second copy of the conversion logic. A human draws from a body bob (coloured by
 * `gfxpalettebasebody`) plus numbered head bobs (coloured by `gfxpalettebasehead`), so each indexed slot
 * becomes one binding paired with the matching palette. A slot whose palette `editname` is absent
 * is dropped here (there is nothing to resolve it against — not even a name `convertBmdTree` could
 * warn about); the `gfxpaletterandom` tint is a per-settler runtime range, not a bob palette, so it is
 * not emitted. The `logictribe`/`logicjob` cross-refs ride along on each binding. Head bobs carry no
 * shadow `.bmd` (the extractor never sets one); body `shadowBmd`s ride along for
 * {@link import('./convert.js').convertShadowBmdTree}.
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

/** One binding skin: where it lives, how its records reach the flat {@link BmdPaletteBinding} shape,
 *  and the per-source handling {@link resolveGraphicsBindings} applies to them. */
interface GraphicsBindingSource {
  /** Path under the game root, or under `DataCnmd/` for the mod's readable twins (golden rule #4). */
  readonly path: string;
  readonly encrypted?: true;
  readonly read: (sections: readonly RuleSection[]) => readonly BmdPaletteBinding[];
  readonly dedupe?: true;
  /** The source's `.bmd`s bake construction-progress thresholds rather than coverage - see
   *  {@link import('../../decoders/atlas.js').AtlasAlphaMode}. */
  readonly buildTime?: true;
}

const INIS = join('Data', 'engine2d', 'inis');

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
  { path: join(INIS, 'animals', 'jobgraphics.ini'), read: extractGraphicsBindings },
  /** Carts and ships. Same flat `[jobgraphics]` grammar as the animals `.ini`, differing only in
   *  cross-ref key (`logicvehicle`, which leaves `jobId` undefined). */
  {
    path: join(INIS, 'vehicles', 'jobgraphics.cif'),
    encrypted: true,
    read: extractGraphicsBindings,
  },
  /** The human body/head bob sets, `.cif`-only (no readable twin). */
  {
    path: join(INIS, 'humans', 'jobgraphics.cif'),
    encrypted: true,
    read: readHumanJobGraphics,
  },
  /** The map's pre-placed landscape-object bobs (trees, bushes, signs, wonders, harbours) - the leg
   *  that makes `ls_trees.bmd` an atlas. The ~99 tree species share a dozen palettes, so records
   *  repeat a `(bmd, palette)` pair. */
  {
    path: join(INIS, 'landscapes', 'landscapes.cif'),
    encrypted: true,
    read: extractLandscapeGraphics,
    dedupe: true,
  },
  /** The mod's readable human twin. */
  { path: join(CULTURESNATION_MOD, 'types', 'humanstype', 'jobgraphics.ini'), read: readHumanJobGraphics },
  /** The mod carries the broader per-tribe cart/ship set (22 records across tribes 1..4 vs the base
   *  `.cif`'s 6 across tribes 1 and 4 only); the base pairs are a strict subset and dedup at
   *  conversion, while the extra rows carry their own `logicvehicle` cross-refs. */
  {
    path: join(CULTURESNATION_MOD, 'types', 'vehiclestype', 'jobgraphics.ini'),
    read: extractGraphicsBindings,
  },
  /** Every settlement house bound to its `ls_houses_*.bmd` body + palette. One record commonly repeats
   *  a bob+palette across tribes and levels (the ~25 viking-home records all bind `ls_houses_viking` +
   *  `house01`/`house02`). The only source claiming build-time `.bmd`s, so a run whose mod lacks it
   *  bakes the house family per-pixel - acceptable while the conversion requires the mod
   *  (`resolveModRoot`). */
  {
    path: join(CULTURESNATION_MOD, 'budynki12', 'houses', 'houses.ini'),
    read: extractBuildingGraphics,
    dedupe: true,
    buildTime: true,
  },
];

/** The palette `editname` index every binding's `paletteName` resolves against. */
const PALETTE_INDEX_INI = join(INIS, 'palettes', 'palettes.ini');

/**
 * The scout's guidepost is bound by the ENGINE, not by any data table - "guidepost" appears in no
 * decodable binding (landscapes.cif and palettes.ini both checked), only in the executables - so it is
 * hand-authored here. Frame layout (decoded): bob 0 is the post, bobs 1..18 the direction board in ~20°
 * angular steps around the post top. `bridge01` is the single-colour fallback - a plausible wooden
 * palette, a named approximation; the per-player atlases the engine actually draws are baked by
 * `convertGuidepostPlayerAtlases` (stages/player-colors.ts). `convertBmdTree` skips this binding
 * silently when unresolvable.
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
 * Reads every {@link GRAPHICS_BINDING_SOURCES} skin and merges their `.bmd`→palette pairings into the
 * one flat list {@link import('./convert.js').convertBmdTree} consumes, followed by the
 * {@link GUIDEPOST_BINDING}.
 *
 * The goods graphics table (`goods/goodgraphics.cif`) is deliberately absent: its `[goodgraphics]`
 * records carry only a `graphicshumanrandompalette` runtime-tint name and no `gfxbobmanagerbody`, so
 * there is no bob set to atlas (carried-good sprites live in the human/vehicle sheets, tinted at
 * runtime).
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
