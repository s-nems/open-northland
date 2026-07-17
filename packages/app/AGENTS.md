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

## Diagnostics toolbox (agents: debug with this, not ad-hoc prints)

`src/diag/` is the diagnostics backbone — the logger, the crash capture, the report bundle, and the
perf instrumentation live there:

- **Logging:** `diag.warn('channel', msg, data?)` (never raw `console.*` in app src). Everything
  lands in a bounded ring that ships in the diagnostics bundle — system menu → "Download diagnostics
  report", auto-offered by the crash banner.
- **The bundle is a full session repro:** rebuild the world its `entry`+`worldId` name, drop the
  rebuilt sim's pending setup enqueues, then `stepReplaying(sim, game.commandLog, game.tick)` — the
  exact procedure is pinned in `test/diag-bundle.test.ts`.
- **`?debug=perf`** — per-system `performance.measure` slices (`sim/<system>`, `frame/*`). Headless
  agents read them without a human DevTools session: drive the page (Playwright) and collect via
  `new PerformanceObserver(...).observe({entryTypes: ['measure']})`.
- **`?debug=trace`** — a bounded Trace Event ring (~30 s), exported from the system menu; opens in
  Perfetto. Also attaches to the bundle.
- **`?debug=diag`** — state hashes every 20 ticks (`HashTrace`) for divergence localization
  (`localizeDivergence`). Note `?debug=` is single-valued: perf/trace/diag/geometry are exclusive.

## Package layout

`src/` is grouped by concern (not flat) so each thing has ONE obvious home — add new code to the folder
that matches its role instead of piling another method onto a growing file:

- **`main.ts`** — the thin URL dispatcher. Reads `window.location.search`, picks ONE entry, hands off. No
  wiring lives here; it only routes.
- **`entries/`** — one module per URL entry (the "modes"): `menu.ts` + `menu/` (the default landing,
  backed by the semantic template in `index.html` and a normal CSS stylesheet), `map.ts`
  (`?map=`), `scene.ts` (`?scene=`), `anim.ts` (+ `anim-cells.ts` pure builders + `anim-overlay.ts`
  panel), `sound.ts` (`?sounds`), `shot.ts` (`?shot`). An entry assembles its world (terrain, sim, renderer,
  starting camera); the two playable entries then hand off to the shared `view/runtime/game-view.ts` runtime.
- **`content/`** — the decoded-content bindings (the gitignored-`content/` I/O boundary; mostly →
  render, plus one → sim): `net.ts` (the shared fetch/degrade helpers), `ir.ts` (the ONE memoized
  `ir.json` fetch + the `ContentIr` view + atlas loading), the `building-gfx/` package (per-render-aspect
  bob-binding reducers: `families.ts` base bobs + families, `overlays.ts` working overlays,
  `construction.ts` stages) + the `resource-gfx/` package (`refs.ts` gathering resolution, `bindings.ts`
  node/pile bindings, `stump.ts`, `berry-bush.ts`) + `settler-gfx/` (the pure per-type/per-character
  bob-binding reducers, unit-tested), `sprite-sheet.ts` (assembles the
  `SpriteSheet` + `resolveSpriteSheet`), `terrain.ts`, `objects.ts`, `collision.ts` (the decoded-map →
  SIM join: ground classes + object block areas → the semantic collision grid), `gui-gfx.ts`/
  `gui-art.ts`/`gui-atlas-map.ts` + `font-gfx.ts` (the GUI/font art bindings), `audio.ts`.
