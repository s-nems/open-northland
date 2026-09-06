import type { BuildingBobRef } from '@open-northland/render';
import type { BuildingBobRow } from '../ir/rows.js';

/**
 * The decoded tree atlas bound to the `resource` kind - `ls_trees.bmd` recoloured with the `tree_yew01`
 * palette, the `[GfxLandscape] "yew 01"` record's binding from `landscapes.cif`. It lives in its own
 * frame-id space (493 bobs), so it binds as a per-kind layer. {@link TREE_BOB} 60 is that record's first
 * full-grown frame, a 101×111 tree anchored at its base (source basis "Tree bob").
 */
export const TREE_ATLAS = 'ls_trees.tree_yew01';
export const TREE_BOB = 60;

/** The default building atlas kept as its `(bmd, palette)` parts; {@link HOUSE_ATLAS} is the served stem. */
const HOUSE_BMD = 'ls_houses_viking.bmd';
const HOUSE_PALETTE = 'house01';

/**
 * The decoded building atlas bound to the `building` kind - `ls_houses_viking.bmd` recoloured with the
 * `house01` palette (the `[GfxHouse]` viking records from the mod's `budynki12/houses/houses.ini`). Like the
 * tree it lives in its own frame-id space (135 bobs), so it binds as a per-kind layer. {@link HOUSE_BOB} 11
 * is the "viking home" record's first finished growth stage (213×198 anchored at its base), serving only as
 * the render-side default for a type with no `buildingBobs` row (source basis "Building bob").
 */
export const HOUSE_ATLAS = `ls_houses_viking.${HOUSE_PALETTE}`;
export const HOUSE_BOB = 11;
/**
 * Render scale for the building kind - native, because the tile pitch is calibrated to the art. Decoded bob
 * sizes differ a lot (well 63×88, home 299×340), so a uniform scale keeps their real relative proportions.
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

/** The `LogicTribeType` of the default building family's skin, and the sheet's base tribe (viking 1). */
export const VIKING_TRIBE = 1;

export const DEFAULT_BUILDING_FAMILY = { bmdBasename: HOUSE_BMD, paletteName: HOUSE_PALETTE } as const;

export interface BuildingFamily {
  readonly bmdBasename: string;
  /** The `GfxPalette` recolour skin loaded for this family. */
  readonly paletteName: string;
  /** The `SpriteSheet.families` key, which is the served atlas stem. */
  readonly layer: string;
}

/** What one tribe's building reducers resolve against: its rows, its preferred skin, and the atlas layers
 *  the sheet actually loaded. */
export interface BuildingRefScope {
  readonly tribeId: number;
  /** The skin preferred when a `typeId` carries rows in several - see {@link preferredPaletteFor}. */
  readonly preferredPalette: string;
  /** The sheet's shared building layer; a row in it binds a bare bob id rather than a named family. */
  readonly defaultFamily: { readonly bmdBasename: string; readonly paletteName: string };
  /** The named families the sheet loaded; see {@link familyLayerFor} for what a row in any other does. */
  readonly families: readonly BuildingFamily[];
}

/** The `[GfxHouse]` rows every building reducer reads: each names the `.bmd` × palette it draws from. */
interface FamilyRow {
  readonly tribeId: number;
  readonly bmd: string;
  readonly paletteName: string;
}

/**
 * Every named building-family atlas the given tribes' `[GfxHouse]` rows reference, each a separate decoded
 * `ls_houses_*.bmd` × palette PNG with its own frame-id space. The default family is excluded: a row in it
 * binds a bare bob id in the shared building layer. `bmdBasename` repeats across entries, so the
 * `(bmdBasename, paletteName)` pair is what disambiguates a family.
 */
