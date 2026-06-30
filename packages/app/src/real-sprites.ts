import {
  type AtlasManifest,
  type BuildingBobRef,
  type DirectionalAnim,
  SYNTHETIC_BINDINGS,
  type SpriteBindings,
  type SpriteLayer,
  type SpriteSheet,
  atlasFromManifest,
  createSyntheticAtlasSource,
  loadAtlasSource,
  syntheticAtlasFrames,
} from '@vinland/render';

/**
 * The `?atlas=real` binding: draw settlers from REAL decoded bob atlases instead of the synthetic one.
 * The decoder/render-binding proof the roadmap gates on a human eye (Phase-2 "bind a REAL decoded bob
 * atlas") — it puts actual decoded `cr_hum_body_00` + `cr_hum_head_00` pixels on screen so a person can
 * judge palette / transparency / feet-anchor / animation fidelity against the original.
 *
 * Like the synthetic path, this is opt-in (the URL flag) and loads from the GITIGNORED `content/` over
 * the dev/shot vite server — no copyrighted bytes enter the repo (the same stance as `?map=` loading a
 * gitignored grid). The committed default stays placeholder/synthetic, so tests + the reproducible shot
 * are unaffected.
 *
 * A settler is composed of two layered bob sets — a **body** (`CR_Hum_Body_00`) and a **head**
 * (`CR_Hum_Head_00`), the head drawn on top at the same bob id — exactly as the original's
 * `jobgraphics` (`gfxbobmanagerbody` + `gfxbobmanagerhead`) compose a human. Each coarse state binds a
 * directional, time-animated `[bobseq]` range so the settler plays its walk / chop cycle for the way it
 * faces (the frame advances one per sim tick). `resource` binds the decoded `ls_trees.bmd` tree atlas
 * (the `landscapes.cif` `[GfxLandscape]` leg) as a per-kind layer, so the wood node the woodcutter chops
 * now draws as a real tree; `building` binds the decoded `ls_houses_viking*.bmd` house atlases and draws
 * each building type its OWN house bob — the `[GfxHouse]` `LogicType` → `GfxBobId` join from the extracted
 * `buildingBobs` IR ({@link buildingBobRefsByType}) overlaid onto the transcribed {@link VIKING_HOUSE01_BOBS}
 * (data wins per type; the constant backs its five known types when `content/` is absent). A building type
 * whose canonical bob lives in a *different* `.bmd`/palette than the default `ls_houses_viking.house01`
 * layer (the HQ in `ls_houses_viking4.bmd`, the mill in the `housemiller01` skin, the smithy in
 * `ls_houses_viking2.bmd`, …) binds a layer-qualified {@link BuildingBobRef} into its own loaded
 * {@link SpriteSheet.families} atlas — all seven viking families load (the five `house01`/skin families
 * plus the two `house02` families for stock / brewery / coin mint), so EVERY viking building draws its
 * own bob — none falls back to the representative house.
 */

/** The decoded human body + head atlases (`test_human_00` palette) served at `/bobs/<name>.*`. */
const HUMAN_BODY_ATLAS = 'cr_hum_body_00.test_human_00';
const HUMAN_HEAD_ATLAS = 'cr_hum_head_00.test_human_00';

/**
 * The decoded tree atlas bound to the `resource` kind — `ls_trees.bmd` recoloured with the `tree_yew01`
 * palette, the `[GfxLandscape] "yew 01"` record's binding from `landscapes.cif` (the
 * `extractLandscapeGraphics` leg). It lives in its OWN frame-id space (493 bobs, distinct from the human
 * body bobs), so it binds as a per-kind {@link SpriteSheet.kindLayers} layer, not the shared body atlas.
 * {@link TREE_BOB} is that record's first displayed full-grown frame (`GfxFrames 3 60 …` → bob 60, a
 * 101×111 tree anchored at its base). Species/frame are a deliberate first pick — a human eyeballs the
 * pixels and we swap the constant to taste (docs/FIDELITY.md "Tree bob"). The wood `Resource` nodes the
 * woodcutter chops now draw as this tree instead of the flat green placeholder box.
 */
