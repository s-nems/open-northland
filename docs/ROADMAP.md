# Roadmap

Phased plan. Each phase ends with something runnable or testable. The **current target** is the
top unchecked milestone. Do the smallest next step toward it; don't build ahead.

> This roadmap was revised after a design review against the actual game data. Key corrections:
> `.cif` decoding is on the critical path (not deferrable); settler behavior is an **atomic-action
> planner** (not bespoke per-job code); a **progression/tech graph** is a first-class system;
> navigation is a **cell graph** (the triangle grid is a *render* concern); there are **N tribes**,
> not two. See docs/SOURCES.md and docs/ECS.md.

> **Keep this doc lean — it is read every `/iterate`.** A completed item collapses to a one-line
> summary + `→ [archive]` pointer; its full clean-room "Hands-on:" verification trail goes **straight
> into [ROADMAP-ARCHIVE.md](ROADMAP-ARCHIVE.md)** (the executor never reads the archive), **not inline
> here**. Do not let a landed `[x]` accrete its trail onto the live line — that per-iteration habit is
> the ratchet `/reflect` has had to sweep four times. Detail also survives in git; the live roadmap
> carries only the current target and what is still open.

## Phase 0 — Foundation  ✅
Monorepo; deterministic ECS + scaled-integer fixed-point + seeded RNG + canonical full-state hash +
invariants/headless scenario harness; modern type vocabulary (branded `Fixed`/`Entity`,
discriminated-union commands/atomic-effects/events + `assertNever`); Biome + CI + a determinism
source-hygiene gate. → [archive](ROADMAP-ARCHIVE.md).

## Phase 1 — Asset pipeline + `.cif`  ✅
An owned game copy decodes to validated IR: `.cif` decrypt + container, `.lib` unpack, palette/`.pcx`
→ PNG, `.bmd` bob → atlas PNG + manifest (incl. per-creature recolour), the `.ini`/`.cif` rule
extractors (goods/jobs/tribes/weapons/buildings/landscape/atomic-animations), and `map.cif`/`map.dat`
→ `content/maps/<id>.json` terrain grids. `npm run pipeline` emits a full `content/`. → [archive](ROADMAP-ARCHIVE.md).
- [ ] **Oracle pixel-diffs (human-gated):** compare an emitted `.pcx`→PNG and a `.bmd` atlas frame
      against the OpenVikings render, pixel-for-pixel. Needs an owned game copy + the oracle; an agent
      cannot self-judge pixels.