export function buildingFamiliesFor(
  rows: readonly FamilyRow[],
  tribeIds: readonly number[],
  defaultFamily: { readonly bmdBasename: string; readonly paletteName: string },
): BuildingFamily[] {
  const tribes = new Set(tribeIds);
  const families = new Map<string, BuildingFamily>();
  for (const row of rows) {
    if (!tribes.has(row.tribeId)) continue;
    const base = bmdBasename(row.bmd);
    if (base === defaultFamily.bmdBasename && row.paletteName === defaultFamily.paletteName) continue;
    const layer = `${base.replace(/\.bmd$/i, '')}.${row.paletteName}`;
    if (!families.has(layer)) families.set(layer, { bmdBasename: base, paletteName: row.paletteName, layer });
  }
  return [...families.values()].sort((a, b) => byCodepoint(a.layer, b.layer));
}

/** Codepoint order, not `localeCompare`: ICU collation varies by environment, and these orders decide
 *  which skin a tribe wears and which atlas pages load. */
function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The palette a tribe's buildings are preferred in when one `typeId` carries rows in several skins. The
 * base tribe keeps {@link HOUSE_PALETTE}, the skin the shared building layer and {@link VIKING_HOUSE01_BOBS}
 * are built from - its two skins are near-evenly split (35 rows against 33), so a majority there would be
 * one extraction away from reskinning half the settlement. Every other tribe takes its own most common
 * skin, ties broken by name. An approximation either way: the original's skin choice is unextracted.
 */
export function preferredPaletteFor(rows: readonly FamilyRow[], tribeId: number): string {
  if (tribeId === VIKING_TRIBE) return HOUSE_PALETTE;
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.tribeId !== tribeId) continue;
    counts.set(row.paletteName, (counts.get(row.paletteName) ?? 0) + 1);
  }
  let best: string = HOUSE_PALETTE;
  let bestCount = 0;
  for (const [palette, count] of [...counts].sort((a, b) => byCodepoint(a[0], b[0]))) {
    if (count > bestCount) {
      best = palette;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The pinned canonical `EditName` for a viking `typeId` whose `(tribe, typeId)` maps to several bobs that
 * are not a recolour or level variant. The HQ (typeId 1) is `ls_houses_viking4.bmd` bob 34
 * `"viking headquarters"`, not the alt bob 44 `"viking headquarters house"` (source basis "Building
 * graphics families"). A typeId with no entry falls through to each reducer's own tiebreak.
 */
export const CANONICAL_EDIT_NAME: Readonly<Record<number, string>> = {
  1: 'viking headquarters',
};

function bmdBasename(bmd: string): string {
  const slash = bmd.lastIndexOf('/');
  return slash === -1 ? bmd : bmd.slice(slash + 1);
}

/** Group a decoded gfx-join's rows by typeId for one tribe. Insertion order is preserved so the per-type
 *  reductions stay deterministic. */
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

/** A type's rows in the preferred (loaded) palette when any exist, else all of them. */
export function preferredPalettePool<T extends { paletteName: string }>(
  rows: readonly T[],
  paletteName: string,
): readonly T[] {
  const inPreferred = rows.filter((r) => r.paletteName === paletteName);
  return inPreferred.length > 0 ? inPreferred : rows;
}

/**
 * Pick the single canonical `buildingBobs` row for one `typeId` from rows already filtered to that tribe and
 * typeId. The palette → canonical-name → highest `level` → lowest `bobId` ladder makes the choice
 * independent of row insertion order.
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
 * bare-id ref), `{ layer }` = a loaded named family, `null` = an unloaded family the caller must drop,
 * because the renderer would fall an unknown family through to the default layer and draw a wrong bob from
 * a disjoint frame-id space. `bmd` is matched on its trailing basename so a sibling like
 * `ls_houses_viking2.bmd` can't be a false positive.
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
  scope: BuildingRefScope,
): Record<number, BuildingBobRef> {
  const byType = rowsByType(rows, scope.tribeId);
  const out: Record<number, BuildingBobRef> = {};
  for (const [typeId, list] of byType) {
    const row = pickCanonicalBuildingRow(typeId, list, scope.preferredPalette);
    if (row === undefined) continue;
    const layer = familyLayerFor(row.bmd, row.paletteName, scope.defaultFamily, scope.families);
    if (layer === null) continue; // family not loaded → drop (the constant/default backs this typeId)
    out[typeId] = layer.layer === undefined ? row.bobId : { layer: layer.layer, bob: row.bobId };
  }
  return out;
}
