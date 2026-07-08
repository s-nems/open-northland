# Original in-game UI — extraction & rebuild plan (agent prompts)

Goal: rebuild the original in-game HUD (left tool panel, settler order UI, bottom-right details
panel) from the **original assets**, extracted through the pipeline. Research basis (2026-07-03):
the HUD **art** ships ~100% in data files (one bob atlas + palettes + fonts + string tables, all
loose on disk); the HUD **layout** is hardcoded in `Game.exe`, but OpenVikings has the left panel
decompiled to literal pixel rects + sprite ids, so geometry is transcribable, not guessed.

**How to use:** run each prompt below, in order, in a fresh session (`/worktree`). Merge before
starting the next — later prompts consume earlier outputs. Prompts are self-contained; they also
tell the agent to re-verify facts against the sources (this doc is research output, not ground
truth). When a step merges, tick its box and delete its prompt block
(the checkbox line and progress note carry the state; git history keeps the prompt). Delete this
file when all steps land.

- [x] 1. Pipeline: GUI atlas + strings + cursors — landed: `stages/gui.ts` + `decoders/cursor.ts` (indexed+preview atlases, `256×N` palette LUT, `ingamegui` strings, `.cur`→PNG); app seam `content/gui-gfx.ts` + `/gui` route. See SOURCES.md "GUI".
- [x] 2. Pipeline: `.fnt` bitmap-font decoder — landed: `decoders/fnt.ts` + `stages/fonts.ts`
  (glyph atlases + metrics + font-colour LUT). See SOURCES.md "UI fonts".
- [ ] 3. GUI sprite map (interactive — user is the oracle) — the map itself landed
  (`packages/app/src/content/gui-atlas-map.ts`: OpenVikings-pinned ids + montage guesses);
  STILL OPEN: the human confirmation pass over the `unknown_NNN`/order-icon frames.
- [x] 4. App: left tool panel with original art — landed: `view/game-tool-panel.ts`, mounted
  globally over `?live` + every `?scene=` (strip, tool buttons, game-speed, building/stats
  windows, `?uiscale=`). See packages/app/AGENTS.md.
- [x] 5. App: settler order UI with original art — landed: `hud/action-ring-layout.ts` (arm footprint transcribed from OpenVikings `BuildHumanActionButtons`) + `view/settler-actions.ts` (Pixi menu of `order_*` buttons, `context` palette, pixel-snapped) replacing the DOM actions card. Renders the **whole default human menu** (four arms) in original art, opened by **Space or right-click on the unit**; on this slice only "change profession" is wired (opens a simple profession picker → `setJob`, info card reflects it live), the rest are inert placeholders for a future "implement the action" pass (warrior/scout variants noted). See plan progress note "Settler action menu".
- [ ] 6. App: bottom-right details panel with original art

Out of scope for this plan: the minimap (separate task) and the main menu. The frame-id map and
geometry constants are our own metadata (committable); decoded original bytes are not (`content/`
stays gitignored).

---

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
  (see AGENTS.md): never guess a visual fact silently.

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
  plan progress note as pending calibration against the original game.

Scope:
1. Framed original-art window anchored bottom-right; the four need bars (hunger / fatigue /
   piety / enjoyment) as original bar sprites; text in the .fnt font with the font palettes.
2. Building view: inventory with good icons if the frame map names any (else text), a
   build-progress bar, and a demolish button in original button chrome.
3. Reuse the HUD hit-test/input routing introduced with the left panel.

Verification: extend the acceptance scene (headless: the panel model reflects selection and
building state); `npm test` + `npm run check` green; dev URL + visual checklist; plan progress note
updated; ask for human sign-off.
```
