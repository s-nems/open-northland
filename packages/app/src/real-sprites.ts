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
 * now draws as a real tree; `building` stays unbound (the viking house `.bmd` isn't decoded yet) and
 * keeps its placeholder geometry.
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
const HOUSE_ATLAS = 'ls_houses_viking.house01';
const HOUSE_BOB = 11;
/** Render scale for the building kind — see {@link HOUSE_BOB} (native house bobs are oversized vs the settler). */
const BUILDING_SCALE = 0.7;

/**
 * The settler's directional animation ranges, read off `animations.ini`'s `[bobseq]` for
 * `CR_Hum_Body_00.bmd` (the head atlas shares the same bob ids). Each is 8 directions laid back-to-back
 * (`dirs: 8`), `stride` frames per direction:
 *   - walk  `human_man_generic_walk` — start 1988, 8×12.
 *   - chop  `human_man_woodcutter_work_woodcutting` — start 5106, 8×15 (the full axe swing).
 * Idle holds a single planted pose per direction (the walk cycle's first frame), so a stopped settler
 * still turns to face its heading without a distracting idle loop.
 */
const WALK: DirectionalAnim = { start: 1988, dirs: 8, stride: 12 };
// The 15-frame woodcut bobseq is a continuous loop. Verified by rendering every frame to a filmstrip:
// frames 0..8 are the axe coming DOWN to the tree (the strike, impact ~frame 8) and 9..14 are the axe
// RISING (the windup). So we play the FULL cycle but START at the windup (`phaseStart: 9`): it plays
// 9..14 (raise the axe) then 0..8 (swing down, impact) — a complete chop that *begins* with the windup
// and *ends* on the strike landing in the tree. Tick-locked cadence (one frame/tick) on the atomic's
// `elapsed`, same speed as every other animation.
const CHOP: DirectionalAnim = { start: 5106, dirs: 8, stride: 15, phaseStart: 9 };
const STAND: DirectionalAnim = { start: 1988, dirs: 8, stride: 12, frames: 1 };
// The LOADED gait — `human_man_generic_walk_wood` (bob 4580, 8×12), the settler walking while hauling a
// log. Same directional layout as WALK; the frames simply carry the wood the empty-handed walk doesn't
// (decoded and verified present for all 8×12 frames in both the body and head atlases). Bound to the
// settler's `carrying` override so a woodcutter walking its harvest back to the store plays this instead
// of the empty walk; WALK_WOOD's first frame (STAND_WOOD) holds a still loaded pose while it deposits.
const WALK_WOOD: DirectionalAnim = { start: 4580, dirs: 8, stride: 12 };
const STAND_WOOD: DirectionalAnim = { start: 4580, dirs: 8, stride: 12, frames: 1 };

/** The chop atomic id (the demo slice's `harvest`), mapped to the woodcutting swing. */
const HARVEST_ATOMIC = 24;

/**
 * The demo binding into the human atlases — the render twin of `vertical-slice.ts`'s `demoContent` (it
 * hardcodes content ids for the slice the same way). The frame numbers are `animations.ini` `[bobseq]`
 * starts, a numeric cross-reference into the data layout, not committed art. `building`/`resource` map
 * to -1 (absent from these atlases) so the resolver returns null and they fall back to placeholder
 * geometry. Replaced wholesale by the extracted animation manifest once the `animations.ini` →
 * sequence-manifest pipeline step lands (then no hardcoded frame ids here).
 */
const HUMAN_BINDINGS: SpriteBindings = {
  // CHOP is bound ONLY to the harvest atomic. There is intentionally no generic `acting` swing: an
  // unmapped action (a carrier/woodcutter depositing or picking up — atomics 22/23) falls back to a
  // STANDING pose, NOT a borrowed woodcut swing. Borrowing it made a 4-tick deposit replay the 15-frame
  // axe swing at ~4× speed (a fast, truncated chop) — the very glitch this binding removes.
  //
  // `carrying` is the loaded-gait override: once the woodcutter picks up its wood it walks WALK_WOOD
  // (bob 4580, the log-on-shoulder cycle) instead of the empty WALK, and stands STAND_WOOD while it
  // deposits. The chop still wins while harvesting because a settler only carries *after* the harvest.
  settler: {
    idle: STAND,
    moving: WALK,
    byAtomic: { [HARVEST_ATOMIC]: CHOP },
    carrying: { idle: STAND_WOOD, moving: WALK_WOOD },
  },
  // The building (HQ) draws bob 11 of the ls_houses_viking atlas, blitted from its own per-kind layer
  // (see loadHumanSpriteSheet's kindLayers) — its id space is the house bobs, not the human body's, so
  // this number is meaningless without that layer (the two are bound together below). Was -1 (unbound →
  // placeholder box) until the decoded house atlas landed.
  building: HOUSE_BOB,
  // The wood node draws bob 60 of the ls_trees atlas, blitted from its own per-kind layer (see
  // loadHumanSpriteSheet's kindLayers) — its id space is the tree bobs, not the human body's, so this
  // number is meaningless without that layer (the two are bound together below).
  resource: TREE_BOB,
};

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

/**
 * Load the real human {@link SpriteSheet}: the body layer as the base sheet, the head layer as an
 * overlay drawn on top at the same bob id, paired with the demo {@link HUMAN_BINDINGS}. Together they
 * compose a complete settler (body + head) the renderer animates directionally per tick.
 */
export async function loadHumanSpriteSheet(): Promise<SpriteSheet> {
  const [body, head, tree, house] = await Promise.all([
    loadLayer(HUMAN_BODY_ATLAS),
    loadLayer(HUMAN_HEAD_ATLAS),
    loadLayer(TREE_ATLAS),
    loadLayer(HOUSE_ATLAS),
  ]);
  return {
    source: body.source,
    atlas: body.atlas,
    bindings: HUMAN_BINDINGS,
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
