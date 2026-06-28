import {
  type AtlasManifest,
  type DirectionalAnim,
  type SpriteBindings,
  type SpriteLayer,
  type SpriteSheet,
  atlasFromManifest,
  loadAtlasSource,
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
 * faces (the frame advances one per sim tick). `building`/`resource` are left unbound (this atlas has
 * no building art; the viking house `.bmd` isn't decoded yet) so they keep their placeholder geometry.
 */

/** The decoded human body + head atlases (`test_human_00` palette) served at `/bobs/<name>.*`. */
const HUMAN_BODY_ATLAS = 'cr_hum_body_00.test_human_00';
const HUMAN_HEAD_ATLAS = 'cr_hum_head_00.test_human_00';

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
  // unmapped action (a carrier/woodcutter depositing or picking up — atomics 22/23) falls back to the
  // standing `idle` pose, NOT a borrowed woodcut swing. Borrowing it made a 4-tick deposit replay the
  // 15-frame axe swing at ~4× speed (a fast, truncated chop) — the very glitch this binding removes. A
  // dedicated carry/place animation is a later slice (no such bob is decoded yet).
  settler: { idle: STAND, moving: WALK, byAtomic: { [HARVEST_ATOMIC]: CHOP } },
  building: -1,
  resource: -1,
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
  const [body, head] = await Promise.all([loadLayer(HUMAN_BODY_ATLAS), loadLayer(HUMAN_HEAD_ATLAS)]);
  return { source: body.source, atlas: body.atlas, bindings: HUMAN_BINDINGS, overlays: [head] };
}
