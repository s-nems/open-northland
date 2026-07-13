import type { BuildingBobRef } from '@open-northland/render';
import type { BuildingBobRow } from '../ir.js';

/**
 * The building atlas FAMILIES + the shared per-type reduction helpers — the tree/house atlas constants
 * the sheet loader binds, the seven loaded viking families, and the canonical-row picking every building
 * binding reducer shares. The base per-type bob binding ({@link buildingBobRefsByType}) lives here; the
 * working-state overlay + construction-stage reducers in `./overlays.ts` / `./construction.ts` reuse
 * these helpers. The pure reducers are unit-tested without a browser.
 */

/**
 * The decoded tree atlas bound to the `resource` kind — `ls_trees.bmd` recoloured with the `tree_yew01`
 * palette, the `[GfxLandscape] "yew 01"` record's binding from `landscapes.cif` (the
 * `extractLandscapeGraphics` leg). It lives in its OWN frame-id space (493 bobs, distinct from the human
 * body bobs), so it binds as a per-kind {@link import('@open-northland/render').SpriteSheet.kindLayers} layer,
 * not the shared body atlas. {@link TREE_BOB} is that record's first displayed full-grown frame
 * (`GfxFrames 3 60 …` → bob 60, a 101×111 tree anchored at its base). Species/frame are a deliberate
 * first pick — a human eyeballs the pixels and we swap the constant to taste (source basis "Tree
 * bob"). The wood `Resource` nodes the woodcutter chops now draw as this tree instead of the flat green
 * placeholder box.
 */
export const TREE_ATLAS = 'ls_trees.tree_yew01';
export const TREE_BOB = 60;

/**
 * The loaded building atlas, kept as its `(bmd, palette)` parts so {@link buildingBobRefsByType} can pick
 * the matching `buildingBobs` rows from the IR (the row's `bmd` is the full normalized path, so we match
 * by the trailing basename). {@link HOUSE_ATLAS} is the served atlas stem (`<bmd-stem>.<palette>`).
 */
const HOUSE_BMD = 'ls_houses_viking.bmd';
const HOUSE_PALETTE = 'house01';

/**
 * The decoded building atlas bound to the `building` kind — `ls_houses_viking.bmd` recoloured with the
 * `house01` palette (the `[GfxHouse]` viking records' binding from the mod's
 * `budynki12/houses/houses.ini`). Like the tree it lives in its OWN frame-id space (135 bobs, distinct
 * from the human body bobs), so it binds as a per-kind {@link import('@open-northland/render').SpriteSheet.kindLayers}
 * layer, not the shared body atlas. {@link HOUSE_BOB} 11 is the "viking home" record's first finished
 * growth stage — a stone-and-thatch cottage (213×198 anchored at its base). It draws at NATIVE size
 * ({@link BUILDING_SCALE} = 1), like the settler, tree and every landscape object: the tile PITCH is now
 * calibrated to the art (see `iso.ts`), so a bob's authored pixels read at the right size against the
 * terrain with no per-kind fudge. (The earlier 0.7 shrink compensated for a pitch that was ~1.5× too
 * large — it made buildings *too small*, the complaint that drove the pitch recalibration; removing it
 * lets a house cover roughly its `LogicWalkBlockArea` footprint the way the original did.) The bob is
 * still a taste constant — swap it to a bigger growth stage (source basis "Building bob"). This
 * {@link HOUSE_BOB} is now only the
 * {@link import('@open-northland/render').BuildingTypeBinding.default} fallback for a type with no `buildingBobs`
 * row at all; every real viking type binds its own bob through {@link BUILDING_FAMILIES}.
 */
export const HOUSE_ATLAS = `ls_houses_viking.${HOUSE_PALETTE}`;
export const HOUSE_BOB = 11;
/**
 * Render scale for the building kind — **native (1)**, like every other bob. Buildings no longer carry a
 * per-kind shrink: the tile pitch (`iso.ts`) is calibrated to the art, so the authored bob size is
 * already correct against the terrain. Kept as a named knob (a human may still nudge it, source basis).
 */
export const BUILDING_SCALE = 1;

/**
 * FALLBACK per-building-type bob ids for the viking buildings that share the {@link HOUSE_ATLAS}
 * (`ls_houses_viking.bmd` recoloured `house01`). The live path now derives this map from the extracted
 * `buildingBobs` IR ({@link buildingBobRefsByType}); this transcribed constant is the graceful fallback
 * used when `content/ir.json` is absent or predates the `buildingBobs` lane (a checkout without
 * `content/`) — exactly the `FALLBACK_*`-range stance the settler animations use. Keyed by the building
 * `typeId` (`Building.buildingType`, the `[GfxHouse]` `LogicType`) → its `GfxBobId`, transcribed from
 * the mod's `budynki12/houses/houses.ini` `[GfxHouse]` records (`LogicTribeType 1`, `GfxPalette
 * "house01"`). The extracted table reproduces these five exactly and additionally recovers the home
 * (t2..t6 = typeIds 2..6) + bakery (14/15) growth-stage typeIds this constant drops. The bob sizes
 * differ a lot natively — the well (63×88) and hive (64×89) are small, the home (299×340) and bakery
 * (315×234) large — so the single uniform {@link BUILDING_SCALE} preserves their *real relative*
 * proportions (a faithful pick over a per-type scale).
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
 * The DEFAULT building atlas family — the single `ls_houses_viking.house01` layer drawn as
 * {@link import('@open-northland/render').SpriteSheet.kindLayers}'s `building` (a plain {@link BuildingBobRef},
 * no family). Its `(bmd, palette)` identity tells {@link buildingBobRefsByType} which canonical rows draw
 * from that shared layer (a bare bob id) versus a named
 * {@link import('@open-northland/render').SpriteSheet.families} layer (a `{ layer, bob }`).
 */
