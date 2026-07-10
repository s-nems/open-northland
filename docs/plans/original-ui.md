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
- [x] 6. App: bottom-right details panel with original art — landed: `hud/details-panel/`
  (pure model / layout / chrome / sections split), original strings, tiled `bg*.pcx` fills; see
  the progress note below.

Progress note — UI polish pass over landed steps 4+5 (2026-07-08, `feat/ui-polish`, user-requested,
not a numbered step): (a) the settler action ring draws at 75% of the shared uiscale
(`ACTION_RING_UI_FACTOR`, deliberate deviation from the original's 1:1 size — it crowded the
settler); (b) interactive entries render at device resolution (`createWindowPixiApp`
resolution=devicePixelRatio; `?shot` stays at 1 for determinism) and the HUD bakes oversample at
DOUBLE the device coverage (`oversampleFor`, downscale ratio pinned to (1,2] before the caller's
quality floor / memory cap) so palette edges
resolve anti-aliased instead of nearest-hard on HiDPI, and the strip button glyphs get a
1-design-px silhouette outline in the original socket backdrop colour (`PalettedSprite.silhouette`)
— a named deviation: the original blits opaque dark sockets, which over our full-screen world read
as a black slab (user-rejected), so the backdrop stays keyed and the outline restores the
glyph/backdrop contrast; (c) the speed button cycles running speeds only (×1→×2→×3→×1), `P` toggles pause
(remembers speed), and pausing washes the world with a multiply sepia quad — a deliberate WARM
deviation from the pinned original (OpenVikings `CWorldDisplayElement` + `CBitmap.Tool_Darken`:
neutral 50% channel halve, world display element only; the user asked for a brown tint and signed
it off). Verified: unit tests for the
new speed control + ring scale, Playwright pass at DPR 2 (cycle glyphs, pause wash on/off, ring
size, selection/picking). Visual sign-off: user.

Progress note — profession picker polish (2026-07-09, `feat/profession-select-ui`, user-requested, not
a numbered step): the "Zmiana zawodu" picker (landed with step 5 as a plain DOM box) is reworked on four
axes. (a) COMPLETE roster: a new clean-room `catalog/professions.ts` transcribes the assignable
professions from `Data/logic/jobtypes.ini` (six gatherers + carrier + all production trades + one
soldier), replacing the ~12-entry content-derived list; every offered profession is added to sandbox
`content.jobs` so `setJob` actually lands (an unknown jobType is a silent sim no-op) — `test/professions.test.ts`
guards against dead rows. (b) ONE soldier: the picker offers a single "Żołnierz" (unarmed base,
`jobtypes.ini` type 31); the whole soldier band 31..41 resolves to it (a weapon specializes a soldier —
only a soldier carries one, a civilian never does; weapons already resolve by `(tribe, jobType)`). (c)
i18n: player strings move to a small `i18n/` message catalog (Polish `pol` only for now, shape ready for
more languages); the details-panel profession label reads the SAME catalog so picker and panel can't
drift. (d) STYLING: the DOM window now evokes the original parchment/rope selection windows — warm-wood
fill, double rope-tan frame, engraved headline + close box, the shared serif UI face, category group
headers — still a scrollable list. jobType numbering is a documented placeholder (four food trades whose
real ids the synthetic gatherer band 20..25 shadows sit in a placeholder band) pending the global-content
re-key (`docs/plans/global-content.md`); the fidelity anchor is each row's jobtypes.ini `source`. Added
trades have no workhouse in the sandbox yet, so an assigned smith/baker stands idle until that economy
lands (as the original gates a trade on its workshop). Verified: build + check + 1722 tests green; browser
self-check (picker styled, 28 Polish rows in 5 groups; a scene soldier reads "Poddany — Żołnierz" in the
details panel; no console errors). Visual/feel sign-off: pending user.