## Phase 2 — Vertical slice (prove the sim)  ✅
The slice runs end-to-end and deterministic: terrain cell-graph → A\* → movement → the atomic planner
(harvest→carry→pileup) → one workplace with capacity → a carrier → the **CommandSystem mutation seam +
snapshot read-view** → the **golden state-hash + atomic-action trace over 1000 ticks**. The pure
depth-sort scene layer and the GPU draw + `npm run shot` screenshot harness produce a reproducible PNG
(gross-correct; pixel fidelity deferred to a human). Real decoded terrain grids load into both the sim
and the renderer. → [archive](ROADMAP-ARCHIVE.md).
- [ ] **Bind a REAL decoded bob atlas** through the `SpriteSheet` shape and populate the
      `setatomic`→bob `byAtomic` table from the extracted tribe bindings. Gated on an owned game copy +
      a human eyeballing pixels via the OpenVikings oracle. (The self-verifiable halves — atlas-frame
      resolution, per-state binding, a free synthetic atlas behind `?atlas` — are done; see archive.)
  - [x] **Resource/tree bob bound** — `landscapes.cif` `[GfxLandscape]` → `ls_trees.bmd` drawn under
        `?atlas=real` as a per-kind layer (the woodcutter's wood node is a real tree). → [archive](ROADMAP-ARCHIVE.md).
        Deviation (species/frame pick) in docs/FIDELITY.md.
  - [x] **Animation ranges from data, not magic numbers** — `extractBobSequences` reads `animations.ini`
        `[bobseq]` (15 sets / 359 sequences) into the IR; `?atlas=real` derives the settler walk/chop/carry
        `DirectionalAnim`s by sequence name instead of frame constants (matches the old constants byte-for-byte).
        → [archive](ROADMAP-ARCHIVE.md).
  - [x] **Building bob bound** — the HQ draws the decoded `ls_houses_viking.bmd` under `?atlas=real` as a
        per-kind layer, down-scaled to read in proportion with settler + tree. → [archive](ROADMAP-ARCHIVE.md).
        Deviation (one frame for every type; render scale) in docs/FIDELITY.md.
    - [x] **Pipeline `extractBuildingGraphics` leg** — the mod's `[GfxHouse]` table emits every house's
          `ls_houses_*.bmd` body → atlas (one binding per `GfxPalette`), so `npm run pipeline` produces ALL
          house atlases. → [archive](ROADMAP-ARCHIVE.md). (Render-side per-type frame selection landed as
          render-breadth-ladder rung 1 below.)
- [x] **Render terrain from real landscape ground textures** — **LANDED 1:1 for decoded maps** (pending
      final human pixel sign-off; → [archive](ROADMAP-ARCHIVE.md)). The `map.dat` lanes decode to per-triangle
      `GfxPattern` ground + placed objects (`maps/<id>.json` `ground`+`objects`); the renderer draws 1:1 ground
      + every object with loop animation, real graphics on by default (`?terrain=off`/`?objects=off` opt-outs).
      `?map=<id>` is the human sign-off entry. **Open (deferred):** `lmhe` height shading; `emt3`/`emt4`
      road/foundation overlays; `lmpa`/`lmpb` triangle logic → sim water/walkability +
      object collision; the `fx wave*` engine-fx records. Data model in docs/SOURCES.md.
- [x] **Faithful map projection — raster-with-stagger, pitch 68×38** (2026-07-03, docs/FIDELITY.md
      "projection"): `tileToScreen` is the MEASURED staggered raster (col step = pure horizontal 68px,
      row step = pure vertical 38px, odd rows shifted half a cell; continuous triangle-wave stagger for
      walking units; `halfCellToScreen` for the plain `emla` object lattice), with the terrain mesher,
      chunk AABBs, `visibleTileRange`, picking and formation slots migrated. The first calibration
      (34.5×18.7) aliased to exactly HALF the true pitch — the owner's world-too-dense report caught
      it; the second pass re-derived the metric from a uniform 7-shot top-strip corpus (capture scale
      1.25× pinned by 5 building templates; 19-building lattice fit with free stagger + elevation
      terms, x-rms 0.31 px, y-rms 1.21 px; template-free panorama arithmetic agrees). Render-only.
      **Still open — `lmhe` elevation lift:** the pipeline now EMITS the per-cell height layer
      (`maps/<id>.json` `elevation`, `stages/maps.ts` `elevationFromMapDat`, length = width·height,
      0..250 observed); still to do is lifting `y` by the fitted ≈1.24 native px/unit in the projection
      consumers, then re-verifying shore/hill silhouettes against the screenshots.
- [x] **Per-object growth/damage state from the `lmlv` lane** (2026-07-03, docs/FIDELITY.md
      "Landscape-object layer"): the byte lane is the 1-based per-placement LEVEL counting up from
      the LOWEST state; the record's `GfxFrames` lists are authored highest-first, so the binding
      picks `frames[N−level]` (`stateIndexForLevel`; sentinel 100/out-of-range → the full first
      list). The initial top-down reading drew mature forests as saplings — corrected against the
      screenshot corpus (isolated lmlv=3 cypress matches the full-grown frame at 0.99). Closes both
      the "uniform giant trees" and the "far fewer trees" deviations.
- [x] **Import a decoded map's authored placements** (`map.cif` `StaticObjects`, 2026-07-03): the
      pipeline decodes `sethouse`/`sethuman`/`setanimal` VERBATIM (names + half-cells) into
      `maps/<id>.json` `entities` (schema: `TerrainEntities` in @vinland/data; 13/125 maps carry the
      section), and the app resolves them by NAME against the IR at load (`resolveAuthoredPlacements` →
      `runAuthoredSlice`, falling back to the demo slice when nothing resolves). Hands-on: the bridge
      map places its authored 62 buildings + 168 settlers (placed 230, skipped 0). Deferred: `setanimal`
      placement (herd semantics), `addgoods`/`setproducedgood`/`setguide`, rotation→facing
      (docs/FIDELITY.md "Authored entity placements").
      **Corpus-comparison follow-ups** (2026-07-03, from the mosty-5 side-by-side at the settled 68×38
      pitch): (a) authored buildings must draw their authored `EditName` VARIANT — the map places
      `"viking headquarters house"` (bob 44, confirmed in the shot) but the import collapses to typeId
      and the canonical binding draws `"viking headquarters"` (bob 34, the crane-roofed variant; both
      names occur across the 13 entity-bearing maps, 29 vs 6, so thread the name through instead of
      flipping the canonical); (b) the mill draws its static drum — the original animates the sails
      (`GfxHouse` anim lane, unbound); (c) ~~the north forest reads YOUNGER than the original~~ —
      RESOLVED same day: the `lmlv` level counts up from the lowest state (`index = N − level`,
      docs/FIDELITY.md "Landscape-object layer"); (d) the rocky-ground area's LAYOUT reads different
      from the original's (owner report on the same comparison) — suspect the undrawn `emt3`/`emt4`
      overlays and/or missing `lmhe` elevation shading rather than the pattern lanes, undiagnosed;
      (e) palisades draw as SINGLE POSTS — the original joins them into a continuous wall (owner:
      defer, but it is the look's signature; the `wall_03/04/05` records are orientation variants,
      so the join likely picks a segment per neighbour direction, unpinned).
- **Exit:** click to place one workplace; a settler autonomously supplies it via atomics; a carrier
  hauls outputs to a store; the 1000-tick golden hash + trace stay stable. **(Headless slice + golden
  proven; the real-atlas bind + final human pixel check remain.)**

### Render breadth ladder — more decoded assets on-screen (one category per `/iterate`)
The pipeline already emits atlases for most assets (~80% of the bob `.bmd`s), but the render
(`app/src/content/`) currently draws only settlers + one tree species + one HQ house. This ladder
wires the rest on-screen, **cheapest first**; each rung is one iteration that adds a
`packages/app/src/scenes/` acceptance scene for the human pixel sign-off (an agent can't self-judge pixels).
The repeatable recipe per rung: load the extra atlas(es) in `loadHumanSpriteSheet`, route the entity's
`typeId` through `resolveSpriteBobId`/`buildHumanBindings` as a per-type bob lookup, add the scene + headless
check, commit. **Render-only** rungs need no pipeline change (the atlas is already on disk);
**pipeline-blocked** rungs need an extractor or palette stage first.

> **Current user-directed focus (2026-06-30):** deliver the **COMPLETE viking set** — every viking building
> and every viking animation across **ALL viking human bodies** (man + alt appearances, warrior, woman, boy,
> girl, baby, and the viking-specific civ body). (1) Finish the viking **buildings** — the binding is now
> COMPLETE (rung 1's `house02` skin landed; all 40 viking `[GfxHouse]` types draw their own bob, 0
> fall-backs), with the single `?scene=all-buildings` gallery (the completeness-montage capstone — all 41
> types at once) the only remaining sign-off gate. (2) Add **multi-body render support**, then bind the
> **whole** `[bobseq]` vocabulary per body (rung 3) — worked category by category (harvest, indoor crafts,
> carrying, idle/needs, fight, shoot) then per body (woman/children/viking-civ), with a completeness-gallery
> scene as the exit gate. The listed categories/seqs are the breakdown, not the limit. Rung 2 (landscape
> variety) and the **other tribes** are **deferred behind the viking set**.

1. [x] **Buildings per-type frame selection** — **LANDED** (→ [archive](ROADMAP-ARCHIVE.md)): every viking
   building draws its OWN house bob via a data-pinned `(typeId→bob)` join (`extractBuildingBobs` →
   `buildingBobs` IR) + a layer-aware `BuildingTypeBinding` across all viking families — all 40 viking
   `[GfxHouse]` typeIds bind with **0 fall-backs**. **Remaining:**
   - [ ] **Capstone pixel sign-off (pending):** `?scene=all-buildings` places all 41 viking types at once
     (real graphics, zoomed to fit) — the single remaining human check that every type (incl. the last three:
     stock / brewery / coin mint) draws a distinct, non-placeholder house. → flip to `[x]` once confirmed.
   - [ ] **The other tribes** (frank/egypt/saracen/byzantine) — deferred behind the viking set; same
     machinery (`buildingBobs` already covers all 6); a per-tribe (or montage) scene; **human pixel sign-off**.
2. [ ] **Landscape/resource per-type variety** (render-only) — bushes, signs, wonders, harbours + non-yew
   tree species, each via its own `[GfxLandscape]` bob (today every resource is the single yew). Same recipe
   as rung 1 over the already-emitted `extractLandscapeGraphics` atlases (87 landscape types in IR).
   - [x] **Resource nodes by goodType** — every gatherable good draws its own decoded node (wood→tree,
     stone→rock, clay/iron/gold→mine decal, mushroom), via a per-good `ResourceTypeBinding` (mirrors
     `BuildingTypeBinding`) built from the Step-1 `gatheringPipeline` join; `Resource.goodType` rides the
     `DrawItem`. → [archive](ROADMAP-ARCHIVE.md).
   - [x] **Loose ground piles + flags rendering** — a bare `Stockpile+Position` now classifies as a new
     `'stockpile'` `DrawKind`: a held pile draws its good's `ls_goods` heap (growing with its contents), an
     empty pile the `ls_temp` delivery flag. Acceptance scene `?scene=gathering`. → [archive](ROADMAP-ARCHIVE.md).
3. [ ] **Complete viking animation set — ALL viking human bodies** (render over already-extracted
   `[bobseq]`) — **CURRENT FOCUS.** Goal: **every** viking human body draws its **full** `[bobseq]`
   vocabulary, none left on a wrong/placeholder pose. Today the render binds a SINGLE generic-man body
   (`cr_hum_body_00`) to only walk / idle / woodcut-chop / wood-carry — a tiny corner of what is extracted.
   The viking population is several bodies, each its own atlas + `[bobseq]` set (all decoded, none consumed):
   - **man** `cr_hum_body_00` — 69 seqs: per-job work, the generic needs, 27 `walk_<good>` carry gaits,
     civilian unarmed fight (the rich one). Alternate man appearances `cr_hum_body_30`/`_50` carry the same
     69 seq names (confirm whether the viking uses them, e.g. for crowd variety).
   - **warrior man** `cr_hum_body_05` — 57 seqs: armed attack/throw/walk/wait per weapon (broadsword /
     longbow / shortbow / spear / sword).
   - **woman** `cr_hum_body_10` — 13 seqs (civilian fight + generic + a few carry gaits).
   - **boy** `cr_hum_body_20` (5) · **girl** `cr_hum_body_21` (6) · **baby** `cr_hum_body_22` (3) — small sets.
   - **viking-specific civ man** `cr_hum_vik_man_civ_body_00` — 4 viking-only seqs (pick_up / wait / walk /
     …), COMPOSED ON TOP of the generic man (the viking flavour), not a replacement.

   (Bodies `cr_hum_body_70/71/73/74` are monsters — werewolf / weresnake / grizzu / santa — and
   `cr_ani_body_00` / `cr_veh_body_00` are animals / vehicles → NOT settlers; they belong to rungs 4/5.)

   **Structural prerequisite (do first):**
   - [ ] **Multi-body render support** — load each viking body atlas under its viking palette and SELECT the
     body per settler from `(sex, age class, is-warrior)` — the sim already ages baby→child→adult
     (`growthSystem`) and knows tribe/job, so the selector is data, not magic. Generalise today's single
     `settler` binding into a per-body bindings table, each driven by its own `[bobseq]` set. Also resolve
     WHICH palette is "viking" for human bodies (today's `test_human_00` is a placeholder skin).

   **Per-category coverage of the man's rich set** (the breakdown — illustrative seqs, **not** the limit; exit
   = the whole vocabulary). Recipe per category: pick the `[bobseq]` name(s), route the sim's atomic id /
   carried good to it in the body bindings, add an acceptance scene + headless check, the user signs off.
   Playback keeps the per-direction stride heuristic (faithful `[gfxanimatomic]` timing is the last bullet).
   - [~] **Harvest by resource** — **DONE for the mined/gathered goods:** each harvest atomic plays its OWN
     authored clip (wood→`woodcutter_work_woodcutting`, stone→`stonecrusher_work_stonecrushing`,
     clay→`clayworker_work_shovel`; iron/gold reuse the shovel — no authored miner clip; mushroom→`generic_pick_up`),
     bound globally in `CHARACTER_SPECS`, paced by the faithful per-good `HARVEST_TICKS` (a dig runs longer than
     a chop), and shown across six named "Zbieracz (…)" trades in `?scene=gathering` (docs/FIDELITY.md "Gathering
     work animations"). **Still open:** grain (`farmer_work_reap_grain`/`_sow`/`_water`), fish
     (`fisher_work_fishing`/`_walk_angle`), hunter (`hunter_attack_bow`).
   - [ ] **Indoor crafts (works inside a hut)** — baker / blacksmith / joiner / potter / tailor / druid /
     artist / fountain (`Baker_*`, `Blacksmith_*`, `Joiner_*`, `Pottery_form`, `tailor_*`, `Druid_work`,
     `Artist_*`, `fountain_push`).
   - [ ] **Carrying by good** — select `walk_<good>` by the CARRIED good (all 27 gaits, not just wood).
   - [ ] **Construction** — `constructionworker_Work_Hammer` at an under-construction site (composes with the
     Phase-3 ConstructionSystem).
   - [ ] **Idle & needs ("nudzi się")** — true idle `generic_wait` (distinct from the walk-frame-1 hold) +
     the NeedsSystem drivers `generic_eat`/`_sleep`/`_pray`/`_kiss`/`_speak`/`_happy_jump`/
     `_beeing_satisfied`/`_pick_up`.
   - [ ] **Melee fight** — civilian unarmed (`Civilian_Fight_*`, man body) then armed sword/spear (warrior
     body `cr_hum_body_05` + its walk / wait / wait_agressive / eat / sleep variants).
   - [ ] **Ranged / shooting** — warrior `Longbow_attack`/`Shortbow_attack`/`spear_throw` (cr_hum_body_05).

   **Per-body coverage** (women / children / viking-civ have small sets — finish each in one pass):
   - [ ] **Woman** (`cr_hum_body_10`, 13 seqs) — fight + generic + her carry gaits.
   - [ ] **Children** — boy (`_20`), girl (`_21`), baby (`_22`): eat / wait / walk / crouch.
   - [ ] **Viking-civ man overlay** (`cr_hum_vik_man_civ_body_00`, 4 seqs) composed on the generic man.
   - [ ] **Man alt appearances** (`cr_hum_body_30`/`_50`) — wire if the viking uses them (else record why not).

   - [ ] **Completeness gallery (capstone)** — a `?scene=viking-animations` montage that plays EVERY body ×
     EVERY bound seq with its name, so the full set is verifiable in one pass and any missing/wrong-pose seq
     is obvious. Exit gate for "complete viking animations".
   - [ ] **Faithful per-direction timing** (pipeline + render) — replace the linear `start + dir*stride +
     phase` stride heuristic with the real per-direction frame tables: `[gfxanimatomic]` (**1280**) +
     `[gfxwalkatomic]` (**511**) in `animations.ini`, keyed by `(tribe, job, atomic-action)` with explicit
     8-direction `gfxanimframelistdir` lists (ping-pong swings, irregular direction reuse) — **not extracted
     at all** today. Add the extractor + drive playback from the real lists. Record the stride heuristic as a
     divergence in docs/FIDELITY.md.
4. [ ] **Vehicle graphics** (pipeline + render) — no vehicle-graphics extractor yet; mirror
   `extractBuildingGraphics` for the cart/ship `.bmd`s, emit atlases, add a `'vehicle'` `DrawKind` + binding.
   (6 vehicles exist sim-side, Phase 4 — graphics deferred.)
5. [ ] **Animal graphics** (pipeline + render) — same shape as rung 4 for `cr_ani_body_*.bmd`; the
   `[bobseq]` ranges already cover animal walk/wait/fight, so playback reuses rung 3's machinery. (35 creature
   tribes exist sim-side, Phase 4 — graphics deferred.)
6. [ ] **Shadows** (blocked on pipeline Stage 2) — every binding already carries `shadowBmd`, but shadow
   atlases need the single-colour shadow-palette path (the Phase-1 "palettes + `.hlt` remap" decode, still
   TODO). Do after Stage 2 lands.

**Render performance / scale — retained renderer** (infrastructure, orthogonal to the breadth ladder). The
immediate-mode `renderScene` churned one Pixi object per tile + per entity **every frame** and crashed the
tab past ~2700 tiles — a blocker for the target (256×256 maps, 8 players, thousands of bobs, deep zoom-out).
- [x] **Retained `WorldRenderer` + viewport culling + terrain chunking** — persistent scene graph (terrain
      meshed once in `TERRAIN_CHUNK_TILES` blocks toggled against the viewport, sprites pooled, one
      `app.render()`/frame), so **render cost tracks the screen, not the map**; `MIN_ZOOM 0.15` for a
      battle-scale view. `?scene=stress-crowd` (256×256, ~2.5k bobs) + FPS overlay are the perf proof. Rules
      in `packages/render/CLAUDE.md`. → [archive](ROADMAP-ARCHIVE.md).
- [x] **Sim scaling — the real bottleneck was the SIM, not the GPU: step 480 → 1.9 ms/tick at 2848 units
      (~250×), goldens byte-identical; stress scene 1 → ~100 fps.** Memoized `canonicalEntities()`, per-tick
      candidate lists, an idle-dormancy gate, and `TileBuckets` (same-tile O(1)) — each elides only
      provably-null work so the tie-break winner never changes. Full rationale in `packages/sim/CLAUDE.md`
      ("Scaling to thousands"). → [archive](ROADMAP-ARCHIVE.md).
- [ ] **Sim scaling, tier 3 — full ring-search nearest-X** (primitive + first consumer landed; economy consumers
      deferred). The grid ring search now exists — `TileBuckets.nearest` (expand Manhattan bands, finish the whole
      minimum-distance band, pick canonically by (distance, id), short-circuit past the radius) — and its **first
      consumer is combat's nearest-enemy query** (`combatSystem`, the owner-based melee-engagement slice): **23×
      faster than a full scan at 400 combatants (12.9 → 0.55 ms/query-pass), and it scales ~linearly not
      quadratically (4× the units grows the full scan 15.5×, the ring search 3.7×)**; goldens byte-identical.
      **Remaining:** migrate the ECONOMY nearest-X scans (nearest resource/store when it's NOT on my tile — still
      `O(idle · candidates)`) onto the same primitive. Mitigated for those today by: busy-unit skip, the dormancy
      gate, and candidate lists. Also still open: **content-index** (`Map` by typeId vs `content.*.find()`), **sim
      in a Web Worker** (snapshot already transferable). Each stays deterministic / golden-guarded.
- [ ] **Zoom-out LOD** (deferred) — below a zoom threshold, freeze per-frame animation and draw simplified
      per-player-tinted markers (a `ParticleContainer`) instead of full bobs, skipping the depth sort. Hooks in
      as a `lodPolicy(camera.scale)` gate in `WorldRenderer.update`. Only needed if we ever want below-`MIN_ZOOM`
      whole-map framing; the battle-scale target does not.
- [ ] **Retained HUD** (deferred) — pool the HUD `Text` rows instead of rebuilding them each frame (the double
      `app.render()` is already gone). Minor; do if the HUD shows up in a profile.
- [x] **In-game LEFT tool panel** (GUI rework Part 4) — the original toolbar strip + tool buttons, a working
      game-speed button (cycles ×1/×2/×3/pause, drives the app tick rate), a categorised building menu (issues
      `placeBuilding`), and statistics/help windows, drawn screen-space from the extracted GUI atlas + `.fnt`
      fonts at the OpenVikings-pinned geometry (integer `?uiscale`, default 1×). **GLOBAL** — part of the
      standard game HUD, mounted over `?live` AND every `?scene=` via the shared `view/game-tool-panel.ts`
      (not a per-scene opt-in). Icon buttons are colour-keyed (magenta + near-black band → transparent) so the
      glyph sits on the strip, not an opaque dark square. Proven by `?scene=tool-panel` + pure
      hit-test/speed/menu unit tests (`packages/app/test/tool-panel.test.ts`); pixels human-signed
      (docs/FIDELITY.md "Left tool panel"). **Open (deferred):** sprite 9-slice window chrome (v1 windows are a
      parchment `Graphics` panel) + building-icon thumbnails + menu scrolling; a **placement-preview** (footprint
      ghost + red/green validity feedback — today an invalid placement is silently rejected); the strip-vs-glyph
      composition may want an art pass (glyphs sit over the ornamental strip); the not-yet-actioned tool buttons —
      diplomacy / population / mission / tech-tree / options windows + a real HELP window (help is temporarily
      aliased to the statistics window in v1); the minimap region (a separate task).
- [x] **Settler action menu** (GUI rework Part 5) — the contextual command buttons over a selected settler,
      opened by **Space or a right-click on the unit**, rebuilt in original GUI art in place of the DOM "Zmień
      zawód" card: the **whole default human menu** — round wooden `order_*` buttons (`context` palette LUT via
      `PalettedSprite`, pixel-snapped for crisp glyphs) on four arms whose footprint is transcribed from the
      OpenVikings `BuildHumanActionButtons` (±100 px arms, 32 px buttons/step, ∓5 corner nudge). On this slice
      only **"change profession"** is wired — it opens a simple profession PICKER (a grid of the content jobs)
      that issues `setJob`, and the info card reflects the change live; every other button is an inert
      **placeholder** (drawn + tooltipped) awaiting its action. Proven by `?scene=unit-orders` + pure
      layout/hit-test unit tests (`packages/app/test/action-ring-layout.test.ts`); pixels human-signed
      (docs/FIDELITY.md "Settler action menu"). **Open (deferred / pending calibration):** the default-menu
      icon+slot assignment is a best-guess read off the running original (its command→gfx table is an unfilled
      placeholder in the oracle — see FIDELITY); the placeholder buttons' actions (attack / house / animal /
      vehicle / social / needs) + the warrior/scout menu variants + the picker's original art are the future
      "implement the action" passes; the centroid anchor + full-palette picker (vs the per-human valid subset)
      are deliberate divergences. Next: GUI rework Part 6 — the bottom-right details panel in original window art.

