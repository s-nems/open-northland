# packages/app — the shell (the only package that touches both sim and render)

`app` wires input → sim **commands**, runs the fixed-timestep loop, and hands each `snapshot()` to
`render`. It is the ONE package allowed to depend on both `sim` and `render`. The root
[`AGENTS.md`](../../AGENTS.md) carries the project-wide rules; this file is the app-local contract.

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
- **`entries/`** — one module per URL entry (the "modes"): `menu.ts` (the default landing), `map.ts`
  (`?map=`), `scene.ts` (`?scene=`), `anim.ts` (+ `anim-cells.ts` pure builders + `anim-overlay.ts`
  panel), `sound.ts` (`?sounds`), `shot.ts` (`?shot`). An entry assembles its world (terrain, sim, renderer,
  starting camera); the two playable entries then hand off to the shared `view/game-view.ts` runtime.
- **`content/`** — the decoded-content bindings (the gitignored-`content/` I/O boundary; mostly →
  render, plus one → sim): `net.ts` (the shared fetch/degrade helpers), `ir.ts` (the ONE memoized
  `ir.json` fetch + the `ContentIr` view + atlas loading), `building-gfx.ts` + `settler-gfx.ts` (the
  pure per-type/per-character bob-binding reducers, unit-tested), `sprite-sheet.ts` (assembles the
  `SpriteSheet` + `resolveSpriteSheet`), `terrain.ts`, `objects.ts`, `collision.ts` (the decoded-map →
  SIM join: ground classes + object block areas → the semantic collision grid), `gui-gfx.ts`/
  `gui-art.ts`/`gui-atlas-map.ts` + `font-gfx.ts` (the GUI/font art bindings), `audio.ts`.
