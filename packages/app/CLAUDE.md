# packages/app — the shell (the only package that touches both sim and render)

`app` wires input → sim **commands**, runs the fixed-timestep loop, and hands each `snapshot()` to
`render`. It is the ONE package allowed to depend on both `sim` and `render`. The root
[`CLAUDE.md`](../../CLAUDE.md) carries the project-wide rules; this file is the app-local contract.

## Boundaries

- **DOM + floats are fine here** (and in `render`), never in `sim`. `performance.now`/RAF/`fetch` live
  at this layer — they are the I/O boundary the pure sim must not have. Load gitignored `content/`
  (maps, atlases, textures) via `fetch` over the dev-server middleware (`vite.config.ts`), and degrade
  gracefully when it's absent (a checkout without `content/` must still boot).
- **One-way flow:** app issues commands into the sim and reads `snapshot()` out; never reach into live
  component stores from render glue. Determinism is the sim's; the app just drives wall-clock → ticks.

## Package layout

`src/` is grouped by concern (not flat) so each thing has ONE obvious home — add new code to the folder
that matches its role instead of piling another method onto a growing file:

- **`main.ts`** — the thin URL dispatcher. Reads `window.location.search`, picks ONE entry, hands off. No
  wiring lives here; it only routes.
- **`entries/`** — one module per URL entry (the "modes"): `menu.ts` (the default landing), `live.ts`
  (`?live`/`?map=`), `scene.ts` (`?scene=`), `anim.ts` (+ `anim-cells.ts` pure builders + `anim-overlay.ts`
  panel), `shot.ts` (`?shot`). An entry owns its Pixi app + loop; it pulls binding data from `content/`.
- **`content/`** — the decoded-content → render binding (the gitignored-`content/` I/O boundary): `ir.ts`
  (atlas/IR byte loading), `building-gfx.ts` + `settler-gfx.ts` (the pure per-type/per-character bob-binding
  reducers, unit-tested), `sprite-sheet.ts` (assembles the `SpriteSheet` + `resolveSpriteSheet`), `terrain.ts`,
  `objects.ts`. This is where the old 1200-line `real-sprites.ts` now lives, split by responsibility.