- **`catalog/`** — committed hand-authored data catalogs (English naming over the original's typeIds):
  `buildings.ts` (the 41 viking buildings), `roster.ts` (the character roster), `atomics.ts` (the harvest
  atomic ids), `felling.ts`/`mining.ts` (gathering pins).
- **`game/`** — the GLOBAL game content + rules shared by every mode: `rules.ts` (player/tribe constants
  — `HUMAN_PLAYER`, `ENEMY_PLAYER`, `PRIMARY_TRIBE`, `HUD_TRIBE`), `snapshot.ts` (typed snapshot readers
  shared by the view controls and the HUD panels), and the `sandbox/` package — `ids/`
  (semantic type ids, grouped economy ids, weapons, buildings, and the `GATHERERS` table), `content/`
  (the one `sandboxContent()` `ContentSet` assembler plus its catalog fragments) and the per-concern
  tables it assembles from — `combat.ts` (weapons + swing timings),
  `work-animations.ts` (non-combat work-animation timings), `landscape.ts` (terrain/resource landscape
  derivation), `building-set.ts` (building store/recipe set), `worker-slots.ts` (the extracted
  worker/carrier slot table + its trade names) and `construction.ts` (the build-cost + hitpoint tables),
  `place.ts` (the place/spawn helpers), `index.ts` (the barrel). Scenes and the vertical slice consume
  this; they do NOT define their own content.
- **`hud/`** — the in-game HUD: `geometry.ts` (the shared `Rect`/`contains`), `chrome.ts`
  (parchment window chrome + highlight theme), `ui-text.ts` (the shared vector-serif `makeUiTextRun`
  factory — the HUD default text face), `bitmap-text.ts` (the `.fnt` glyph runs + the `makeTextRun`
  factory — retained for exact-decoded-face needs, but not the current default),
  `action-ring-layout.ts` (the settler action-menu geometry), the `tool-panel/` package —
  pure models (`layout.ts`, `building-menu.ts`, `goods-menu.ts`, `game-speed.ts`, headlessly unit-tested)
  + window controllers (`menu-window.ts`, `goods-window.ts`, `stats-window.ts`, `placement.ts` over the
  shared `context.ts`, the first three on the shared `window-shell.ts` open/close lifecycle) +
  `index.ts` (the mount + input routing) — and the `details-panel/` package (the bottom-right selection
  panel in original art: pure `model/` (bars/context/settler/building split) + `layout/` (per-kind
  geometry: `shared.ts` primitives, `building.ts`, `settler.ts`), `chrome.ts`/`gauge.ts` + `sections/`
  (per-kind drawing: the `building/` section subfolder, `settler.ts`, `compact.ts`), `panel.ts`
  mount). Text: both the tool-panel and details-panel HUD draw the bundled vector serif
  (`content/ui-font.ts`) — the tool-panel via `ui-text.ts`'s `makeUiTextRun`, the details-panel from
  `content/ui-font.ts` directly — an intentional, named legibility approximation that rasters crisp at
  the HUD's fractional UI scale where a small indexed bitmap glyph reads blocky; the decoded `.fnt`
  bitmap path (`bitmap-text.ts`) stays available for anything that must be the exact original face. The
  hud layer never imports `view/` — view glue (e.g. `backingScale`) is injected via options.
- **`view/`** — browser-view helpers, grouped by concern:
  - **`runtime/`** — the in-game loop: `game-view.ts` (the SHARED runtime — the one-time HUD mount),
    `frame-loop.ts` (the per-frame fixed-timestep RAF loop both playable entries run on, over an explicit
    `FrameLoopDeps` context), `game-presentation.ts` (one-time game/HUD presentation mount),
    `raf-loop.ts`, `pointer-tracker.ts`.
  - **`unit-controls/`** — the RTS select-and-command feature: `index.ts` (input controller) +
    `orders.ts`/`marquee.ts`/`types.ts`, plus `settler-actions.ts` (the action-ring menu),
    `action-ring-visuals.ts`, `profession-picker.ts`, `unit-targets.ts`, `formation.ts`.
  - **`projections/`** — pure snapshot → render/HUD projections (`index.ts` barrel):
    `snapshot-projections.ts` (identity-memoized HUD projections), `door-badges.ts`,
    `building-points.ts`, `geometry-debug-items.ts`, `fog-gates.ts`, `hud-labels.ts`. The selection
    details panel itself lives in `hud/details-panel/`.
  - **`admin-debug/`** — the `?debug=admin` entity picker + overlay.
  - Shared leaves: `camera.ts` (pure pan/zoom math + the DOM controller), `picking.ts` (screen↔world
    hit-testing math), `params.ts` (URL-param parsing), `overlay.ts` (shared panel + full-page chrome —
    `el`/`navButton`/`pageSection`/styles), `game-tool-panel.ts`, `perf-overlay.ts`, `system-menu.ts`,
    `tooltip.ts`, `ground-pile-tooltip.ts`, `placement-overlay.ts`, `scene-overlay.ts`,
    `boot-progress.ts` (the loading card the two playable entries show while they assemble a world —
    each reports its own ordered step list; the galleries and `?shot` do not mount it).
- **`slice/`** — the demo scenario the live + shot entries share: `vertical-slice.ts` (`runSlice` /
  `runAuthoredSlice` over the global `game/` content), `map-loader.ts` (the decoded-map fetch),
  `authored-placements.ts` (the pure authored-entity join).
- **`scenes/`** — the acceptance-scene system (see below) + `sandbox-queries.ts` (the scene-check world
  queries).

Outside `src/`: **`bench/`** — the sim's per-system benchmark (`npm run bench:sim`; docs/TESTING.md).
Node-only and on-demand, like `test/`: it is outside the tsconfig build, and nothing but its own
`vitest.config.ts` collects it. Its world is built from the acceptance scenes' builders — extend those
rather than growing a second world-builder here.

## URL-flag entries

The app dispatches on `window.location.search` (see `main.ts`, a thin router into `entries/`). **With no
flag the default is the main menu** (`entries/menu.ts`): scenes and decoded maps are selected from the
left list, while the right panel shows their preview, localized description, game settings, and Start
button. The compact tools list opens the animation, sound, and sprite galleries. Each entry degrades to
a reproducible default so the committed build + the `npm run shot` PNG never depend on gitignored bytes:

- `?map=<id>` — the **decoded-map viewer** (`entries/map.ts`): draws a real `content/maps/<id>.json` grid
  driven by the vertical-slice sim on the fixed-timestep loop, drawn every frame. The menu's "Mapy" section
  links here per decoded map. Mounts the LEFT tool panel (below); falls back to the synthetic grass strip
  when the map is absent (gitignored), so a bare checkout still boots.
- `?shot[&seed&ticks&hud]` — headless deterministic screenshot entry (`entries/shot.ts`).
- `?scene=<id>` — run a registered **acceptance scene** (`entries/scene.ts`). Its localized title and
  short description are shown on the main menu; the scene itself contains only the standard game HUD.
- **LEFT tool panel** — the original toolbar strip + tool buttons + game-speed button + building/stats windows
  is part of the standard game HUD, mounted over BOTH `?map=` and every `?scene=` via the shared
  `view/game-tool-panel.ts` (NOT a per-scene flag — it is global). Its game-speed button drives the tick
  rate live (clicks cycle ×1 → ×2 → ×3 → ×1; the `P` key toggles pause, remembering the running speed and
  washing the world sepia while paused); `?speed=` still seeds the initial rate (and reaches sub-1× the
  button can't).
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
- `?sound=off` — skip building the audio pipeline (`@open-northland/audio`) entirely. In live + scene modes the
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
- `?lang=pol|eng` · `?uiscale=N` · `?speed=N` · `?fog=off|reveal|recon` · `?debug=geometry` are the
  player-facing settings carried by the main menu into scenes and maps. The language lives in the menu's
  corner; the other settings live beside the selected world. Fog is map-revealed, classic sticky exploration,
  or known-terrain recon; the menu defaults new worlds to classic. `?center=x,y` remains a direct map inspection
  aid for centring a bridge, coastline, or another decoded feature.
  Normal map and scene play always attempts to load decoded sprites, terrain textures, and landscape
  objects at the calibrated projection; a checkout without them degrades to hand-authored markers and flat
  ground. Renderer opt-outs are not player settings. Gallery-specific controls remain scoped to their
  entries (`?anim&zoom=`, `?icons&atlas=`, and the deterministic `?shot` verification flags).
  `?map=<id>` is a real-content human-validation entry, NOT a `SceneDefinition`; its headless counterpart
  cannot depend on copyrighted map data.

## Acceptance scenes — let a human sign off a mechanic

An agent **cannot self-judge pixels** (root `AGENTS.md` "How to verify your work", point 5). An
*acceptance scene* is the seam: ONE deterministic setup with two consumers —

- **headless** (`test/scenes.test.ts`) proves the *mechanic* (the agent self-validates with `npm test`),
- **browser** (`?scene=<id>`) renders the SAME run so a *human* judges the pixels.

One NAMED divergence: the browser entry feeds the real extracted building footprints (sim-affecting —
collision, placement, doors) while the headless twin keeps the hand-authored approximations (copyrighted
`content/` never enters tests). Keep scene placements comfortably legal under both; see
`scenes/runtime.ts` (`createSceneSim` doc) for the full contract.

To add one (full guide in [`docs/SCENES.md`](../../docs/SCENES.md)):

1. Write `src/scenes/<id>.ts` exporting a `SceneDefinition` — a `terrain` grid, a `build(sim)` that places
   the world, and machine `checks` (the mechanic the headless test asserts). Add its localized title and
   short summary to both catalogs. Do not add scene-local content/rules; shared sandbox content lives in
   `src/game/sandbox/`.
2. Register it in `src/scenes/index.ts` (`SCENES`). That auto-adds its headless test AND its `?scene=` link.
3. `npm test` (mechanic green) → then surface `npm run dev` → `http://localhost:5173/?scene=<id>` with
   concise verification notes, and ask the user whether it looks right. Don't claim visual correctness.

Each scene sim owns its component stores (`new Simulation()` is a complete reset), so the headless harness
builds many scene sims in one process with no isolation ritual. Use `createSceneSim` for its scene defaults
(needs-off, fog), not for store clearing.
