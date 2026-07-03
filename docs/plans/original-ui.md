# Original in-game UI — extraction & rebuild plan (agent prompts)

Goal: rebuild the original in-game HUD (left tool panel, settler order UI, bottom-right details
panel) from the **original assets**, extracted through the pipeline. Research basis (2026-07-03):
the HUD **art** ships ~100% in data files (one bob atlas + palettes + fonts + string tables, all
loose on disk); the HUD **layout** is hardcoded in `Game.exe`, but OpenVikings has the left panel
decompiled to literal pixel rects + sprite ids, so geometry is transcribable, not guessed.

**How to use:** run each prompt below, in order, in a fresh session (`/worktree`). Merge before
starting the next — later prompts consume earlier outputs. Prompts are self-contained; they also
tell the agent to re-verify facts against the sources (this doc is research output, not ground
truth). Check a box when the step is merged; delete this file when all steps land.

- [x] 1. Pipeline: GUI atlas + strings + cursors — landed: `stages/gui.ts` + `decoders/cursor.ts` (indexed+preview atlases, `256×N` palette LUT, `ingamegui` strings, `.cur`→PNG); app seam `content/gui-gfx.ts` + `/gui` route. See SOURCES.md "GUI".
- [ ] 2. Pipeline: `.fnt` bitmap-font decoder
- [ ] 3. GUI sprite map (interactive — user is the oracle)
- [ ] 4. App: left tool panel with original art
- [ ] 5. App: settler order UI with original art
- [ ] 6. App: bottom-right details panel with original art

Out of scope for this plan: the minimap (separate task) and the main menu. The frame-id map and
geometry constants are our own metadata (committable); decoded original bytes are not (`content/`
stays gitignored).

---

## Step 1 — pipeline

### Prompt 1: GUI atlas, strings, cursors