## Phase 3 — Economy, progression & population  (substance complete; only human-gated render checks remain)
- [x] **Goods graph** — explicit IR artifact: input side + output-side recipe join +
      raw→produced→food node layers. → [archive](ROADMAP-ARCHIVE.md).
- [x] **NeedsSystem** — hunger + the non-food needs (eat, fatigue→sleep, piety→pray, enjoyment,
      make_love): the rise + drive halves, wired into the AI atomic planner. → [archive](ROADMAP-ARCHIVE.md).
- [ ] **ProgressionSystem** — experience + tech graph. **Landed** (→ archive): XP extract + accrual; all
      four `jobEnables` edge kinds consumed (`house` placement / `good` production / `vehicle`
      carry-capacity / `job` assignment); the `{need,train}for{job,good}` extract + `needfor*` read side +
      the `needforgood` harvest / `needforjob` assignment gates. **Open (oracle-blocked):** interpret
      `baseRepeatCounter` into the multi-tier competence curve (output quality/speed by XP tier) — neither
      the `.ini` nor OpenVikings carries the XP→tier curve, so it is deferred to calibration-by-observation
      (docs/FIDELITY.md).
- [ ] **JobSystem** — **landed** (→ archive): idle settlers take open, tech-enabled, understaffed jobs
      (`needforjob`-gated), bound per-workplace (`JobAssignment`), walking to their station; carrier batch
      sized by the largest unlocked vehicle (`carrierCarryCapacity`). **Open (recorded deviation):** the
      carrier→vehicle PAIRING (per-carrier vehicle entity / cart logistics / carry-filter) is oracle-blocked
      (docs/FIDELITY.md — *Carrier→vehicle pairing*).