- **`catalog/`** — committed clean-room data catalogs (English naming over the original's typeIds):
  `buildings.ts` (the 41 viking buildings), `roster.ts` (the character roster), `atomics.ts` (the harvest
  atomic ids), `felling.ts`/`mining.ts` (gathering pins).
- **`game/`** — the GLOBAL game content + rules shared by every mode: `rules.ts` (player/tribe constants
  — `HUMAN_PLAYER`, `ENEMY_PLAYER`, `PRIMARY_TRIBE`, `HUD_TRIBE`), `snapshot.ts` (typed snapshot readers
  shared by the view controls and the HUD panels), and the `sandbox/` package — `ids.ts`
  (semantic type ids + the `GATHERERS` table), `content.ts` (the one `sandboxContent()` `ContentSet` —
  goods/jobs/buildings/weapons/animation bindings), `worker-slots.ts` (the extracted worker/carrier slot
  table + its trade names) and `construction.ts` (the build-cost + hitpoint tables) it assembles from,
  `place.ts` (the place/spawn helpers), `index.ts` (the barrel). Scenes and the vertical slice consume
  this; they do NOT define their own content.
- **`hud/`** — the in-game HUD: `geometry.ts` (the shared `Rect`/`contains`), `chrome.ts`
  (parchment window chrome + highlight theme), `ui-text.ts` (the shared vector-serif `makeUiTextRun`
  factory — the HUD default text face), `bitmap-text.ts` (the `.fnt` glyph runs + the `makeTextRun`
  factory — retained for exact-decoded-face needs, but not the current default),
  `action-ring-layout.ts` (the settler action-menu geometry), the `tool-panel/` package —
  pure models (`layout.ts`, `building-menu.ts`, `game-speed.ts`, headlessly unit-tested) + window
  controllers (`menu-window.ts`, `stats-window.ts`, `placement.ts` over the shared `context.ts`) +
  `index.ts` (the mount + input routing) — and the `details-panel/` package (the bottom-right selection
  panel in original art: pure `model/` (bars/context/settler/building split) + `layout.ts`, `chrome.ts`/`sections.ts` drawing, `panel.ts`
  mount). Text: both the tool-panel and details-panel HUD draw the bundled vector serif
  (`content/ui-font.ts`) — the tool-panel via `ui-text.ts`'s `makeUiTextRun`, the details-panel from
  `content/ui-font.ts` directly — an intentional, named legibility approximation that rasters crisp at
  the HUD's fractional UI scale where a small indexed bitmap glyph reads blocky; the decoded `.fnt`
  bitmap path (`bitmap-text.ts`) stays available for anything that must be the exact original face. The
  hud layer never imports `view/` — view glue (e.g. `backingScale`) is injected via options.
- **`view/`** — browser-view helpers: `game-view.ts` (the SHARED in-game runtime — HUD mounts + the one
  fixed-timestep RAF loop both playable entries run on), `camera.ts` (pure pan/zoom math + the DOM
  controller), `params.ts` (URL-param parsing), `picking.ts`,
  `overlay.ts` (shared panel + full-page chrome — `el`/`navButton`/`pageSection`/styles),
  `game-tool-panel.ts`, `unit-controls.ts` + `settler-actions.ts` (RTS unit control; the selection
  details panel itself lives in `hud/details-panel/`), `scene-overlay.ts`, `perf-overlay.ts`.
- **`slice/`** — the demo scenario the live + shot entries share: `vertical-slice.ts` (`runSlice` /
  `runAuthoredSlice` over the global `game/` content), `map-loader.ts` (the decoded-map fetch),
  `authored-placements.ts` (the pure authored-entity join).
- **`scenes/`** — the acceptance-scene system (see below) + `sandbox-queries.ts` (the scene-check world
  queries).

## URL-flag entries

The app dispatches on `window.location.search` (see `main.ts`, a thin router into `entries/`). **With no
flag the default is the main menu** (`entries/menu.ts`) — a landing page of clickable cards (every
acceptance scene, the animation gallery, each decoded map from the dev server's
`/maps-index` route), so a human never has to remember a `?…` string. Each flag below is opt-in and
degrades to a reproducible default so the committed build + the `npm run shot` PNG never depend on
gitignored bytes:

- `?map=<id>` — the **decoded-map viewer** (`entries/map.ts`): draws a real `content/maps/<id>.json` grid
  driven by the vertical-slice sim on the fixed-timestep loop, drawn every frame. The menu's "Mapy" section
  links here per decoded map. Mounts the LEFT tool panel (below); falls back to the synthetic grass strip
  when the map is absent (gitignored), so a bare checkout still boots.
- `?shot[&seed&ticks&hud]` — headless deterministic screenshot entry (`entries/shot.ts`).
- `?scene=<id>` — run a registered **acceptance scene** with its checklist overlay (`entries/scene.ts`).
- **LEFT tool panel** — the original toolbar strip + tool buttons + game-speed button + building/stats windows
  is part of the standard game HUD, mounted over BOTH `?map=` and every `?scene=` via the shared
  `view/game-tool-panel.ts` (NOT a per-scene flag — it is global). Its game-speed button drives the tick
  rate live (clicks cycle ×1 → ×2 → ×3 → ×1; the `P` key toggles pause, remembering the running speed and
  washing the world sepia while paused); `?speed=` still seeds the initial rate (and reaches sub-1× the
  button can't).
  The scene overlay is the sign-off checklist only (no playback buttons).
  `?uiscale=` sets its UI scale (default 1.4×, fractional allowed; the strip is 433 design px tall, so 1×
  already fills ~half a modern window). The nearest-sampled INDEXED art can't be linear-filtered, so a
  fractional scale would double texel columns unevenly ("pixeloza"); to stay crisp the strip+buttons are
  rasterized at an integer oversample into an off-screen texture and linear-downscaled to the display size
  (`hud/tool-panel/strip-texture.ts`). The panel's internal geometry stays pinned; the scale is the single
  knob a future in-game UI-size slider would drive.
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
  band recolours). A per-tone **skin/hair variant** axis (distinct from team colour) is still a
  deferred pipeline follow-up; file it as a `docs/tickets/` ticket before implementing.
- `?sound=off` — skip building the audio pipeline (`@vinland/audio`) entirely. In live + scene modes the
  decoded sounds are **default-MUTED**: the driver is built but starts disabled, and the game is silent
  until the user clicks the bottom-centre **sound toggle** button — that click both unmutes and satisfies
  the browser autoplay gesture (clicking again re-mutes). The audio layer is positional action SFX +
  terrain ambient (viewport-culled, attenuated, panned) + non-spatial life-event jingles + **sex/age-matched
  settler voice chatter** (a settler sounds like the body it draws — `vikingVoiceClass` off
  `Settler.jobType`+`Age`), driven by the same snapshot + events `render` reads. A checkout without
  `content/` (no sound bank) degrades to silence (no driver, no button). The current scene for hearing
  action→sound is `?scene=sandbox` (woodcutters and gatherers working on-screen).
- `?sounds` — the sound **verification gallery** (`entries/sound.ts`), the audio twin of `?anim`: click ▶ to
  audition every action→sound binding, the voice pools split by sex/age, the jingles and the ambient beds.
  The human-oracle seam for audio (an agent can't self-judge a sound). NOTE the key is `sounds` (plural) —
  distinct from the `sound` (singular) MUTE modifier above, so `?scene&sound=off` and `?sounds` don't collide.
- `?map=<id>` · `?atlas` · `?terrain=off` · `?objects=off` · `?zoom=N` · `?speed=N` · `?center=x,y` ·
  `?pitch=N` — real decoded map / sprite atlas / ground-texture + map-object opt-outs / camera magnify /
  playback rate (seeds the INITIAL rate; the tool panel's game-speed button then drives it live in
  `?map=`/`?scene` — use `?speed=` for a sub-1× pace the discrete button can't reach) / centre the camera on
  tile `(x,y)` (an inspection knob for a decoded-map feature — a
  bridge, a coastline — the settler-centroid framing never reaches; malformed → default framing) / **set
  the cell-diamond width in px** (`?pitch`, the live master-scale knob — sprite-vs-terrain size; default the
  MEASURED 68, row step following the measured 38/68 ratio; `?pitchy=<cellDiamondHeight>` — the full
  diamond height, 2× the row step, measured 76 — overrides the height separately; `setTilePitch` in
  `iso.ts`). These compose with
  `?scene=`. The live view also mounts the top-left debug overlay (tick / speed / steps / entity counts +
  the FPS and sim/snap/draw CPU split), like `?scene=`.
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

An agent **cannot self-judge pixels** (root `AGENTS.md` "How to verify your work", point 5). An
*acceptance scene* is the seam: ONE deterministic setup with two consumers —

- **headless** (`test/scenes.test.ts`) proves the *mechanic* (the agent self-validates with `npm test`),
- **browser** (`?scene=<id>`) renders the SAME run with a checklist overlay so a *human* judges the pixels.

One NAMED divergence: the browser entry feeds the real extracted building footprints (sim-affecting —
collision, placement, doors) while the headless twin keeps the clean-room approximations (copyrighted
`content/` never enters tests). Keep scene placements comfortably legal under both; see
`scenes/runtime.ts` (`createSceneSim` doc) for the full contract.

To add one (full guide in [`docs/SCENES.md`](../../docs/SCENES.md)):

1. Write `src/scenes/<id>.ts` exporting a `SceneDefinition` — a `terrain` grid, a `build(sim)` that places
   the world, a human `checklist`, and machine `checks` (the mechanic the headless test asserts). Do not
   add scene-local content/rules; shared sandbox content lives in `src/game/sandbox/`.
2. Register it in `src/scenes/index.ts` (`SCENES`). That auto-adds its headless test AND its `?scene=` link.
3. `npm test` (mechanic green) → then surface `npm run dev` → `http://localhost:5173/?scene=<id>` and the
   checklist, and ask the user whether it looks right. Don't claim the visual is correct yourself.

Scene sims share `sim`'s **module-level component stores** (a known footgun), so `createSceneSim` resets
them on every build — don't bypass it (the headless harness builds many scene sims in one process).