```text
Add a GUI extraction stage to the asset pipeline so the original in-game HUD art, UI strings, and
mouse cursors land in `content/` as atlases + manifests the app can consume.

Context (research findings — re-verify against the sources before coding; game root =
`../Cultures 8th Wonder` relative to the repo root, read-only):
- The whole in-game HUD art is one bob container: `Data/engine2d/bin/bobs/ls_gui_window.bmd`
  (~193 frames, magic 0x03F4): left tool-panel chrome + icons, contextual/order buttons, window
  frames/borders, progress/hit bars, minimap frame chrome. Per-language copies exist under
  `Data/gui/lang/{eng,ger,pol,rus}/bobs/` — they were byte-identical in research; verify (hash)
  and use the engine2d copy if so.
- Speech/thought bubbles: `Data/engine2d/bin/bobs/ls_gui_bubbles.bmd` (23 frames), palette
  `Data/engine2d/bin/palettes/gui/gui_bubbles.pcx`. Extract alongside.
- GUI bobs are 8-bit indexed; the engine colorizes each element at draw time with a palette from
  `Data/gui/palettes/*.pcx`. Those .pcx are 2x2 901-byte palette carriers, not images:
  `iconsleft` (left icon bar), `context` (order UI), `frame` (window frames),
  `bar_standart`/`bar_hitpoints`/`bar_disabled`, `bg_normal`/`bg_hilite`/`bg_invert`,
  `ingame_remap_01..03`, `papyrus` (font_* palettes are the font step's concern). Which palette
  pairs with which element: OpenVikings `Source/NC2GuiToolsBase/CGuiBaseDataManager.cs` (loads
  them all by name) and `Source/NC2InGameGuiManager/CGuiManager.cs` (usage).
- UI string tables: `Data/text/{eng,pol,...}/strings/ingamegui/*.cif` — 9 tables (main, misc,
  miscwindow, misclogic, messages, humanwindow, humanlistwindow, housewindow, vehiclewindow);
  format = CStringArray (0x3FD), already handled by `tools/asset-pipeline/src/decoders/cif.ts`.
  Plaintext reference copies: `Data/text/pol/strings/ingamegui/backup (errors)/*.ini`.
- Cursors: `DataX/Mouse/{MouseNormal,MousePressed,MouseRight}.cur` — standard Windows .cur
  (Chromium accepts .cur in CSS `cursor: url(...)`; emit PNG fallbacks too if cheap).
- Everything above ships as loose files — do NOT unpack `DataX/Libs/data0001.lib` (a packed
  mirror of the same tree). The culturesnation mod does not override the HUD.
- The 299x299 dialog backgrounds `Data/gui/bitmaps/bg*.pcx` already convert via the existing pcx
  stage; just reference them from the new manifest if the app will need them.

Deliverables:
1. A new `gui` stage in `tools/asset-pipeline/src/stages/` wired into `cli.ts`, following the
   existing patterns (`stages/bmd.ts`, `decoders/atlas.ts`, `stages/player-colors.ts`): emit an
   INDEXED atlas + the GUI palettes (so render can colorize at draw time, same mechanism as the
   player-colour LUT), plus an RGBA preview atlas colorized with a sensible default palette for
   human inspection, plus a JSON manifest (frame id -> rect/size/offset).
2. ingamegui strings -> per-language JSON in content/ (at least `eng` and `pol`).
3. Cursors copied (and/or PNG-decoded) into content/ + manifest entries.
4. Wire the new outputs into the app's graphics bindings (`resolveGraphicsBindings` seam) so they
   are loadable — no UI rendering yet; reachable from the `?atlas=` viewer if that's cheap.
5. Update `docs/SOURCES.md` with a GUI section (files, formats, stage outputs).

Verification:
- Unit tests with synthetic fixtures for the new stage (existing pipeline test patterns; never
  commit real game bytes — content/ stays gitignored).
- Run the real pipeline end-to-end:
  `npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content`
  and open the emitted preview atlas — frames must look like UI chrome, not noise; frame count
  ~193.
- `npm test` and `npm run check` green.

Guardrails: read-only outside this repo; follow `tools/asset-pipeline/CLAUDE.md` (validate
decoders against the OpenVikings oracle; take format facts, never its architecture).
```

### Prompt 2: `.fnt` bitmap-font decoder

```text
Add a `.fnt` bitmap-font decoder + pipeline stage so the original UI fonts are usable by the
renderer.

Context (re-verify against the sources before coding):
- Files: `Data/gui/fonts/{font08,font10,font12,fontdebug}.fnt` (+ `latin/` and `rus/` variants)
  under the game root `../Cultures 8th Wonder` (read-only).
- Format: storable id 0x03F5 (`CFont`) — a thin wrapper around the same bob container the `.bmd`
  decoder already parses (id 0x03F4, `CBobManager`; see `tools/asset-pipeline/src/decoders/bmd.ts`).
  Oracle: OpenVikings `Source/NXBasics/CFont.cs` (+ `XBStorable.cs` for the id/version envelope):
  glyph lookup is `bobId = charCode - 0x20`; space/tab map to bob 0x49.
- Font colors are palettes: `Data/gui/palettes/font_{white,dark,dimmed,red}.pcx` (901-byte
  palette carriers) — extract them with the fonts.
- `docs/SOURCES.md` lists `.fnt` (63 files) as known-but-undecoded — update the row.

Deliverables:
1. `tools/asset-pipeline/src/decoders/fnt.ts` reusing the bob-container parsing; a stage emitting
   a per-font glyph atlas (indexed + preview) and a metrics JSON (per-glyph advance/size/offset,
   line height; baseline if derivable).
2. Wire into `cli.ts` + the graphics bindings, mirroring the gui stage from the previous step.
3. `docs/SOURCES.md` row updated.

Verification:
- Synthetic-fixture unit tests; stable/deterministic output ordering.
- End-to-end pipeline run; then composite a sample line (e.g. "Wikingowie 0123") from the glyph
  atlas + metrics into a scratch PNG and open it — text must be legible in all four font colors
  and in the Polish glyph range (ĄąĆćĘꣳŃńÓ󌜯żŹź).
- `npm test` and `npm run check` green.
```

## Step 2 — sprite map

### Prompt 3: name the GUI atlas frames (interactive)

```text
Build the frame-id -> semantic-name map for the GUI atlas (from `ls_gui_window.bmd`, ~193 frames)
so app code references UI sprites by name — no magic frame numbers.

Context:
- The gui atlas + manifest are in `content/` (pipeline gui stage); regenerate via
  `npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content` if absent.
- OpenVikings gives ground truth for a subset: `Source/NC2InGameGuiManager/CGuiManager.cs`,
  method `Desktop_Open()` (~lines 703-819) plus the `MiscButtons_*_Update` methods, contains
  literal (rect, gfxId, command) triples for the left panel — e.g. panel background strip gfx
  0x33 at rect (0, 10, 50x433); tool buttons gfx 0x2a, 0x2d, ...; speed button gfx 0x31 with
  state variants 0x34/0x35/0x36; message-priority frame 0x3f + button 0x40 (variant 0x42). Read
  the whole file and harvest EVERY triple — transcribe them into the map with semantic names.
- The remaining frames are unknown -> the human is the oracle. Use the labeled-montage technique
  (see docs/lessons): never guess a visual fact silently.

Deliverables:
1. A script (scratchpad, or a small pipeline flag) rendering a NUMBERED montage of all atlas
   frames: grid layout, large readable index labels, a sensible palette, 2x scale — one or more
   PNGs.
2. A checked-in, typed map (our own metadata — committable): frame index -> { name, role,
   palette, states }, with exported named constants so app code never hardcodes an index. Place
   it where the app's graphics bindings live (or `packages/data` if it validates better there).
   Unknown frames are named `unknown_NNN`.
3. Provenance notes in the map file header (or the SOURCES.md GUI section): which entries are
   pinned to OpenVikings code vs human-identified vs unknown.

Process: harvest the OpenVikings ids FIRST, then generate the montage, open it for the user,
present best guesses for the remaining frames grouped by visual similarity, and STOP — ask the
user to confirm/correct. Iterate until the frames that matter (left panel, order UI, window
frames, bars) are named. Do not guess silently.

Verification: a unit test that the map is total over the atlas (every frame named or
`unknown_NNN`, no duplicate names); `npm test` + `npm run check` green.
```

## Step 3 — app UI layer
[IN PROGRESS]
### Prompt 4: left tool panel

```text
Rebuild the original LEFT tool panel (building menu, game speed, statistics/help buttons) in the
app using the extracted GUI atlas, fonts, and the OpenVikings-pinned geometry.

Context:
- Inputs from earlier steps (all in content/ via the pipeline): gui atlas + named frame map +
  .fnt fonts + ingamegui strings (pol/eng).
- Geometry ground truth: OpenVikings `Source/NC2InGameGuiManager/CGuiManager.cs` `Desktop_Open()`
  — literal pixel rects for the panel strip and each button. Transcribe them as named constants
  (hex -> decimal). Button behavior refs: `MiscButtons_SpeedButton_Update` (state gfx swap),
  `MiscButtons_MessagePriorityButton_Update`.
- Strings: building-menu categories ("Wszystko/Praca/Magazyn/Dom/Wojsko"), "Prędkość Gry",
  "Statystyki" are in the ingamegui string JSONs.
- Original design resolution is 640x480-1024x768; our canvas is arbitrary. Decision to implement:
  integer UI scaling (default 2x, URL flag override, e.g. `?uiscale=1|2|3`), panel anchored
  top-left. Log the scaling as a conscious deviation in docs/FIDELITY.md; the panel's INTERNAL
  geometry stays pinned to the original rects.
- Rendering approach: inspect the existing overlay/panel code first
  (`packages/app/src/view/overlay.ts`, `packages/render/src/gpu/hud-layer.ts`, and
  `packages/app/src/view/unit-panel.ts` if merged). Recommended: a retained Pixi screen-space HUD
  layer using the indexed atlas + palette colorizing (the PalettedSprite/LUT mechanism from
  player colors) — bitmap fonts and palette remaps are native there; DOM stays for dev-only
  overlays. If you find a strong reason to diverge, record it in the commit message.
- Input routing: the HUD must claim pointer events before world picking. Today separation is by
  mouse button + DOM stacking. Introduce an explicit hit-test: cursor over a HUD rect -> the
  click goes to the HUD, never to the world.

Scope (v1):
1. Panel background strip + tool buttons with original art; hover/pressed states where the atlas
   provides them.
2. Working game-speed button: cycles the original speed states (the gfx 0x31/0x34/0x35/0x36
   family per the frame map) and drives the app's tick-rate control. Speed is an app concern —
   the sim tick stays fixed-step; wire to the existing speed mechanism if present, else add one
   app-side.
3. Building menu: opens a framed window (frame sprites + bg*.pcx background) listing buildings
   from content by category, original category strings, .fnt font; clicking a building enters the
   existing place-building flow (`placeBuilding` command) if present on main, else stub the
   selection callback and track the gap in ROADMAP/TECH-DEBT.
4. Statistics/help buttons: v1 = open a framed window showing the existing HUD read-view data
   (`packages/render/src/data/hud.ts`) in the original font; the full original stats windows are
   follow-up — track in ROADMAP.
5. Minimap: OUT OF SCOPE (separate task); leave its screen region alone.

Verification (player-visible mechanic -> acceptance scene, per CLAUDE.md):
- Add/extend an acceptance scene under `packages/app/src/scenes/` (register in scenes/index.ts):
  headless half proves buttons hit-test, the speed control changes tick rate, the menu opens and
  issues/stubs placeBuilding — green in `packages/app/test/scenes.test.ts`.
- `npm test` + `npm run check` green.
- End by surfacing `npm run dev` -> the scene URL + a visual checklist (panel art crisp at 2x,
  correct palette colors, hover states, Polish strings render) and ask for human sign-off.
  Record in docs/FIDELITY.md what is pinned (rects, sprite ids) vs approximated.
```

### Prompt 5: settler order UI

```text
Rebuild the settler order/action UI (the contextual buttons over a selected settler — change
profession etc.) with original art, replacing the placeholder actions card.

Context:
- Depends on: gui atlas + frame map + fonts + strings (previous steps) AND the unit
  selection/orders work from `feat/unit-orders` (`packages/app/src/view/unit-controls.ts`,
  `unit-panel.ts`, `setJob`/`moveUnit` commands). If that branch is not yet on main, STOP and
  coordinate with the user before proceeding.
- Original behavior (OpenVikings `Source/NC2InGameGuiManager/CGuiManager.cs`,
  `Selection_UpdateWindows()` + `BuildHumanActionButtons` / `BuildVehicleActionButtons` /
  `BuildHouseActionButtons`): selecting 1-2 humans -> RADIAL graphic buttons grouped by
  group-type; vehicles/houses -> vertical text buttons. The exact radial geometry lives in
  `l_Selection_ActionButtons_BringUp`, which is a TODO stub in OpenVikings — the precise layout
  is NOT recoverable from code. Approximate it (a radial ring around the selected settler,
  original button sprites, `context` palette) and record the approximation in docs/FIDELITY.md
  as "pending calibration against the original game".
- Strings: `ingameguihumanwindow` / `ingameguimisc` JSONs. Keep the existing Space-toggle and
  right-click-move semantics (player move-order stays a soft timed override — see the orders
  system).

Scope:
1. Replace the placeholder "Zmień zawód" DOM card with original-art contextual buttons
   (profession icons from the frame map; for icons the map leaves unknown, confirm with the user
   via a quick numbered montage rather than guessing).
2. Command flow unchanged: buttons issue `setJob` etc. through the existing command queue; UI
   stays view-side, no sim reach-in.
3. Multi-human selection: follow the 1-2-humans-radial / group-type rule as far as the data
   allows; document divergences in FIDELITY.md.

Verification: extend the unit-orders acceptance scene — headless half proves the buttons issue
the right commands; `npm test` + `npm run check` green; end with the dev-server URL + visual
checklist + FIDELITY.md updated; ask for human sign-off.
```

### Prompt 6: bottom-right details panel

```text
Rebuild the bottom-right details panel (settler info, multi-selection count, building inventory)
with original window art, replacing the placeholder DOM card.

Context:
- Depends on: gui atlas + frame map + fonts + strings (previous steps) and the existing panel
  logic in `packages/app/src/view/unit-panel.ts` (INFO card: settler need bars, carry, status;
  building: level, build %, warehouse contents "Magazyn", demolish button). This is a re-skin +
  layout pass, not a logic change — keep live per-tick updates, demolish, multi-select count.
- Original ground truth is thin here: the per-type windows exist in the engine
  (`CSelectionSingleHumanWindow`, `CSelectionHouseWindow`, `CSelectionHumanListWindow`, ...) but
  are named-only in OpenVikings, not ported — no geometry available. Compose the panel from the
  extracted window-frame/border sprites (`frame` palette) and bar sprites
  (`bar_standart`/`bar_hitpoints`/`bar_disabled`), with original strings (`ingameguihousewindow`,
  `ingameguihumanlistwindow`, `ingameguihumanwindow`); the geometry is approximated — log in
  docs/FIDELITY.md as pending calibration against the original game.

Scope:
1. Framed original-art window anchored bottom-right; the four need bars (hunger / fatigue /
   piety / enjoyment) as original bar sprites; text in the .fnt font with the font palettes.
2. Building view: inventory with good icons if the frame map names any (else text), a
   build-progress bar, and a demolish button in original button chrome.
3. Reuse the HUD hit-test/input routing introduced with the left panel.

Verification: extend the acceptance scene (headless: the panel model reflects selection and
building state); `npm test` + `npm run check` green; dev URL + visual checklist; FIDELITY.md
updated; ask for human sign-off.
```