export const DEFAULT_BUILDING_FAMILY = { bmdBasename: HOUSE_BMD, paletteName: HOUSE_PALETTE } as const;

/**
 * The served atlas stems (`<bmd-stem>.<palette>`) = {@link import('@open-northland/render').SpriteSheet.families}
 * keys for the named viking building families loaded beside the default `ls_houses_viking.house01`. Two are
 * sibling `.bmd`s on the default `house01` skin (`viking2`/`viking3`); two are a *different palette* on a
 * shared `.bmd` — `housemiller01` recolours `ls_houses_viking.bmd` (the mill) and `housedruid01` recolours
 * `ls_houses_viking4.bmd` (the herb hut + temple) — so the served stem is `<bmd>.<palette>`, not `<bmd>.house01`.
 */
const VIKING4_HOUSE01 = 'ls_houses_viking4.house01';
const VIKING2_HOUSE01 = 'ls_houses_viking2.house01';
const VIKING3_HOUSE01 = 'ls_houses_viking3.house01';
const VIKING_MILLER01 = 'ls_houses_viking.housemiller01';
const VIKING4_DRUID01 = 'ls_houses_viking4.housedruid01';
// The `house02` skin — the LAST viking building types still on the fallback house live here: stock
// (typeIds 7/8/9) recolours `ls_houses_viking.bmd`, and brewery (16) + coin mint (33) recolour
// `ls_houses_viking2.bmd`. Loading these two pairs binds every remaining viking [GfxHouse] type to its
// own bob (the reducer prefers `house01`, so a type with a house01 row is unaffected — only the
// house01-less stock/brewery/coin mint resolve here).
const VIKING_HOUSE02 = 'ls_houses_viking.house02';
const VIKING2_HOUSE02 = 'ls_houses_viking2.house02';

/** A loaded named building-family atlas: its `(bmd, palette)` identity + the {@link import('@open-northland/render').SpriteSheet.families} key it draws from. */
export interface BuildingFamily {
  /** The `.bmd` basename the family's rows carry, e.g. `ls_houses_viking4.bmd`. */
  readonly bmdBasename: string;
  /** The `GfxPalette` recolour skin loaded for this family, e.g. `house01`. */
  readonly paletteName: string;
  /** The {@link import('@open-northland/render').SpriteSheet.families} key (= the served atlas stem), e.g. `ls_houses_viking4.house01`. */
  readonly layer: string;
}

/**
 * The named building-family atlases loaded BESIDE the default one — each a separate decoded
 * `ls_houses_*.bmd` × palette PNG with its OWN frame-id space, registered in
 * {@link import('@open-northland/render').SpriteSheet.families} under `layer` (= the served atlas stem). A
 * canonical row in one of these binds a layer-qualified `{ layer, bob }` ref; the
 * {@link buildingBobRefsByType} reducer DROPS a row whose family is NOT in this list (it falls back to
 * {@link VIKING_HOUSE01_BOBS}/the default house), so a family must be both listed here AND loaded in
 * {@link import('../sprite-sheet/index.js').loadHumanSpriteSheet} for its types to draw their real bob.
 *
 * This loads **all seven viking families** so EVERY viking building draws its own bob: the default
 * `ls_houses_viking.house01` (the homes / well / hive / farm / bakery, bound as the `building` kind),
 * `ls_houses_viking4.house01` (HQ / animal farm / druid hut / barracks / tower), `ls_houses_viking2.house01`
 * (pottery / joinery / smithy), `ls_houses_viking3.house01` (sewery / armory / mason hut / school), the
 * `housemiller01` skin of `ls_houses_viking.bmd` (the mill, typeId 13), the `housedruid01` skin of
 * `ls_houses_viking4.bmd` (herb hut / temple, typeIds 34/37), and the two `house02` families that close the
 * set — `ls_houses_viking.house02` (the stock, typeIds 7/8/9) and `ls_houses_viking2.house02` (brewery 16 +
 * coin mint 33), the LAST viking types that used to fall back. `bmdBasename` may repeat across entries
 * (miller / house02 / the default all live in `ls_houses_viking.bmd`); the `(bmdBasename, paletteName)`
 * PAIR is what disambiguates the family. The reducer prefers `house01`, so a type with a house01 row is
 * unaffected by the house02 families — only the house01-less stock / brewery / coin mint resolve there.
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
 * The SOURCES-pinned canonical `EditName` for a viking `typeId` whose `(tribe, typeId)` maps to several
 * bobs that are NOT a recolour/level variant — it disambiguates WHICH bob is the building. The HQ
 * (typeId 1) is `ls_houses_viking4.bmd` bob 34 `"viking headquarters"` (bob 44 is the alt
 * `"viking headquarters house"`) — docs/SOURCES.md "Building graphics families". A typeId with no entry
 * here falls through to the deterministic palette → max-level → lowest-bob tiebreak.
 */