- [ ] ConstructionSystem: place → deliver materials → build; **house leveling** → capacity → the
      births→housing loop. **Substance-complete + building ground footprints** (→
      [archive](ROADMAP-ARCHIVE.md), docs/FIDELITY.md): build cost extracted from `[GfxHouse]
      LogicConstructionGoods`; a `placeBuilding{underConstruction}` site builds as the carrier path delivers
      materials; a built `home` upgrades a tier on accumulating the next tier's cost; free placement with
      footprint collision + min-distance, walk-blocking bodies, and door-cell interaction;
      `?scene=house-placement` signs it off. **Open (deferred):** builder-driven build progress
      (`constructionworker_Work_Hammer` + `LogicConstructionWorkArea`), the enter-building/hide-worker split
      (`GfxOverlay` open workshops), the `upgrade=1` construction-layer rows, repath-on-new-foundation.
- [ ] **ReproductionSystem** — **landed** (→ [archive](ROADMAP-ARCHIVE.md)): one birth per tribe per tick
      while `tribePopulation < housingCapacity` (the `populationWithinHousing` invariant); newborn is the
      data-pinned youngest age class, `growthSystem` ages it baby→child→adult then employs it. **Approximated:**
      birth rate/sex + growth cadence are below the readable `.ini` (docs/FIDELITY.md). Inert on the golden.