const TREE_ATLAS = 'ls_trees.tree_yew01';
const TREE_BOB = 60;

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
 * from the human body bobs), so it binds as a per-kind {@link SpriteSheet.kindLayers} layer, not the
 * shared body atlas. {@link HOUSE_BOB} 11 is the "viking home" record's first finished growth stage — a
 * stone-and-thatch cottage (213×198 anchored at its base). At native size every house bob draws ~6–10×
 * the settler's height — far larger than the original showed a house next to a person — so the building
 * is drawn at {@link BUILDING_SCALE} about its feet anchor (the settler + tree stay native, their
 * proportion already reads right). At 0.7 the cottage lands ~3× the settler, the by-eye pick from a 1:1
 * pawn-vs-tree-vs-building montage. Both the bob and the scale are taste constants — swap them to a
 * bigger stage / different factor (docs/FIDELITY.md "Building bob"). This {@link HOUSE_BOB} is now only
 * the {@link BuildingTypeBinding.default} fallback for a type with no `buildingBobs` row at all; every
 * real viking type binds its own bob through {@link BUILDING_FAMILIES}.
 */
const HOUSE_ATLAS = `ls_houses_viking.${HOUSE_PALETTE}`;
const HOUSE_BOB = 11;
/** Render scale for the building kind — see {@link HOUSE_BOB} (native house bobs are oversized vs the settler). */
const BUILDING_SCALE = 0.7;

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
const VIKING_HOUSE01_BOBS: Readonly<Record<number, number>> = {
  6: 41, // viking home
  10: 131, // viking well
  11: 91, // viking hive
  12: 60, // viking farm
  15: 105, // viking bakery
};

/** The `LogicTribeType` whose `buildingBobs` rows the render binds (viking 1). */
const VIKING_TRIBE = 1;

/**
 * The DEFAULT building atlas family — the single `ls_houses_viking.house01` layer drawn as
 * {@link SpriteSheet.kindLayers}'s `building` (a plain {@link BuildingBobRef}, no family). Its
 * `(bmd, palette)` identity tells {@link buildingBobRefsByType} which canonical rows draw from that
 * shared layer (a bare bob id) versus a named {@link SpriteSheet.families} layer (a `{ layer, bob }`).
 */
export const DEFAULT_BUILDING_FAMILY = { bmdBasename: HOUSE_BMD, paletteName: HOUSE_PALETTE } as const;

/**
 * The served atlas stems (`<bmd-stem>.<palette>`) = {@link SpriteSheet.families} keys for the named viking
 * building families loaded beside the default `ls_houses_viking.house01`. Two are sibling `.bmd`s on the
 * default `house01` skin (`viking2`/`viking3`); two are a *different palette* on a shared `.bmd` —
 * `housemiller01` recolours `ls_houses_viking.bmd` (the mill) and `housedruid01` recolours
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

/**
 * The named building-family atlases loaded BESIDE the default one — each a separate decoded
 * `ls_houses_*.bmd` × palette PNG with its OWN frame-id space, registered in {@link SpriteSheet.families}
 * under `layer` (= the served atlas stem). A canonical row in one of these binds a layer-qualified
 * `{ layer, bob }` ref; the {@link buildingBobRefsByType} reducer DROPS a row whose family is NOT in this
 * list (it falls back to {@link VIKING_HOUSE01_BOBS}/the default house), so a family must be both listed
 * here AND loaded in {@link loadHumanSpriteSheet} for its types to draw their real bob.
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
const CANONICAL_EDIT_NAME: Readonly<Record<number, string>> = {
  1: 'viking headquarters',
};

/**
 * The settler's directional animations come from `animations.ini`'s `[bobseq]` for `CR_Hum_Body_00.bmd`
 * (the head atlas shares the same bob ids). Each is {@link DIRS} directions laid back-to-back, `stride`
 * frames per direction. The frame RANGES (start + length) are no longer hard-coded here — they are read
 * from the IR's `bobSequences` (the `extractBobSequences` pipeline leg) by sequence name and turned into
 * a {@link DirectionalAnim} via {@link directionalAnimFromSeq} (`stride = length / DIRS`). What stays in
 * code is the render-taste tuning that the data does not carry: which sequence drives which state, the
 * `phaseStart` windup offset, and the single-frame idle hold.
 */
const DIRS = 8;
const WALK_SEQ = 'human_man_generic_walk';
const CHOP_SEQ = 'human_man_woodcutter_work_woodcutting';
// The LOADED gait — the settler walking while hauling a log. Same directional layout as the empty walk;
// the frames simply carry the wood. Bound to the settler's `carrying` override so a woodcutter walking
// its harvest back to the store plays this instead of the empty walk; its first frame holds a still
// loaded pose while it deposits.
const WALK_WOOD_SEQ = 'human_man_generic_walk_wood';

