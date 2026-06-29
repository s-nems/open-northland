import {
  type AtlasManifest,
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
 * now draws as a real tree; `building` binds the decoded `ls_houses_viking.bmd` house atlas and draws
 * each building type its OWN house bob — the `[GfxHouse]` `LogicType` → `GfxBobId` join, derived from the
 * extracted `buildingBobs` IR ({@link buildingBobsByType}), with the transcribed {@link VIKING_HOUSE01_BOBS}
 * as the graceful fallback when `content/` is absent.
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
 * The decoded building atlas bound to the `building` kind — `ls_houses_viking.bmd` recoloured with the
 * `house01` palette (the `[GfxHouse]` viking records' binding from the mod's
 * `budynki12/houses/houses.ini`). Like the tree it lives in its OWN frame-id space (135 bobs, distinct
 * from the human body bobs), so it binds as a per-kind {@link SpriteSheet.kindLayers} layer, not the
 * shared body atlas. {@link HOUSE_BOB} 11 is the "viking home" record's first finished growth stage — a
 * stone-and-thatch cottage (213×198 anchored at its base). At native size every house bob draws ~6–10×
 * the settler's height — far larger than the original showed a house next to a person — so the building
 * is drawn at {@link BUILDING_SCALE} about its feet anchor (the settler + tree stay native, their
 * proportion already reads right). At 0.7 the cottage lands ~3× the settler, the by-eye pick from a 1:1
 * pawn-vs-tree-vs-building montage. Both the bob and the scale are taste constants (the warehouse "viking
 * stock" needs the not-yet-decoded house02 palette) — swap them to a bigger stage / different factor
 * (docs/FIDELITY.md "Building bob"). The HQ store now draws as this house instead of the placeholder box.
 */
/**
 * The loaded building atlas, kept as its `(bmd, palette)` parts so {@link buildingBobsByType} can pick
 * the matching `buildingBobs` rows from the IR (the row's `bmd` is the full normalized path, so we
 * match by suffix). {@link HOUSE_ATLAS} is the served atlas stem (`<bmd-stem>.<palette>`).
 */
const HOUSE_BMD = 'ls_houses_viking.bmd';
const HOUSE_PALETTE = 'house01';
const HOUSE_ATLAS = `ls_houses_viking.${HOUSE_PALETTE}`;
const HOUSE_BOB = 11;
/** Render scale for the building kind — see {@link HOUSE_BOB} (native house bobs are oversized vs the settler). */
const BUILDING_SCALE = 0.7;

/**
 * FALLBACK per-building-type bob ids for the viking buildings that share the {@link HOUSE_ATLAS}
 * (`ls_houses_viking.bmd` recoloured `house01`). The live path now derives this map from the extracted
 * `buildingBobs` IR ({@link buildingBobsByType}); this transcribed constant is the graceful fallback
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
  readonly typeId: number;
  readonly level: number;
  readonly bmd: string;
  readonly paletteName: string;
  readonly bobId: number;
}

/**
 * Reduce the decoded `buildingBobs` join (the `extractBuildingBobs` leg) to the render's per-type bob
 * map for ONE loaded atlas family: keep only rows whose `(bmd, paletteName)` match the atlas that was
 * loaded (`bmd` is the full normalized path, so match by suffix), then pick the HIGHEST-`level` row per
 * `typeId`. The growth chain is expressed as DISTINCT typeIds (viking home t2..t6 = typeIds 2..6 → bobs
 * 1/11/21/31/41), so within one typeId the level is effectively constant in this family; the max-level
 * pick is a deterministic tiebreaker for the duplicate (lumped) rows and any future multi-level typeId.
 * Returns `{}` when no row matches → the caller falls back to {@link VIKING_HOUSE01_BOBS}. Pure +
 * exported so the join→table reduction is unit-tested without a browser. For the `house01` family it
 * reproduces the transcribed constant for typeIds 6/10/11/12/15 and ADDS the home/bakery growth-stage
 * typeIds the constant dropped.
 */
export function buildingBobsByType(
  rows: readonly BuildingBobRow[],
  bmdSuffix: string,
  paletteName: string,
): Record<number, number> {
  const best = new Map<number, BuildingBobRow>();
  for (const r of rows) {
    if (r.paletteName !== paletteName || !r.bmd.endsWith(bmdSuffix)) continue;
    const prev = best.get(r.typeId);
    if (prev === undefined || r.level > prev.level) best.set(r.typeId, r);
  }
  const out: Record<number, number> = {};
  for (const [typeId, r] of best) out[typeId] = r.bobId;
  return out;
}

/**
 * The demo binding into the human atlases — the render twin of `vertical-slice.ts`'s `demoContent`. The
 * settler's walk/chop ranges are derived from `seqByName` (the extracted `bobSequences` for
 * `cr_hum_body_00.bmd`), so there are no hard-coded frame ids left here; an absent manifest falls back to
 * the known-good `FALLBACK_*` ranges. The building's per-type bobs come from `houseBobsByType` (the
 * extracted `buildingBobs` join, see {@link buildingBobsByType}); an empty/omitted map (an absent IR)
 * falls back to the transcribed {@link VIKING_HOUSE01_BOBS}. `building`/`resource` resolve in their own
 * per-kind layers (see {@link loadHumanSpriteSheet}'s `kindLayers`), so their ids index the house/tree
 * bobs, not the body's.
 */
export function buildHumanBindings(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  houseBobsByType?: Readonly<Record<number, number>>,
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
    // Each viking building type draws its own house bob (the `[GfxHouse]` `LogicType` → `GfxBobId`
    // join), now data-driven from the extracted `buildingBobs` IR; an empty/absent table falls back to
    // the transcribed VIKING_HOUSE01_BOBS, and a type absent from the table to the representative HOUSE_BOB.
    building: {
      byType:
        houseBobsByType && Object.keys(houseBobsByType).length > 0 ? houseBobsByType : VIKING_HOUSE01_BOBS,
      default: HOUSE_BOB,
    },
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
  const [body, head, tree, house, ir] = await Promise.all([
    loadLayer(HUMAN_BODY_ATLAS),
    loadLayer(HUMAN_HEAD_ATLAS),
    loadLayer(TREE_ATLAS),
    loadLayer(HOUSE_ATLAS),
    loadIr(),
  ]);
  const houseBobs = buildingBobsByType(ir?.buildingBobs ?? [], HOUSE_BMD, HOUSE_PALETTE);
  return {
    source: body.source,
    atlas: body.atlas,
    bindings: buildHumanBindings(bodySequencesByName(ir), houseBobs),
    overlays: [head],
    // The tree and the building each draw from their OWN atlas (distinct id spaces), so they bind as
    // per-kind layers rather than sharing the body atlas the settler uses. `resource` -> TREE_BOB and
    // `building` -> HOUSE_BOB resolve frames in THEIR respective layers.
    kindLayers: { resource: tree, building: house },
    // The native house bobs are oversized next to the settler; shrink only the building (tree + settler
    // stay native — their proportion already reads right). See BUILDING_SCALE.
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