- [ ] HUD: stocks, population, jobs, the goods graph. **Landed** (→ archive): sim-side read views
      (`tribeStocks`/`tribePopulation`/`tribePopulationByJob`/`goodsGraph`) + the render-side HUD chain over
      the frozen snapshot (`packages/render/src/data/hud.ts`). Only glyph rasterization/typography is left for a
      human via the shot.
- [x] **Faithful multi-hit harvest + drop-on-ground** — **LANDED** (→ [archive](ROADMAP-ARCHIVE.md),
      docs/FIDELITY.md). A wood node carries a `Felling{chopsLeft}` (content-gated on the good's
      `gathering.chopsToFell`, never a hardcoded goodType): the collector CHOPS it down over several swings
      (each yielding nothing), the tree FALLS — the standing node is removed and drops its whole yield at its
      cell as a bare `Stockpile` trunk (a `GroundDrop`) + a `Stump` decor — and the collector then carries the
      trunk off, a load at a time, via the EXISTING pickup/porter/delivery machinery (goods conserved; the
      vertical-slice golden fells its 2 trees → 2 stumps, 18 wood → 18 planks, hash/trace re-pinned). Render
      draws a new `'stump'` DrawKind (the `ls_trees_dead` debris frame); `?scene=gathering` runs the live
      cycle for the human sign-off. Chops/yield are OBSERVED (content `chopsToFell`/`yieldPerNode`, pending
      calibration — docs/FIDELITY.md). **Open (deferred):** the "tree falling" transition ANIMATION
      (render polish); the choppy pick-up/deposit animation fix (set the atomic duration to the animation
      length — a render-timing fix, still open).
