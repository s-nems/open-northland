import type { BuildingBobRef } from '@open-northland/render';
import type { BuildingBobRow } from '../ir/rows.js';

/**
 * The decoded tree atlas bound to the `resource` kind - `ls_trees.bmd` recoloured with the `tree_yew01`
 * palette, the `[GfxLandscape] "yew 01"` record's binding from `landscapes.cif`. It lives in its own
 * frame-id space (493 bobs), so it binds as a per-kind layer rather than the shared body atlas.
 * {@link TREE_BOB} 60 is that record's first full-grown frame, a 101×111 tree anchored at its base
 * (source basis "Tree bob").
 */
export const TREE_ATLAS = 'ls_trees.tree_yew01';
export const TREE_BOB = 60;

/** The default building atlas kept as its `(bmd, palette)` parts; {@link HOUSE_ATLAS} is the served stem. */
const HOUSE_BMD = 'ls_houses_viking.bmd';
const HOUSE_PALETTE = 'house01';

/**
 * The decoded building atlas bound to the `building` kind - `ls_houses_viking.bmd` recoloured with the
 * `house01` palette (the `[GfxHouse]` viking records from the mod's `budynki12/houses/houses.ini`). Like
 * the tree it lives in its own frame-id space (135 bobs), so it binds as a per-kind layer.
 * {@link HOUSE_BOB} 11 is the "viking home" record's first finished growth stage (213×198 anchored at its
 * base), serving only as the render-side default for a type with no `buildingBobs` row (source basis
 * "Building bob").
 */
export const HOUSE_ATLAS = `ls_houses_viking.${HOUSE_PALETTE}`;
export const HOUSE_BOB = 11;
/**
 * Render scale for the building kind - native (1), like every other bob: the tile pitch is calibrated to the
 * art. Decoded bob sizes differ a lot (well 63×88, home 299×340), so a uniform scale preserves their real
 * relative proportions.
 */
export const BUILDING_SCALE = 1;

/**
 * Fallback per-building-type bob ids for the viking buildings sharing the {@link HOUSE_ATLAS}, used when
 * `content/ir.json` is absent or predates the `buildingBobs` lane. Keyed by building `typeId` (the
 * `[GfxHouse]` `LogicType`) → its `GfxBobId`, transcribed from the mod's `budynki12/houses/houses.ini`
 * `[GfxHouse]` records (`LogicTribeType 1`, `house01`). The extracted table reproduces these five exactly
 * and additionally recovers the home and bakery growth-stage typeIds this constant drops.
 */
export const VIKING_HOUSE01_BOBS: Readonly<Record<number, number>> = {
  6: 41, // viking home
  10: 131, // viking well
  11: 91, // viking hive
  12: 60, // viking farm
  15: 105, // viking bakery
};

/** The `LogicTribeType` whose `buildingBobs` rows the render binds (viking 1). */
export const VIKING_TRIBE = 1;

/**
 * The default building atlas family - the single `ls_houses_viking.house01` layer drawn as the `building`
 * kind.
 */
export const DEFAULT_BUILDING_FAMILY = { bmdBasename: HOUSE_BMD, paletteName: HOUSE_PALETTE } as const;

/**
 * The served atlas stems (= `families` keys) for the named viking building families loaded beside the
 * default `ls_houses_viking.house01`. Two are sibling `.bmd`s on the `house01` skin (`viking2`/`viking3`);
 * two are a different palette on a shared `.bmd` - `housemiller01` recolours `ls_houses_viking.bmd` and
 * `housedruid01` recolours `ls_houses_viking4.bmd` - so the served stem is `<bmd>.<palette>`.
 */
const VIKING4_HOUSE01 = 'ls_houses_viking4.house01';
const VIKING2_HOUSE01 = 'ls_houses_viking2.house01';
const VIKING3_HOUSE01 = 'ls_houses_viking3.house01';
const VIKING_MILLER01 = 'ls_houses_viking.housemiller01';
const VIKING4_DRUID01 = 'ls_houses_viking4.housedruid01';
// The `house02` skin - the last viking building types otherwise on the fallback house: stock (typeIds
// 7/8/9) recolours `ls_houses_viking.bmd`, brewery (16) + coin mint (33) recolour `ls_houses_viking2.bmd`.
const VIKING_HOUSE02 = 'ls_houses_viking.house02';
const VIKING2_HOUSE02 = 'ls_houses_viking2.house02';

/** A loaded named building-family atlas: its `(bmd, palette)` identity + the `families` key it draws from. */
export interface BuildingFamily {
  /** The `.bmd` basename the family's rows carry, e.g. `ls_houses_viking4.bmd`. */
  readonly bmdBasename: string;
  /** The `GfxPalette` recolour skin loaded for this family, e.g. `house01`. */
  readonly paletteName: string;
  /** The `SpriteSheet.families` key (= the served atlas stem), e.g. `ls_houses_viking4.house01`. */
  readonly layer: string;
}

/**
 * The named building-family atlases loaded beside the default one - each a separate decoded
 * `ls_houses_*.bmd` × palette PNG with its own frame-id space, registered under `layer`. A family must be
 * both listed here and loaded by the sheet loader for its types to draw their real bob. `bmdBasename` may
 * repeat across entries, so the `(bmdBasename, paletteName)` pair is what disambiguates a family.
 */
