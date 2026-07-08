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
  globally over `?map=` + every `?scene=` (strip, tool buttons, game-speed, building/stats
  windows, `?uiscale=`). See packages/app/AGENTS.md.
- [x] 5. App: settler order UI with original art — landed: `hud/action-ring-layout.ts` (arm footprint transcribed from OpenVikings `BuildHumanActionButtons`) + `view/settler-actions.ts` (Pixi menu of `order_*` buttons, `context` palette, pixel-snapped) replacing the DOM actions card. Renders the **whole default human menu** (four arms) in original art, opened by **Space or right-click on the unit**; on this slice only "change profession" is wired (opens a simple profession picker → `setJob`, info card reflects it live), the rest are inert placeholders for a future "implement the action" pass (warrior/scout variants noted). See plan progress note "Settler action menu".
- [ ] 6. App: bottom-right details panel with original art

Progress note — UI polish pass over landed steps 4+5 (2026-07-08, `feat/ui-polish`, user-requested,
not a numbered step): (a) the settler action ring draws at 75% of the shared uiscale
(`ACTION_RING_UI_FACTOR`, deliberate deviation from the original's 1:1 size — it crowded the
settler); (b) interactive entries render at device resolution (`createWindowPixiApp`
resolution=devicePixelRatio; `?shot` stays at 1 for determinism) and the HUD bakes oversample at
DOUBLE the device coverage (`oversampleFor`, downscale ratio pinned to (1,2]) so palette edges
resolve anti-aliased instead of nearest-hard on HiDPI; (c) the speed button cycles running speeds only (×1→×2→×3→×1), `P` toggles pause
(remembers speed), and pausing washes the world with a multiply sepia quad — an eyeballed
approximation of the original's brown paused map (observed behaviour). Verified: unit tests for the
new speed control + ring scale, Playwright pass at DPR 2 (cycle glyphs, pause wash on/off, ring
size, selection/picking). Visual sign-off: user.

Out of scope for this plan: the minimap (separate task) and the main menu. The frame-id map and
geometry constants are our own metadata (committable); decoded original bytes are not (`content/`
stays gitignored).

---

## Step 3 — GUI sprite map: confirm the montage-guessed frames (interactive)

```text
Finish the GUI frame map interactively. The typed map itself already landed —
packages/app/src/content/gui-atlas-map.ts (OpenVikings-pinned entries + montage best guesses,
per-entry provenance, totality enforced by packages/app/test/gui-atlas-map.test.ts) — so do NOT
rebuild it. What remains is the HUMAN pass over the montage-guessed and unknown frames: the round
order-command icons (~0x48–0x88 — step 5's action ring consumes them), window 9-slice pieces,
bars, arrows, and every `unknown_NNN` placeholder.

Process: regenerate content/ if absent (npm run pipeline -- --game "../Cultures 8th Wonder"
--mod DataCnmd --out content); render a NUMBERED montage of all 193 ls_gui_window frames (grid,
large readable index labels, a sensible palette, 2x scale); present best guesses grouped by
visual similarity and STOP — the user confirms/corrects (the labeled-montage technique; never
silently guess a visual fact). Apply the answers: rename confirmed frames, promote their `source`
per the map's provenance convention, keep the totality test green.

Verification: `npm test` + `npm run check` green; provenance notes in the map header updated.
```

## Step 6 — app: bottom-right details panel

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