// The known-good ranges (verified against an owned copy: walk 1988/96, chop 5106/120, walk_wood 4580/96)
// kept as the FALLBACK when the manifest is absent (a checkout without content/, or an IR predating
// bobSequences) so `?atlas=real` still degrades to the right cycles instead of drawing a wrong range.
const FALLBACK_WALK: DirectionalAnim = { start: 1988, dirs: DIRS, stride: 12 };
// The 15-frame woodcut bobseq is a continuous loop. Verified by rendering every frame to a filmstrip:
// frames 0..8 are the axe coming DOWN to the tree (the strike, impact ~frame 8) and 9..14 are the axe
// RISING (the windup). So we play the FULL cycle but START at the windup (`phaseStart: 9`): it plays
// 9..14 (raise the axe) then 0..8 (swing down, impact) — a complete chop that *begins* with the windup
// and *ends* on the strike landing in the tree. Tick-locked cadence (one frame/tick) on the atomic's
// `elapsed`, same speed as every other animation.
const FALLBACK_CHOP: DirectionalAnim = { start: 5106, dirs: DIRS, stride: 15, phaseStart: 9 };
const FALLBACK_WALK_WOOD: DirectionalAnim = { start: 4580, dirs: DIRS, stride: 12 };

/** The chop atomic id (the demo slice's `harvest`), mapped to the woodcutting swing. */
const HARVEST_ATOMIC = 24;

/** One decoded `[bobseq]` sequence as it ships in `content/ir.json`'s `bobSequences`. */
interface BobSeqRow {
  readonly name: string;
  readonly start: number;
  readonly length: number;
}

/**
 * Build a {@link DirectionalAnim} from a decoded `[bobseq]` sequence: `start` is the run's first bob id,
 * `stride = length / DIRS` (the per-direction frame count). Returns {@link fallback} verbatim when the
 * named sequence is missing from the manifest (a partial/old IR), so the render keeps the known-good
 * range rather than computing a bogus one. The render-taste overrides (`frames` for a single-frame idle
 * hold, `phaseStart` for the chop windup) are applied on top of the extracted range. Pure + exported so
 * the seq→frame math is unit-tested without a browser.
 */
export function directionalAnimFromSeq(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  name: string,
  extra: { readonly frames?: number; readonly phaseStart?: number },
  fallback: DirectionalAnim,
): DirectionalAnim {
  const seq = seqByName.get(name);
  if (seq === undefined || seq.length <= 0) return fallback;
  return {
    start: seq.start,
    dirs: DIRS,
    stride: Math.floor(seq.length / DIRS),
    // exactOptionalPropertyTypes: only set an optional key when it has a value.
    ...(extra.frames !== undefined ? { frames: extra.frames } : {}),
    ...(extra.phaseStart !== undefined ? { phaseStart: extra.phaseStart } : {}),
  };
}

/** One `[GfxHouse]` `LogicType`→`GfxBobId` row as it ships in `content/ir.json`'s `buildingBobs`. */
interface BuildingBobRow {
  readonly tribeId: number;
  readonly typeId: number;
  readonly level: number;
  readonly bmd: string;
  readonly paletteName: string;
  readonly bobId: number;
  readonly editName?: string;
}

/** A loaded named building-family atlas: its `(bmd, palette)` identity + the {@link SpriteSheet.families} key it draws from. */
interface BuildingFamily {
  /** The `.bmd` basename the family's rows carry, e.g. `ls_houses_viking4.bmd`. */
  readonly bmdBasename: string;
  /** The `GfxPalette` recolour skin loaded for this family, e.g. `house01`. */
  readonly paletteName: string;
  /** The {@link SpriteSheet.families} key (= the served atlas stem), e.g. `ls_houses_viking4.house01`. */
  readonly layer: string;
}