- [x] **Mineral deposits shrink by level + mushrooms** (gathering Step 4) — **LANDED** (docs/FIDELITY.md
      "Mineral deposits"). A mined good (stone/iron/gold/clay) carries a `MineDeposit{initial,levels}`
      (content-gated on `gathering.depositSize`/`depositLevels`, never a hardcoded goodType): each harvest
      atomic chips ONE unit and drops it at the deposit's cell as an ore `GroundDrop` (reusing the Step-3
      drop/pickup/deliver machinery, one unit at a time), the deposit STAYS shrinking a visual level
      (`depositVisualLevel` → `DrawItem.level` → a per-level `ResourceTypeBinding` frame list) until its last
      unit, when it is REMOVED (`resourceDepleted` — the same removal path Step 5's collision-unblock hooks).
      A mushroom is the trivial neither-marker DIRECT pickup (one harvest onto the back, then remove). Goods
      conserved (a deposit of N → exactly N ore). Deposit SIZE is OBSERVED (no readable unit-count source —
      `maximumValency` is a per-cell valency, not the count); the fill-LEVEL count is gfx DATA (the mine
      record's frame count — 5 for clay/iron/gold, 4 for stone, per-good; the render derives it), see
      docs/FIDELITY.md. `?scene=gathering` runs a live mud-mining cycle. **Open
      (deferred):** mushroom/herb regrowth + cultivation (the `isBioLandscapeFlag` bio-transitions,
      `atomicForPlanting`) is OUT OF SCOPE for the gathering pipeline — a future bio-lifecycle slice; the ore
      batching (chip several before hauling vs carry-each) awaits calibration against the original.
- **Open Phase-3 work** is the three **human-gated render items** (the Phase-1 oracle
  pixel-diffs; the Phase-2 real decoded-bob-atlas bind; the Phase-2 real terrain-tile render) — an
  agent cannot self-judge pixels. The
  economy/progression/population substance is otherwise done; feature work has advanced into Phase 4.
- **Exit:** a self-sustaining, progressing single-tribe settlement you can grow.

## Phase 4 — Conflict & content breadth (N tribes)  ← **current target**
- [ ] CombatSystem from `weapontypes`/`armortypes` (a large subsystem: soldier classes, armor tiers,
      heroes, amulets/potions — scope it honestly; the step-by-step rework is `docs/plans/combat.md`).
      **Substance landed** (→ [archive](ROADMAP-ARCHIVE.md), docs/FIDELITY.md): the material-column damage
      model + the full targeting→`attack`→hit→death loop at the data's swing cadence; **engagement** (owner
      hostility, ring-search targeting, walk-into-melee advance, `attackUnit` order); the **four military
      stances** (attack / defend / ignore / flee — civilians run from danger at a run gait). Faithful
      (damage column, atomic id 81, the `MILITARY_MODE` enum); inert on the golden (owned-only). **Open:**
      ranged projectiles-in-flight, warrior render/animations + combat feedback, barracks + towers, and
      step-10 calibration of the approximated behaviours (sight/defend radii, run speed, flee/need
      arbitration).
- [x] **N data-defined tribes** (viking/frank/saracen/byzantine/egypt), asymmetry via each tribe's atomic
      bindings + `allow*`/`needfor*` graph — never hardcode "two". **Substance-complete** (→
      [archive](ROADMAP-ARCHIVE.md)): all 41 `[tribetype]`s extracted, every rule resolved off `settler.tribe`,
      `playableTribes`/`isAnimalTribe` split civs from animals by the tech graph alone; `two-civ-combat.test.ts`
      runs asymmetric bindings through the real `step()`. HP magnitude approximated (docs/FIDELITY.md). **Open
      (deferred):** tribe-vs-tribe diplomacy, soldier-class→armor-tier binding.
- [x] **Animals as non-controllable tribes** (`animaltypes.ini`) — **substance-complete** (→
      [archive](ROADMAP-ARCHIVE.md)): all 35 creature tribes extracted, every field consumed — aggression
      drives `mayAttack`/`Anger`/`mayHunt`, animals spawn as herds, fight, and a hunter's kill yields the
      carcass's meat; each walks at its data-pinned `movespeed`. Proven by `populated-map-combat.test.ts`.
      Faithful to the hitpoint/`movespeed` magnitudes; the scale DIRECTION + flee/charge/swing DRIVES are
      approximated/deferred (docs/FIDELITY.md "Animal locomotion pace").
- [ ] **Sea/Northland identity:** water valency, boats as mobile stores, embark/disembark atomics,
      `fisher_sea`/`trader_sea`, `vehicle_ship`. **First steps landed** (→ [archive](ROADMAP-ARCHIVE.md)):
      the `vehicle_ship` rows + cargo allow-lists + `logicSize` class, a placed boat-hull `Stockpile` entity
      (`placeBoat`) with its cargo-load gate, the `_sea` jobs, and the landscape placement-layer triple.
      **Open:** water-VALENCY terrain is now **decode-unblocked** (the map's `lmpa`/`lmpb` per-triangle logic
      ids carry `iswater`/`humancanwalkon`; remaining work is emitting a water lane + consuming it in
      `buildTerrainGraph`); boat movement + embark/disembark atomics (no such atomic in the readable `.ini`);
      the sea-job BEHAVIOR (rides on boat movement).
- [ ] Import full base + `culturesnation` content; bring over the mod's balance edits (data).
      **Substance-complete** (→ [archive](ROADMAP-ARCHIVE.md)): the mod ships NO overriding base logic tables
      (so no overlay merge); its readable overlays are all landed (jobgraphics recolours, the `[GfxHouse]`
      build cost, the `weapons.ini` fields), and every extracted field on the weapon/armor/atomic-animation/
      vehicle/landscape/animal tables now has a sim read view — the data-extraction vein is exhausted.
      **Open:** the behaviours those read views seed are all oracle-blocked (docs/FIDELITY.md).
- **Exit:** N tribes can coexist/fight; sea travel works; most content types represented.

## Phase 5 — Campaigns, polish, platform
- [ ] Campaign/scripting layer (decide early: data-driven triggers preferred over code) — load
      `OsmyCudSwiata` / `WyprawaNaPolnoc` / `BramyAsgardu`. **Verify whether mod campaigns carry
      scripted behavior** a data-only pipeline would miss.
- [ ] Save/load: command-log replay + **snapshot fast-load** (replay-all is unviable for hours-long
      settlements). Snapshot schema designed alongside components in Phase 2, finalized here.
      Format policy pre-designed in docs/PRIOR-ART.md: versioned metadata trailer, content
      fingerprint + final-hash integrity stamp, refuse-on-mismatch, snapshot round-trip resume test.
- [ ] Audio (transcoded ogg; no DirectMusic `.sgt`/`.dls` dependency).
- [ ] Tauri desktop builds for Mac/Win/Linux (renderer stays WebView-compatible).
- [ ] (Stretch) lockstep multiplayer — the determinism work pays off here. Order-pipeline decisions
      pre-recorded in docs/PRIOR-ART.md: host-stamped execution tick, sim-vs-session command split,
      pause/speed/disconnect as logged commands.

## Cross-cutting DX (modern wins — the deterministic core makes these cheap)
- [ ] **Run the sim in a Web Worker.** Move `step()` off the main thread so render stays 60fps under heavy
      ticks. Snapshot transferability is PINNED (→ [archive](ROADMAP-ARCHIVE.md); `structuredClone` round-trip
      test). **Open:** the app-side Worker wiring (host↔worker protocol, render reading the transferred snapshot).
- [ ] **Time-travel / replay inspector.** Scrub ticks, diff state between two ticks, dump an entity. **Headless
      core landed** (→ [archive](ROADMAP-ARCHIVE.md)): `replay()`, `HashTrace`/`divergedFrom`, `diffSnapshots`,
      `dumpEntity`/`traceEntity`, `localizeDivergence`, `scrubWindow` — all hash-oracle'd. **Open:** the dev
      OVERLAY wiring it into UI (a `render` concern).
- [ ] **Content hot-reload.** Wire Vite HMR to re-parse validated content JSON and rebase the sim on file
      change → instant balance feedback. **Headless core landed** (→ [archive](ROADMAP-ARCHIVE.md)): pure
      `rebaseContent(...)` replays the command log under new rules (reversible, deterministic, hash-oracle'd).
      **Open:** the Vite-HMR glue that watches the file + a future-ticks-only reload policy.

## Risks & open unknowns (watch these)

**Live:**
- **Settler AI fidelity** — the soul, undocumented. Approach = a planner over the data-extracted
  atomic vocabulary; base atomic timings/yields come from `atomicanimations.ini`, with only
  fine-tuning by observation, kept as data so tuning is a diff. See docs/ECS.md "Settler AI".
- **Combat & campaign scripting scope** — both larger than one roadmap line implies.
- **Determinism drift** — every new system must keep the golden state + trace tests green.

**Resolved (archived):**
- ~~**`.cif` decrypted payload structure**~~ — SOLVED in Phase 1 (`decoders/cif.ts`): a root
  `CStringArray` of Mode1-encrypted depth-prefixed text lines; verified on type tables + a map.
- ~~**Atomic timings/effects**~~ — extracted (`extractAtomicAnimations`); decoding what each `event`
  `(type, value)` means (yields/needs/cues) is fine-tuning by observation.
- ~~**Map binary tile grid**~~ — decode chain closed **and** wired: `map.dat` `hoix` container →
  `pck`/`X8el` unpack → the `lmlt` 4-corner landscape lane → `lmltToTerrainMap` → `buildTerrainGraph`,
  emitted to `content/maps/<id>.json` by `npm run pipeline`. The corner→cell reduction is
  *approximated* (no behavioral oracle — docs/FIDELITY.md). See docs/SOURCES.md "`map.dat` chunk container".
