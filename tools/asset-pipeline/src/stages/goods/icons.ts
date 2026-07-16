import { join } from 'node:path';
import { decodeCifStringArray } from '../../decoders/cif.js';
import {
  cifLinesToSections,
  decodeIni,
  extractGoods,
  extractLandscapeGfx,
  parseIniSections,
} from '../../decoders/ini.js';
import type { SourceRoots } from '../../roots.js';
import { readSourceFile } from '../game-file.js';

/**
 * The good→icon join: read the good table (`goodtypes.ini`) + the `[GfxLandscape]` good-pile records
 * (`landscapes.cif`) and resolve, per good string id, its state-1 (smallest) pile frame + recolour
 * palette + growth-state fill frames. The join rule ({@link resolveGoodIcons}) is pure and unit-tested;
 * the readers wrap it with file I/O.
 */

/** The plaintext good table (good `name`/`type`/`landscapetype`). */
const GOODTYPES_INI = join('Data', 'logic', 'goodtypes.ini');
/** The `[GfxLandscape]` object table that binds `ls_goods.bmd` frames to goods by `logicType`. */
const LANDSCAPES_CIF = join('Data', 'engine2d', 'inis', 'landscapes', 'landscapes.cif');

/** `loadLayer` stem of the recolourable indexed goods atlas (`<stem>.png` + `<stem>.atlas.json`). */
export const GOODS_ATLAS_STEM = 'ls_goods';

/** The `editGroups` membership marking a `[GfxLandscape]` record as a good's on-map pile graphic. */
const GOOD_PILE_GROUP = 'good piles all';
/**
 * The broader `editGroups` membership marking any good's `ls_goods` graphic — the fallback icon source for a
 * good with no `good piles all` pile record. The potions (bottles, frames 125–129/145–149), amulets (rings,
 * 150–154) and fruit have only a `goods all` record — their own real `ls_goods` graphic + palette — never a
 * dedicated pile, so keying on it recovers a faithful bottle/ring/fruit icon instead of the neutral wood
 * fallback. A good with a pile record keeps it (piles preferred), so the 42 already-bound goods don't move.
 */
const GOOD_ITEM_GROUP = 'goods all';
/** The pile growth state whose frame the storehouse row uses as the compact good icon (smallest unit). */
const ICON_PILE_STATE = 1;

/** One good's icon binding: an `ls_goods` frame + the recolor palette (a goods-LUT row) it draws through. */
export interface GoodIcon {
  /** `ls_goods` atlas frame index (bob id) — the good's state-1 pile graphic (the compact store icon). */
  readonly frame: number;
  /** The recolor palette name (a goods-LUT `palettes` row). */
  readonly palette: string;
  /**
   * The pile's growth-state bobs ordered fewest→most units (state 1 → N; an `ls_goods` pile carries up to
   * 5 states). The on-map dropped heap indexes these by its fill amount so the pile visibly grows with its
   * contents; `frame` is `fillFrames[0]` (state 1), the smallest single-unit heap the storehouse row uses.
   */
  readonly fillFrames: readonly number[];
}

/** The good fields the icon join reads (a structural subset of the extractor's `GoodType`). */
export interface GoodLike {
  readonly id: string;
  readonly landscapeType?: number | undefined;
}
/** The `[GfxLandscape]` fields the icon join reads (a structural subset of `LandscapeGfx`). */
interface PileGfxLike {
  readonly logicType: number;
  readonly editGroups: readonly string[];
  readonly bmd?: string | undefined;
  readonly paletteName?: string | undefined;
  readonly frames: readonly { readonly state: number; readonly bobIds: readonly number[] }[];
}

/**
 * Join goods onto the `[GfxLandscape]` good-pile records to produce, per good string id, its state-1
 * (smallest, single-unit) pile frame + recolor palette. Pure (no I/O), so the join rule is unit-tested.
 * A good with no on-map pile record — or a pile record with no palette / no frames — is omitted (no icon).
 */
export function resolveGoodIcons(
  goods: readonly GoodLike[],
  landscapeGfx: readonly PileGfxLike[],
): Record<string, GoodIcon> {
  // `ls_goods` records indexed by `logicType` (the good's `landscapeType`), split by group: the dedicated
  // pile record (`good piles all`) is preferred, the broader item record (`goods all`) is the fallback for a
  // good with no pile (potions/amulets/fruit). First-wins is deterministic — `extractLandscapeGfx` preserves
  // file order, and a landscape type has one canonical record per group. A pile record is usually also in
  // `goods all`, so both maps may hold it; preferring the pile map keeps the already-bound goods unchanged.
  const pileByLogic = new Map<number, PileGfxLike>();
  const itemByLogic = new Map<number, PileGfxLike>();
  for (const rec of landscapeGfx) {
    if (!rec.bmd?.toLowerCase().includes(GOODS_ATLAS_STEM)) continue;
    if (rec.editGroups.includes(GOOD_PILE_GROUP) && !pileByLogic.has(rec.logicType)) {
      pileByLogic.set(rec.logicType, rec);
    }
    if (rec.editGroups.includes(GOOD_ITEM_GROUP) && !itemByLogic.has(rec.logicType)) {
      itemByLogic.set(rec.logicType, rec);
    }
  }

  const icons: Record<string, GoodIcon> = {};
  for (const good of goods) {
    if (good.landscapeType === undefined) continue;
    const rec = pileByLogic.get(good.landscapeType) ?? itemByLogic.get(good.landscapeType);
    if (rec === undefined || rec.paletteName === undefined) continue;
    const stateFrame =
      rec.frames.find((f) => f.state === ICON_PILE_STATE) ??
      [...rec.frames].sort((a, b) => a.state - b.state)[0];
    const bobId = stateFrame?.bobIds[0];
    if (bobId === undefined) continue;
    // Every growth state's first bob, ordered fewest→most units — the on-map heap indexes these by fill so
    // the pile grows with its contents (a single stone at state 1, a full heap at the record's max state).
    const fillFrames = [...rec.frames]
      .filter((f) => f.bobIds[0] !== undefined)
      .sort((a, b) => a.state - b.state)
      .map((f) => f.bobIds[0] as number);
    icons[good.id] = { frame: bobId, palette: rec.paletteName, fillFrames };
  }
  return icons;
}

/** Read `goodtypes.ini` + `landscapes.cif` and resolve the good→icon bindings ({@link resolveGoodIcons}). */
export async function buildGoodIcons(roots: SourceRoots): Promise<Record<string, GoodIcon>> {
  const { lines } = decodeCifStringArray(await readSourceFile(roots, LANDSCAPES_CIF));
  const landscapeGfx = extractLandscapeGfx(cifLinesToSections(lines), {
    file: LANDSCAPES_CIF,
    layer: 'base',
  });
  return resolveGoodIcons(await loadGoods(roots), landscapeGfx);
}

/** Parse `goodtypes.ini` into the goods list (the id/typeId/landscapeType the icon + name joins key off). */
export async function loadGoods(
  roots: SourceRoots,
): Promise<readonly (GoodLike & { readonly typeId: number })[]> {
  const sections = parseIniSections(decodeIni(await readSourceFile(roots, GOODTYPES_INI)));
  return extractGoods(sections, { file: GOODTYPES_INI, layer: 'base' });
}