/** The trailing path component of a (possibly slash-normalized) `bmd` path — `data/x/ls_houses_viking4.bmd` → `ls_houses_viking4.bmd`. */
function bmdBasename(bmd: string): string {
  const slash = bmd.lastIndexOf('/');
  return slash === -1 ? bmd : bmd.slice(slash + 1);
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
  const inPreferred = rows.filter((r) => r.paletteName === preferredPalette);
  let candidates = inPreferred.length > 0 ? inPreferred : rows;
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
 * Reduce the decoded `buildingBobs` join (the `extractBuildingBobs` leg) to the render's per-type bob
 * binding for ONE tribe across MANY loaded atlas families. For each `(tribeId, typeId)` it picks the
 * canonical row ({@link pickCanonicalBuildingRow}) and emits a {@link BuildingBobRef}:
 *  - a **bare bob id** when the canonical row's `(bmd, palette)` is the {@link defaultFamily} (the shared
 *    `ls_houses_viking.house01` layer drawn as {@link SpriteSheet.kindLayers}'s `building`), or
 *  - a **layer-qualified `{ layer, bob }`** when it's one of the loaded named {@link families} (e.g. the
 *    HQ in `ls_houses_viking4.house01`) — the multi-`.bmd` case, drawn from that family's own atlas.
 *
 * A canonical row whose family is NEITHER the default NOR a loaded named family is **dropped** — the
 * caller's {@link VIKING_HOUSE01_BOBS} overlay / {@link BuildingTypeBinding.default} backs it, so an
 * unloaded family degrades to the representative house instead of borrowing a WRONG bob from the default
 * layer (the renderer falls a layer-qualified ref through to the default layer when its family is absent,
 * so we must not emit one for a family we didn't load). `bmd` is matched on its trailing basename so a
 * sibling like `ls_houses_viking2.bmd` can't be a false positive. Returns `{}` when nothing matches.
 * Pure + exported so the join→binding reduction is unit-tested without a browser. For the default family
 * it reproduces the transcribed constant for typeIds 6/10/11/12/15 and ADDS the home/bakery growth-stage
 * typeIds the constant dropped.
 */
export function buildingBobRefsByType(
  rows: readonly BuildingBobRow[],
  tribeId: number,
  defaultFamily: { readonly bmdBasename: string; readonly paletteName: string },
  families: readonly BuildingFamily[],
): Record<number, BuildingBobRef> {
  const byType = new Map<number, BuildingBobRow[]>();
  for (const r of rows) {
    if (r.tribeId !== tribeId) continue;
    const list = byType.get(r.typeId);
    if (list === undefined) byType.set(r.typeId, [r]);
    else list.push(r);
  }
  const out: Record<number, BuildingBobRef> = {};
  for (const [typeId, list] of byType) {
    const row = pickCanonicalBuildingRow(typeId, list, defaultFamily.paletteName);
    if (row === undefined) continue;
    const base = bmdBasename(row.bmd);
    if (base === defaultFamily.bmdBasename && row.paletteName === defaultFamily.paletteName) {
      out[typeId] = row.bobId; // the shared default building layer — a bare id
      continue;
    }
    const family = families.find((f) => f.bmdBasename === base && f.paletteName === row.paletteName);
    if (family !== undefined) out[typeId] = { layer: family.layer, bob: row.bobId };
    // else: family not loaded → drop (the constant/default backs this typeId, no wrong-bob regression).
  }
  return out;
}

/**
 * The demo binding into the human atlases — the render twin of `vertical-slice.ts`'s `demoContent`. The
 * settler's walk/chop ranges are derived from `seqByName` (the extracted `bobSequences` for
 * `cr_hum_body_00.bmd`), so there are no hard-coded frame ids left here; an absent manifest falls back to
 * the known-good `FALLBACK_*` ranges. The building's per-type bobs **overlay** the extracted
 * `houseBobsByType` (the `buildingBobs` join, see {@link buildingBobRefsByType}) onto the transcribed
 * {@link VIKING_HOUSE01_BOBS} **per type**: real data wins where present, the constant covers any of its
 * five known types the data is missing (so a partial/absent IR degrades gracefully type-by-type instead
 * of dropping a whole family to the generic box). A `houseBobsByType` value may be layer-qualified (a
 * `{ layer, bob }` {@link BuildingBobRef} into a named {@link SpriteSheet.families} atlas — the HQ's
 * viking4 family); the constant's values are bare ids drawn from the default `building` layer.
 * `building`/`resource` resolve in their own per-kind layers (see {@link loadHumanSpriteSheet}'s
 * `kindLayers`), so their ids index the house/tree bobs, not the body's.
 */
export function buildHumanBindings(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  houseBobsByType?: Readonly<Record<number, BuildingBobRef>>,
): SpriteBindings {
  const walk = directionalAnimFromSeq(seqByName, WALK_SEQ, {}, FALLBACK_WALK);
  const stand = directionalAnimFromSeq(seqByName, WALK_SEQ, { frames: 1 }, { ...FALLBACK_WALK, frames: 1 });
  const chop = directionalAnimFromSeq(seqByName, CHOP_SEQ, { phaseStart: 9 }, FALLBACK_CHOP);
  const walkWood = directionalAnimFromSeq(seqByName, WALK_WOOD_SEQ, {}, FALLBACK_WALK_WOOD);
  const standWood = directionalAnimFromSeq(
    seqByName,
    WALK_WOOD_SEQ,
    { frames: 1 },
    { ...FALLBACK_WALK_WOOD, frames: 1 },
  );
  return {
    // CHOP is bound ONLY to the harvest atomic. There is intentionally no generic `acting` swing: an
    // unmapped action (a carrier/woodcutter depositing or picking up — atomics 22/23) falls back to a
    // STANDING pose, NOT a borrowed woodcut swing. Borrowing it made a 4-tick deposit replay the 15-frame
    // axe swing at ~4× speed (a fast, truncated chop) — the very glitch this binding removes.
    //
    // `carrying` is the loaded-gait override: once the woodcutter picks up its wood it walks the loaded
    // gait instead of the empty walk, and stands a loaded pose while it deposits. The chop still wins
    // while harvesting because a settler only carries *after* the harvest.
    settler: {
      idle: stand,
      moving: walk,
      byAtomic: { [HARVEST_ATOMIC]: chop },
      carrying: { idle: standWood, moving: walkWood },
    },
    // Each viking building type draws its own house bob (the `[GfxHouse]` `LogicType` → `GfxBobId` join),
    // data-driven from the extracted `buildingBobs` IR overlaid onto the transcribed VIKING_HOUSE01_BOBS:
    // real data wins per type, the constant backs its five known types when the IR is partial/absent
    // ({...undefined} / {...{}} spread to nothing → just the constant). A type in NEITHER falls back to
    // the representative HOUSE_BOB via BuildingTypeBinding.default.
    building: { byType: { ...VIKING_HOUSE01_BOBS, ...houseBobsByType }, default: HOUSE_BOB },
    resource: TREE_BOB,
  };
}

/**
 * Load one decoded atlas layer (`<stem>.{atlas.json,png}`) from the gitignored `content/` (served at
 * `/bobs/`): the manifest → in-memory frame geometry, the PNG → a GPU texture. Throws a pointed error
 * if the decoded files are missing (the pipeline hasn't been run / `content/` is empty) — an
 * environment precondition, not a recoverable boundary the renderer should silently swallow.
 */
async function loadLayer(stem: string): Promise<SpriteLayer> {
  const res = await fetch(`/bobs/${stem}.atlas.json`);
  if (!res.ok) {
    throw new Error(
      `?atlas=real: decoded atlas '${stem}' not found (HTTP ${res.status}). Run \`npm run pipeline\` against an owned game copy to populate content/.`,
    );
  }
  const manifest = (await res.json()) as AtlasManifest;
  return { atlas: atlasFromManifest(manifest), source: await loadAtlasSource(`/bobs/${stem}.png`) };
}

/** The `[bobseq]` imagelib whose sequences drive the settler — the body bob set the head atlas shares ids with. */
const BODY_IMAGELIB = 'cr_hum_body_00.bmd';

/** The render-binding lanes the `?atlas=real` path reads from the served `content/ir.json`. */
interface RenderIr {
  readonly bobSequences?: readonly { imagelib: string; sequences?: BobSeqRow[] }[];
  readonly buildingBobs?: readonly BuildingBobRow[];
}

/**
 * Fetch + parse the served `content/ir.json` ONCE (both the settler `[bobseq]` ranges and the building
 * `buildingBobs` join read from it). Returns `null` when it is absent or unparsable — unlike a missing
 * atlas (a hard precondition {@link loadLayer} throws on), a missing IR degrades gracefully: the settler
 * ranges fall back to the known-good `FALLBACK_*` and the house bobs to {@link VIKING_HOUSE01_BOBS}, so
 * `?atlas=real` still draws correctly on a checkout without `content/`.
 */
async function loadIr(): Promise<RenderIr | null> {
  try {
    const res = await fetch('/ir.json');
    if (!res.ok) return null;
    return (await res.json()) as RenderIr;
  } catch {
    return null;
  }
}

/**
 * Index the {@link BODY_IMAGELIB} bob set's `[bobseq]` sequences by name (the `extractBobSequences` leg).
 * Empty when the IR is absent or carries no sequences → {@link buildHumanBindings} falls back to the
 * known-good `FALLBACK_*` ranges.
 */
function bodySequencesByName(ir: RenderIr | null): Map<string, BobSeqRow> {
  const byName = new Map<string, BobSeqRow>();
  const set = (ir?.bobSequences ?? []).find((s) => s.imagelib === BODY_IMAGELIB);
  for (const seq of set?.sequences ?? []) byName.set(seq.name, seq);
  return byName;
}

/**
 * Load the real human {@link SpriteSheet}: the body layer as the base sheet, the head layer as an overlay
 * drawn on top at the same bob id, paired with bindings whose walk/chop ranges are read from the decoded
 * `bobSequences` (see {@link buildHumanBindings}). Together they compose a complete settler (body + head)
 * the renderer animates directionally per tick.
 */
export async function loadHumanSpriteSheet(): Promise<SpriteSheet> {
  const [body, head, tree, house, familyEntries, ir] = await Promise.all([
    loadLayer(HUMAN_BODY_ATLAS),
    loadLayer(HUMAN_HEAD_ATLAS),
    loadLayer(TREE_ATLAS),
    loadLayer(HOUSE_ATLAS),
    Promise.all(BUILDING_FAMILIES.map(async (f) => [f.layer, await loadLayer(f.layer)] as const)),
    loadIr(),
  ]);
  // BUILDING_FAMILIES is the SINGLE SOURCE OF TRUTH for the named building families: each entry's atlas is
  // loaded here AND only its `layer` key is eligible for a layer-qualified ref from buildingBobRefsByType,
  // so the loaded set and the reducer's emitted set cannot drift (a ref to an unloaded family would fall
  // through to the default layer and draw a WRONG bob). All seven viking families load now (viking2/3/4 +
  // the miller/druid skins + the two house02 families), so EVERY viking building draws its own bob — see
  // BUILDING_FAMILIES.
  const families = Object.fromEntries(familyEntries);
  const houseBobs = buildingBobRefsByType(
    ir?.buildingBobs ?? [],
    VIKING_TRIBE,
    DEFAULT_BUILDING_FAMILY,
    BUILDING_FAMILIES,
  );
  return {
    source: body.source,
    atlas: body.atlas,
    bindings: buildHumanBindings(bodySequencesByName(ir), houseBobs),
    overlays: [head],
    // The tree and the DEFAULT building each draw from their OWN atlas (distinct id spaces), so they bind
    // as per-kind layers rather than sharing the body atlas the settler uses. `resource` -> TREE_BOB and
    // a bare-id `building` -> HOUSE_BOB resolve frames in THEIR respective layers.
    kindLayers: { resource: tree, building: house },
    // Named building families (the multi-.bmd case) — a layer-qualified building binding draws its bob
    // from the matching family atlas here (its own frame-id space). A family inherits the building kind
    // scale below unless it lists its own `familyScales` entry.
    families,
    // The native house bobs are oversized next to the settler; shrink only the building (tree + settler
    // stay native — their proportion already reads right). Named families inherit this. See BUILDING_SCALE.
    kindScales: { building: BUILDING_SCALE },
  };
}

/**
 * Resolve the sprite sheet for the `?atlas` flag — the single answer shared by the live (`main.ts`) and
 * scene (`scene-mode.ts`) entries so both honour the flag identically: `?atlas=real` → the decoded human
 * atlas; any other `?atlas` value → the reproducible synthetic atlas (flat-coloured markers, no
 * copyrighted data); absent → `undefined`, so sprites draw as placeholder geometry.
 */
export async function resolveSpriteSheet(params: URLSearchParams): Promise<SpriteSheet | undefined> {
  if (params.get('atlas') === 'real') return loadHumanSpriteSheet();
  if (params.has('atlas')) {
    return {
      source: createSyntheticAtlasSource(),
      atlas: syntheticAtlasFrames(),
      bindings: SYNTHETIC_BINDINGS,
    };
  }
  return undefined;
}