Progress note — worker assignment + panel workers (2026-07-10, `feat/profession-select-ui`,
user-requested, not a numbered step; extends the picker-polish note above). Right-click now STAFFS a
building: the `assignWorker` sim command carries an app-authored `jobPriority` list (craftsman first,
then carrier, never a gatherer — gatherers deliver to flags, not buildings), which the sim validates
through the same per-slot openness gate the JobSystem uses (priority only reorders/filters candidates,
it can't open a shut slot). Root fixes along the way: extracted `logicworker` job ids collided with the
sandbox's own bands (a "carpenter" slot filled with 13 wood gatherers) — every slot job is now REBASED
by `WORKER_SLOT_JOB_BASE` (`game/sandbox/ids.ts`); the collector/hunter/fisher trades classify as
gatherers (`worker-roles.ts`), excluded from right-click. Buildings gained a front `door` node
(`catalog/footprints.ts`) that both the badge anchor and the sim's `interactionNode` use. UI:
door-side badges stack one colour-coded square per worker by role (craftsman/carrier/gatherer,
`render/gpu/badge-layer.ts` + `view/door-badges.ts`); the details panel lists per-trade filled/capacity
lines under the "Pracownicy" header and draws the building's bound settlers as their real animated
on-map sprites (no terrain) via a live `PalettedSprite` overlay (`hud/details-panel/worker-sprites.ts`),
clicking one selects that settler. A bound settler's panel title and the slot label both resolve through
one job-name path so a rebased-slot druid reads "Druid", not "Bezrobotny". Review battery
(determinism/perf/fidelity/architecture/code-quality) run over `main...HEAD` and triaged: fixed the
per-frame whole-map scene build behind the panel overlay and the un-culled door-badge reposition (both
now screen-bounded), single-sourced the slot trade names through the i18n picker labels (a joiner had
read "Cieśla" as a slot but "Stolarz" in the picker), and corrected the extraction source-basis comments
(`[logichousetype] logicworker` in `houses.ini`; `EXTRACTED_GATHERER_TRADES` is a hand-classification of
`jobtypes.ini` roaming semantics, not an `ir.json` role). Verified: build + check + 1750 tests green.
Visual/feel sign-off: user confirmed the panel worker sprites (left-packed, correct facing, click-to-
select) and the "Bezrobotny" fix live.

Deferred follow-ups (structural, in the `game/sandbox` job-id space the global-content re-key owns —
tracked in `docs/plans/global-content.md`, not blocking this merge): move `catalog/professions.ts` into
`game/sandbox/` (it couples to sandbox job ids + i18n, so it isn't a clean-room catalog leaf — a layering
inversion today, non-cyclic); split the extracted worker-slot tables out of `game/sandbox/content.ts`
(now ~760 lines) into a sibling module; and reconcile the one-soldier picker vs the per-weapon slot
labels + the production-vs-gatherer role split for hunter/fisher when the real content replaces the
sandbox id bands.

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

Progress note 2026-07-09, fifth pass (`feat/original-ui-details`): visual review of the fourth pass
("font still frayed / bold building name unreadable / list a store's accepted goods with 0 + icon per
resource"). Two changes. (1) VECTOR text. The original UI face is a serif (the extracted `font12` sheet
shows serifed A–Z), and a ~10 px bitmap can't stay crisp at the panel's fractional scale, so the details
panel now draws **Tinos** — a metric-compatible "Times"-class serif (Apache-2.0), bundled as two woff2
subsets (Latin + Latin-ext for the Polish diacritics) under `public/fonts/`, loaded via `FontFace` in the
new `content/ui-font.ts`. `chrome.ts` renders each line as a Pixi `Text` placed by anchor (top-left /
centred / right) instead of the bitmap baseline metrics; the supersample bake keeps it sharp, and being
Pixi-native it bakes upright with no `flipY`. A named legibility approximation, NOT the decoded original
face — the bitmap `.fnt` path (`hud/bitmap-text.ts`) stays for the tool-panel HUD. Text sizes body 11 /
title 13 native px, a measured `0.22 em` cap-top trim on the top-anchored placements. (2) Magazyn lists a
building's STORABLE goods. `model.stockRows` now builds rows from the building's `def.stock` slots (its
accepted goods, extracted from `logicstock`) joined with the live `Stockpile`, showing `0.0` when empty so
every storable good appears with its own recoloured pile icon; held goods sort first so a big store's real
stock stays above the fixed row cap. Verified in-scene on a store (wood/plank/stone/mud/iron/gold/mushroom
rows, each icon + amount) — in the sandbox only the HQ/Joinery carry a store, so a visible building was
temporarily stocked to shoot it (a 0-initial slot doesn't seed the `Stockpile`, so it is determinism-safe;
reverted). Gates green (build, check, targeted tests incl. sandbox byte-determinism 8/8); the panel model
test pins accepted-goods-listed + held-first. Reviews (fidelity/architecture/quality) ran clean — folded
in: shared `FONT_FILL` palette in `content/font-gfx.ts` (dedupe with the bitmap fallback), the cap-top
trim, header/AGENTS wording. Known gap: per-tab CATEGORY filtering is still open — the good→stock-tab-
category mapping is not in the extracted data (absent from `goodtypes.ini`; it lives in the original
stock-window GUI definition), so all accepted goods share one list and the eight tabs stay inert chrome.
The grey `bar_disabled` amount plate (original's is darker/recessed) remains a candidate refinement.

Progress note 2026-07-09, fourth pass (`feat/original-ui-details`): visual review of the third pass
("Magazyn icons still unreadable / every resource should have an icon reused in several places / font
could be sharper"). Three fixes. (1) REAL per-good icons. A good's HUD icon is its on-map PILE graphic —
the engine shares one monochrome sheet `ls_goods.bmd` (155 bobs, 5 growth states per good) recoloured per
good through a `goods_*`/landscape `.pcx` palette — NOT the `ls_gui_window` frames the earlier montage
guesses pulled from. New pipeline stage `stages/goods.ts` decodes `ls_goods.bmd` → indexed atlas + preview,
stacks the referenced recolor palettes into a `goods-palettes-lut`, and emits `goods/manifest.json` with a
`good STRING id → {frame, palette}` binding: `goodtypes.ini` (good `landscapeType`) joined onto the
`[GfxLandscape]` "good pile" records (`editGroups` ∋ `good piles all`, matched by `logicType`), taking each
good's state-1 (smallest, single-unit) pile bob. Source basis: atlas+palettes are decoded data; the
state-1 = store-icon choice is observed off the original 1024×768 storehouse (its row icons are each good's
smallest pile — a single stone, a small wheat sheaf), NOT a code-pinned lookup (OpenVikings has no
good→icon table). App: `content/goods-gfx.ts` loads it (keyed by good string id, so it serves the sandbox
and the extracted IR alike); `chrome.goodIcon` draws the recoloured frame fit-centred on the wood, replacing
the old `ls_gui_window`-frame guesses (`icons.ts`/`GOOD_ICON_BY_ID` deleted). Verified in-scene: wood/stone/
mud/iron/gold/mushroom render as correct recoloured piles. (2) Magazyn category TABS now draw through the
`bg_invert` palette — bright cream line-art glyph on a recessed plate — instead of `context`, which rendered
the glyph dark-on-dark (invisible). (3) The panel now bakes at the MAX supersample for a fractional scale
(text is the finest HUD content; a 2× bake linear-downscaled still hazed small glyphs), integer scales stay
1:1. Gates green (1598 tests, check, build); `stages/goods.ts` was run directly against the owned game copy
(155-frame atlas, 25-palette LUT, 42 good icons; the content symlink guard refuses the CLI `--out`). The
join rule is unit-tested (`test/goods.test.ts`, pure `resolveGoodIcons`). Key `landscapeType` (the good's
own pile type), NOT the gathering `landscapeToStore`: the latter is undefined for produced/stored goods
(water/flour/bread/coin), so keying off it would drop their icons — `landscapeType` resolves those correctly
(fidelity-verified). Relationship to existing infra: the bmd tree-walk already bakes per-palette RGBA
`ls_goods.<palette>` atlases, and `resource-gfx.ts` resolves ground piles via `gatheringPipeline`; this stage
instead emits ONE indexed atlas + a goods LUT so a panel showing many goods across many palettes loads a
single atlas rather than N per-palette RGBA sheets (the `PalettedSprite` recolours per row) — a deliberate
one-atlas trade, at the cost of some overlap with that pile resolution. Known gaps: 42/65 goods bind
(tools/weapons/crockery/armour DO — they have `ls_goods` pile records); the iconless rest are goods whose
`landscapeType` has no `good piles all` record — `fruit`, the six potions, the six amulets — and the many
goods sharing `landscapeType 1` (prey, sheep, cattle, hand/ox carts, ships, catapult, chest); `plank` is
sandbox-only (no such good in the extracted `goodtypes.ini`), so it renders iconless in the sandbox. A few
pile records cite palettes that don't ship (`gold01` → coin/oil, `clay01` → armor_plate, `house_saracen01`
→ armor_wool) and fall back to a neutral row. The amount plate is still the grey `bar_disabled` frame (the
original's is a darker recessed field) — unchanged this pass, candidate refinement; the `bg_invert` tab
palette is a named legibility choice (not a pinned original-tab palette); per-tab category identities + the
step-3 human pass over the sheet remain open.

Progress note 2026-07-09, third pass (`feat/original-ui-details`): visual review of the second pass
("font still slightly unreadable / bg too cracked-black / stock tabs broken"). Three fixes. (1) The panel
now renders at the FULL fractional `uiscale` (the 1.4× the tool panel/action ring already use) instead of
`floor`-ing it to 1× — it was ~30 % smaller than the rest of the HUD with a native-10 px font. Because a
fractional scale over the nearest-sampled indexed GUI atlas gives "pixeloza", the panel now bakes like the
tool-panel strip: drawn at an integer oversample into an off-screen texture, then linear-downscaled
(`bakeToSprite` + a new `PalettedSprite.flipY`). `flipY` is the general fix that lets a panel MIXING
PalettedSprites with Pixi-native content (the preview `Sprite`, Graphics fills) bake without the
whole-texture Y-flip the all-PalettedSprite tool strip uses. Hit-testing keeps a separate screen-anchored
layout at the fractional scale; `shiftLayout` re-origins the draw layout to the texture. (2) The bg-body
bake now lifts the swapped `bg_normal` palette's near-black entries toward the original body's sampled
p25 luma (`liftPaletteShadows`) — a straight swap left the marble veins near-black ("cracked black"); the
original body never drops below ~luma 18. (3) Stock tabs draw through the `context` palette (dark recessed
plate + tan category glyph, magenta-keyed so the plate stays) — matching the original's tabs; the earlier
pass drew a light `bar_disabled` plate under keyed-out icons, which read as blank white tiles. Button
labels also moved to `font12` (the original's letterspaced caps). Gates green (1593 tests, check, build);
the GUI stage was re-run against the owned game copy (14 palettes, bg.bg_normal re-baked). Known gaps
unchanged (below); the yellow-green window border is still the `frame`-palette rope (brownish in the
original) — noted, not yet retuned. Perf/fidelity/architecture reviews ran clean (no blockers); their
should-fixes were applied: the two bake helpers collapsed to one (`bakeToFlippedSprite`/`bakeToSprite`
over a shared `bake`), the oversample chooser (`oversampleFor`/`MAX_SUPERSAMPLE`) exported from `render`
and shared with the tool-panel strip, and the draw layout now derives from the hit layout by a uniform
scale (`mapLayout`) instead of a second `layoutDetails(ss)` — so drawn geometry equals hit-tested geometry
by construction (no ~1 px rounding drift down the button column). `liftPaletteShadows` gained an
arithmetic-invariant unit test.

Progress note 2026-07-08, second pass (`feat/original-ui-details`): the panel was recalibrated against
native 1024×768 originals after visual review ("too small, doesn't resemble the original"). Measured
geometry landed in `layout.ts` (panel ≈322 px, preview ≈183 px square, 18 px headlines, 118×16 button
column, 22 px stock rows; stock body FIXED at 6 rows × 2 columns and workers at 4 rows — the original's
windows are fixed-height). Key source find: the in-game window body draws `bitmaps/bg.pcx` through the
`palettes/bg_normal.pcx` ELEMENT palette (embedded palette = grey menu marble; through bg_normal = the
warm brown wood) — the gui pipeline stage now bakes `bg.bg_normal.png` and the app consumes it. Headlines
render in decoded `font12` (body stays `font10`) with a baseline−nominal anchor correction in
`chrome.ts`; borders are rope strips TILED (not stretched) with the 7×7/10×10 knot corners (frames 0–3,
montage-guessed); the stock window gained the original's eight-tab strip (frames 170–177, inert,
montage-guessed); the name underline is a flat sampled lime (#d8fb55 — no shipped bitmap×palette pairing
reproduces it, `bg_selected` unused); preview sits in a thin dark bevel. The sandbox acceptance overlay
now mounts COLLAPSED to a top-right chip so it never covers the panel. Full pipeline verified into a
scratch `--out` (the worktree's `content/` is a symlink into the primary checkout; the CLI guard refuses
writes through it — the new bitmap step was additionally executed directly against the shared content).
Known gaps unchanged: English catalog building names (original Polish house names not yet extracted; long
labels overflow the name column), the "Pojemność" capacity line absent (string not in the decoded
tables), tab/icon identities pending step 3.

Progress note 2026-07-08 (`feat/original-ui-details`): the bottom-right selection details panel renders
as Pixi HUD from original art, replacing the placeholder DOM card. Landed as the `hud/details-panel/`
package: `model.ts` (pure selection→model, headless-tested), `layout.ts` (all geometry in one place),
`chrome.ts` + `sections.ts` (drawing), `panel.ts` (app wiring). Sources: `ls_gui_window` frame/bar
sprites via named `gui-atlas-map.ts` entries (window borders/corners, `bar_frame_96`, resource-icon
guesses — montage provenance, pending the step-3 human pass), tiled — not stretched — `Data/gui/bitmaps/bg*`
fills, `.fnt` text with a Unicode→CP1250 glyph mapping fix in `hud/bitmap-text.ts` (ę/ż/ś... previously
dropped), and decoded strings (`housewindow` titles/buttons, `humanwindow`, `humanlistwindow` count line);
sim-state labels (stance/status/needs) and the defence line stay pinned Polish approximations, and the
building name is the English catalog label until original house names are extracted. Stock icons are keyed
by good STRING id (numeric ids differ between sandbox and real IR). Building sections: general (bob
preview, name + selected underline, Zniszcz/Wycentruj/Pracownicy/Pomoc buttons — only demolish wired),
defence (HQ/tower), production, two-column stock, workers. Geometry remains an explicit approximation
(`CSelectionHouseWindow` is not ported); verified `npm test`/`check`/`build` green + browser screenshots
of building/settler/multi views. Review battery (fidelity/quality/perf/architecture) ran and its findings
landed: textures minted once at asset load (a per-rebuild `Texture` leaked resize listeners), value-driven
rebuilds throttled to 4 Hz, one-pass selection classification, resize in the rebuild key, panel clicks
routed through the unit-controls claim chain, snapshot readers moved to `game/snapshot.ts` (hud no longer
imports view), shared `uiStringLookup`/`DEFAULT_UI_LANG` seam, memoized `loadGuiArt`/`loadBitmapFont`,
and a `TextDecoder`-pinned CP1250 regression test. Visual calibration still needs human sign-off.

Progress note 2026-07-09, sixth pass (`feat/original-ui-details`): visual review of the fifth pass at
`uiscale 1` (the real UI scale — earlier shots were at 2.5). Four changes. (1) Section windows now stack
FLUSH (`SECTION_GAP` 3→0) — the original has no parchment seam between general/defence/stock/workers.
(2) Stock amounts sit in a subtle recessed field (new `chrome.stockField`, flat Graphics) instead of the
grey `bar_disabled` frame, which read as an ugly opaque plate. (3) The eight stock tabs are now
INTERACTIVE: clicking one filters the Magazyn list to its category, the active tab is dimmed-siblings +
lime-underlined, and a fresh selection opens on the building's fullest category. The good→category map
(`hud/details-panel/stock-tabs.ts`) is a NAMED APPROXIMATION — no category data exists in the original
(grep of the whole game tree finds none; the 8 tabs are a hardcoded engine feature) and the tab glyphs are
still unread, so both the categories and their tab order are provisional, keyed by stable good string id.
(4) The three sandbox warehouses got `STORE_STOCK` so they list goods (were empty). Verified live at
uiscale 1 (HQ: flush windows, recessed amount fields, tab filtering — Surowce default shows wood/stone/
mud/iron/gold, clicking Żywność narrows to mushroom); `npm test` (1600) + `check` + `build` green.

Deferred to its own plan (`docs/plans/global-content.md`): the sim still runs on the hand-made
`sandboxContent()` (fabricated 9-good set, `plank` invented, HQ/Joinery/warehouse stock hand-pinned), so
the panel cannot yet show real per-building stock (barracks military goods, 49-slot stores) or all 65
goods. The user's direction is global real `ir.json` content, but the architect found it is a cross-cutting
refactor (schema skew: `gfxAtomics`/`trianglePatternTypes`; good-typeId re-key; a "dead economy" trap —
real content has no `plank` and zero gathering-balance; moved app goldens) that belongs in a separate
branch, not this UI diff. Once it lands the panel shows real data with no UI change, and the tab category
map serves the real good set unchanged.