export const BUILDING_FAMILIES: readonly BuildingFamily[] = [
  { bmdBasename: 'ls_houses_viking4.bmd', paletteName: HOUSE_PALETTE, layer: VIKING4_HOUSE01 },
  { bmdBasename: 'ls_houses_viking2.bmd', paletteName: HOUSE_PALETTE, layer: VIKING2_HOUSE01 },
  { bmdBasename: 'ls_houses_viking3.bmd', paletteName: HOUSE_PALETTE, layer: VIKING3_HOUSE01 },
  { bmdBasename: HOUSE_BMD, paletteName: 'housemiller01', layer: VIKING_MILLER01 },
  { bmdBasename: 'ls_houses_viking4.bmd', paletteName: 'housedruid01', layer: VIKING4_DRUID01 },
  { bmdBasename: HOUSE_BMD, paletteName: 'house02', layer: VIKING_HOUSE02 },
  { bmdBasename: 'ls_houses_viking2.bmd', paletteName: 'house02', layer: VIKING2_HOUSE02 },
];

/**
 * The pinned canonical `EditName` for a viking `typeId` whose `(tribe, typeId)` maps to several bobs that
 * are not a recolour/level variant. The HQ (typeId 1) is `ls_houses_viking4.bmd` bob 34
 * `"viking headquarters"`, not the alt bob 44 `"viking headquarters house"` (source basis "Building
 * graphics families"). A typeId with no entry falls through to the palette → max-level → lowest-bob
 * tiebreak.
 */
export const CANONICAL_EDIT_NAME: Readonly<Record<number, string>> = {
  1: 'viking headquarters',
};

/** The trailing path component of a (possibly slash-normalized) `bmd` path - `data/x/ls_houses_viking4.bmd` → `ls_houses_viking4.bmd`. */
function bmdBasename(bmd: string): string {
  const slash = bmd.lastIndexOf('/');
  return slash === -1 ? bmd : bmd.slice(slash + 1);
}

/**
 * Group a decoded gfx-join's rows by typeId, keeping only this tribe's and, when `keep` is given, only the
 * rows it passes. Insertion order is preserved so the per-type reductions stay deterministic.
 */
export function rowsByType<T extends { tribeId: number; typeId: number }>(
  rows: readonly T[],
  tribeId: number,
  keep?: (row: T) => boolean,
): Map<number, T[]> {
  const byType = new Map<number, T[]>();
  for (const r of rows) {
    if (r.tribeId !== tribeId || (keep !== undefined && !keep(r))) continue;
    const list = byType.get(r.typeId);
    if (list === undefined) byType.set(r.typeId, [r]);
    else list.push(r);
  }
  return byType;
}

/** Restrict a type's rows to those in the preferred (loaded) palette when any exist, else keep them all -
 *  the "bind the skin we actually draw" rule the per-type reducers share. */
export function preferredPalettePool<T extends { paletteName: string }>(
  rows: readonly T[],
  paletteName: string,
): readonly T[] {
  const inPreferred = rows.filter((r) => r.paletteName === paletteName);
  return inPreferred.length > 0 ? inPreferred : rows;
}

/**
 * Pick the single canonical `buildingBobs` row for one `typeId` from its candidate rows (already filtered to
 * the tribe and typeId). The palette → canonical-name → highest `level` → lowest `bobId` ladder makes the
 * choice independent of row insertion order.
 */
function pickCanonicalBuildingRow(
  typeId: number,
  rows: readonly BuildingBobRow[],
  preferredPalette: string,
): BuildingBobRow | undefined {
  let candidates = preferredPalettePool(rows, preferredPalette);
  const canonName = CANONICAL_EDIT_NAME[typeId];
  if (canonName !== undefined) {
    const named = candidates.filter((r) => r.editName === canonName);
    if (named.length > 0) candidates = named;
  }
  let best: BuildingBobRow | undefined;
  for (const r of candidates) {
    if (best === undefined || r.level > best.level || (r.level === best.level && r.bobId < best.bobId)) {
      best = r;
    }
  }
  return best;
}

/**
 * Resolve a row's `(bmd, palette)` to the atlas family it draws from: `{}` = the default building layer (a
 * bare-id ref), `{ layer }` = a loaded named family (a layer-qualified ref), `null` = an unloaded family
 * the caller must drop, because the renderer would fall an unknown family through to the default layer and
 * draw a wrong bob from a disjoint frame-id space. `bmd` is matched on its trailing basename so a sibling
 * like `ls_houses_viking2.bmd` can't be a false positive.
 */
export function familyLayerFor(
  bmd: string,
  paletteName: string,
  defaultFamily: { readonly bmdBasename: string; readonly paletteName: string },
  families: readonly BuildingFamily[],
): { layer?: string } | null {
  const base = bmdBasename(bmd);
  if (base === defaultFamily.bmdBasename && paletteName === defaultFamily.paletteName) return {};
  const family = families.find((f) => f.bmdBasename === base && f.paletteName === paletteName);
  return family === undefined ? null : { layer: family.layer };
}

/**
 * Reduce the decoded `buildingBobs` join to the render's per-type bob binding for one tribe. A row whose
 * family is neither the default nor a loaded named one is dropped, degrading that typeId to
 * {@link VIKING_HOUSE01_BOBS} or the render-side default.
 */
export function buildingBobRefsByType(
  rows: readonly BuildingBobRow[],
  tribeId: number,
  defaultFamily: { readonly bmdBasename: string; readonly paletteName: string },
  families: readonly BuildingFamily[],
): Record<number, BuildingBobRef> {
  const byType = rowsByType(rows, tribeId);
  const out: Record<number, BuildingBobRef> = {};
  for (const [typeId, list] of byType) {
    const row = pickCanonicalBuildingRow(typeId, list, defaultFamily.paletteName);
    if (row === undefined) continue;
    const layer = familyLayerFor(row.bmd, row.paletteName, defaultFamily, families);
    if (layer === null) continue; // family not loaded → drop (the constant/default backs this typeId)
    out[typeId] = layer.layer === undefined ? row.bobId : { layer: layer.layer, bob: row.bobId };
  }
  return out;
}