export const CANONICAL_EDIT_NAME: Readonly<Record<number, string>> = {
  1: 'viking headquarters',
};

/** The trailing path component of a (possibly slash-normalized) `bmd` path — `data/x/ls_houses_viking4.bmd` → `ls_houses_viking4.bmd`. */
function bmdBasename(bmd: string): string {
  const slash = bmd.lastIndexOf('/');
  return slash === -1 ? bmd : bmd.slice(slash + 1);
}

/**
 * Group a decoded gfx-join's rows by typeId, keeping only this tribe's (and, when `keep` is given, only
 * the rows it passes — the construction reduction drops the upgrade-overlay rows). Insertion order is
 * preserved, so the per-type reductions below stay deterministic. The shared first step of every
 * per-type binding reducer in this module.
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

/** Restrict a type's rows to those in the preferred (loaded) palette when any exist, else keep them all —
 *  the "bind the skin we actually draw" rule the per-type reducers share. */
export function preferredPalettePool<T extends { paletteName: string }>(
  rows: readonly T[],
  paletteName: string,
): readonly T[] {
  const inPreferred = rows.filter((r) => r.paletteName === paletteName);
  return inPreferred.length > 0 ? inPreferred : rows;
}

/**
 * Pick the single canonical `buildingBobs` row for one `typeId` from its candidate rows (already filtered
 * to the tribe + typeId), deterministically and insertion-order-independently:
 *  1. **Palette preference** — restrict to rows in {@link preferredPalette} (the loaded `house01` skin)
 *     when any exist, so a type present in several recolour skins binds the skin we actually draw.
 *  2. **`editName` disambiguation** — when {@link CANONICAL_EDIT_NAME} names this typeId (the HQ →
 *     `"viking headquarters"`), restrict to rows whose `editName` matches, picking THE building over a
 *     variant (`"viking headquarters house"`); a no-op for the typeIds without an entry.
 *  3. **Tiebreak** — highest `level` (the growth chain is distinct typeIds, so level is usually constant;
 *     this resolves lumped dupes + any future multi-level typeId), then lowest `bobId`.
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
 * Resolve a row's `(bmd, palette)` to the atlas family it draws from — the shared no-wrong-bob-borrow
 * rule of {@link buildingBobRefsByType} and {@link import('./construction.js').constructionRefsByType}:
 * `{}` = the default building layer (a bare-id ref), `{ layer }` = a LOADED named family (a
 * layer-qualified ref), `null` = an unloaded family — the caller must DROP the row, because the renderer
 * would fall an unknown family through to the default layer and draw a wrong bob from a disjoint frame-id
 * space. `bmd` is matched on its trailing basename so a sibling like `ls_houses_viking2.bmd` can't be a
 * false positive.
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
 * Reduce the decoded `buildingBobs` join (the `extractBuildingBobs` leg) to the render's per-type bob
 * binding for ONE tribe across MANY loaded atlas families. For each `(tribeId, typeId)` it picks the
 * canonical row ({@link pickCanonicalBuildingRow}) and emits a {@link BuildingBobRef}:
 *  - a **bare bob id** when the canonical row's `(bmd, palette)` is the {@link defaultFamily} (the shared
 *    `ls_houses_viking.house01` layer drawn as {@link import('@open-northland/render').SpriteSheet.kindLayers}'s
 *    `building`), or
 *  - a **layer-qualified `{ layer, bob }`** when it's one of the loaded named {@link families} (e.g. the
 *    HQ in `ls_houses_viking4.house01`) — the multi-`.bmd` case, drawn from that family's own atlas.
 *
 * A canonical row whose family is NEITHER the default NOR a loaded named family is **dropped** — the
 * caller's {@link VIKING_HOUSE01_BOBS} overlay / {@link import('@open-northland/render').BuildingTypeBinding.default}
 * backs it, so an unloaded family degrades to the representative house instead of borrowing a WRONG bob from
 * the default layer (the renderer falls a layer-qualified ref through to the default layer when its family is
 * absent, so we must not emit one for a family we didn't load). `bmd` is matched on its trailing basename so
 * a sibling like `ls_houses_viking2.bmd` can't be a false positive. Returns `{}` when nothing matches. Pure +
 * exported so the join→binding reduction is unit-tested without a browser. For the default family it
 * reproduces the transcribed constant for typeIds 6/10/11/12/15 and ADDS the home/bakery growth-stage
 * typeIds the constant dropped.
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