- **`catalog/`** — committed clean-room data catalogs (English naming over the original's typeIds):
  `buildings.ts` (the 41 viking buildings), `roster.ts` (the character roster).
- **`view/`** — browser-view helpers: `camera.ts` (pure pan/zoom math + the DOM controller), `overlay.ts`
  (shared panel chrome — `el`/`button`/`navButton`/styles, used by every panel), `scene-overlay.ts`,
  `perf-overlay.ts`.
- **`slice/vertical-slice.ts`** — the demo scenario (synthetic content + `runSlice` + map loading) the live
  + shot entries share.
- **`scenes/`** — the acceptance-scene system (see below).

## URL-flag entries

The app dispatches on `window.location.search` (see `main.ts`, a thin router into `entries/`). **With no
flag the default is the main menu** (`entries/menu.ts`) — a landing page of clickable cards (every
acceptance scene, the live sandbox, the animation gallery, each decoded map from the dev server's
`/maps-index` route), so a human never has to remember a `?…` string. Each flag below is opt-in and
degrades to a reproducible default so the committed build + the `npm run shot` PNG never depend on
gitignored bytes:

- `?live` (or `?map=<id>`) — the live **vertical-slice sandbox** (`entries/live.ts`): the fixed-timestep
  loop drawn every frame. The menu's "Podgląd na żywo" card. Mounts the LEFT tool panel (below).
- `?shot[&seed&ticks&hud]` — headless deterministic screenshot entry (`entries/shot.ts`).
- `?scene=<id>` — run a registered **acceptance scene** with its checklist overlay (`entries/scene.ts`).
- **LEFT tool panel** — the original toolbar strip + tool buttons + game-speed button + building/stats windows
  is part of the standard game HUD, mounted over BOTH `?live` and every `?scene=` via the shared
  `view/game-tool-panel.ts` (NOT a per-scene flag — it is global). Its game-speed button drives the tick
  rate live (×1/×2/×3/pause); `?speed=` still seeds the initial rate (and reaches sub-1× the button can't).
  It replaced the scene-overlay's old playback buttons (the overlay is now the sign-off checklist only).
  `?uiscale=1|2|3` sets its integer UI scale (default 1×; the strip is 433 design px tall, so 1× already fills
  ~half a modern window) — the panel's internal geometry stays pinned.
- `?anim[&char=<id>&view=anim|heads|colors&color=0..15&dir=full|0..7&cols=N&filter=<substr>&zoom&speed]` — the
  character **animation gallery** (`entries/anim.ts` + `catalog/roster.ts`), the extracted `[bobseq]` played from
  the atlas with a direction selector so a human can validate all animations in all 8 facings. **Bare `?anim` (no
  `?char=`) is the DEFAULT: the full-roster montage** — one walking cell per viking look (every roster body ×
  each of its heads) on one screen. `?char=<id>` drills into one body — its full animation set (`?view=anim`)
  or, for a multi-look body, its heads montage (`?view=heads`, the plain walk once per head). The roster
  (civilian / **warrior** with its broadsword/sword/bow/spear/bare-handed set / woman / boy / girl / baby) is
  the mod's viking `[jobbasegraphics]` body/head pairs; the baby is body-only. Character/view changes reload
  the page (different atlases); direction is live. Real graphics required (shows a "run the pipeline" message
  when `content/` is absent). **Player (team) colours:** `?view=colors` is the 16-colour montage (the walk once
  per player colour); `?color=N` (0–15) paints a character's whole animation set in one player colour — both draw
  the **indexed** atlas through the `256×16` player-colour LUT via `render`'s `PalettedSprite` (only the clothing
  band recolours; see docs/FIDELITY.md "Player (team) colours"). A per-tone **skin/hair variant** axis (distinct
  from team colour) is still a deferred pipeline follow-up (docs/FIDELITY.md).
- `?sound=off` — mute the original decoded sounds (`@vinland/audio`), which are **default-on** in live +
  scene modes: positional action SFX + terrain ambient (viewport-culled, attenuated, panned) + non-spatial
  life-event jingles + **sex/age-matched settler voice chatter** (a settler sounds like the body it draws —
  `vikingVoiceClass` off `Settler.jobType`+`Age`), driven by the same snapshot + events `render` reads.
  Browser autoplay policy keeps audio suspended until the first click/key; a checkout without `content/`
  (no sound bank) degrades to silence. The best place to HEAR action→sound is `?scene=sound-showcase`
  (woodcutters chopping continuously, on-screen).
- `?sounds` — the sound **verification gallery** (`entries/sound.ts`), the audio twin of `?anim`: click ▶ to
  audition every action→sound binding, the voice pools split by sex/age, the jingles and the ambient beds.
  The human-oracle seam for audio (an agent can't self-judge a sound). NOTE the key is `sounds` (plural) —
  distinct from the `sound` (singular) MUTE modifier above, so `?live&sound=off` and `?sounds` don't collide.
- `?map=<id>` · `?atlas` · `?terrain=off` · `?objects=off` · `?zoom=N` · `?speed=N` · `?center=x,y` ·
  `?pitch=N` — real decoded map / sprite atlas / ground-texture + map-object opt-outs / camera magnify /
  playback rate (seeds the INITIAL rate; the tool panel's game-speed button then drives it live in
  `?live`/`?scene` — use `?speed=` for a sub-1× pace the discrete button can't reach) / centre the camera on
  tile `(x,y)` (an inspection knob for a decoded-map feature — a
  bridge, a coastline — the settler-centroid framing never reaches; malformed → default framing) / **set
  the tile-diamond width in px** (`?pitch`, the live master-scale knob — sprite-vs-terrain size, kept iso
  2:1, default 64; sweep it to calibrate the look by eye, `setTilePitch` in `iso.ts`). These compose with
  `?scene=`. The live view also mounts the FPS / entity-count perf overlay (bottom-left), like `?scene=`.
  Real graphics are the **default** for live + scene (`resolveSpriteSheet` degrades to synthetic
  markers when `content/` is absent, so a bare checkout still boots); `?atlas=synthetic` forces markers,
  `?atlas=none` placeholder geometry. **Real ground textures are likewise default-on** in live mode
  (degrading to the flat tint without `content/`); `?terrain=off` forces the flat tint. **`?map=<id>` is the
  full original-map import view** — 1:1 per-triangle ground (the map's baked `GfxPattern` lanes) + every
  placed landscape object (trees/stones/mines/palisades + animated waves); `?objects=off` shows the bare
  ground. Like `?anim`, `?map=` is a real-content human-validation entry, NOT a `SceneDefinition` (a scene's
  headless half must run on synthetic content — copyrighted map data can't enter the tests). `?shot` keeps
  its own content-free default so the committed PNG never depends on gitignored bytes.

## Acceptance scenes — let a human sign off a mechanic

An agent **cannot self-judge pixels** (root `CLAUDE.md` "How to verify your work", point 5). An
*acceptance scene* is the seam: ONE deterministic setup with two consumers —

- **headless** (`test/scenes.test.ts`) proves the *mechanic* (the agent self-validates with `npm test`),
- **browser** (`?scene=<id>`) renders the SAME run with a checklist overlay so a *human* judges the pixels.

To add one (full guide in [`docs/SCENES.md`](../../docs/SCENES.md)):

1. Write `src/scenes/<id>.ts` exporting a `SceneDefinition` — synthetic `content` (zod-validated, never
   copyrighted data), a `terrain` grid, a `build(sim)` that places the world, a human `checklist`, and
   machine `checks` (the mechanic the headless test asserts).
2. Register it in `src/scenes/index.ts` (`SCENES`). That auto-adds its headless test AND its `?scene=` link.
3. `npm test` (mechanic green) → then surface `npm run dev` → `http://localhost:5173/?scene=<id>` and the
   checklist, and ask the user whether it looks right. Don't claim the visual is correct yourself.

Scene sims share `sim`'s **module-level component stores** (a known footgun), so `createSceneSim` resets
them on every build — don't bypass it (the headless harness builds many scene sims in one process).
