# Roadmap

Phased plan. Each phase ends with something runnable or testable. The **current target** is the
top unchecked milestone. Do the smallest next step toward it; don't build ahead.

> This roadmap was revised after a design review against the actual game data. Key corrections:
> `.cif` decoding is on the critical path (not deferrable); settler behavior is an **atomic-action
> planner** (not bespoke per-job code); a **progression/tech graph** is a first-class system;
> navigation is a **cell graph** (the triangle grid is a *render* concern); there are **N tribes**,
> not two. See docs/SOURCES.md and docs/ECS.md.

> **Completed phases are summarized one line each; the full clean-room verification trail (the
> "Hands-on:" notes) lives in [ROADMAP-ARCHIVE.md](ROADMAP-ARCHIVE.md)** — the executor never reads
> the archive. `/reflect` sweeps newly-completed items there so the live target stays legible.

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
- [x] **Render terrain from real landscape ground textures** — **LANDED 1:1 for decoded maps** (pending the
      final human pixel sign-off). The map-import slice cracked the `map.dat` lanes: `empa`/`empb` hold the
      **baked per-triangle `GfxPattern` choice** (the "oracle-blocked pattern algorithm" runs in the EDITOR at
      author time — the save stores its output), `emla`+`eald` the placed landscape objects, `lmlt` is the
      logic-OBJECT lane (raw = typeId, 0 = none — the old +1 shift was a bug, fixed). `maps/<id>.json` now
      carries `ground` + `objects`; the renderer draws per-triangle 1:1 ground (`buildGroundTerrain`), every
      placed object (trees/stones/mines/palisades/bridges) with loop animation (waves/sway) and translucent
      wave blending, real graphics ON by default in live mode (`?terrain=off` / `?objects=off` opt-outs).
      `?map=<id>` is the human sign-off entry (a real-map scene can't be a SceneDefinition — copyrighted
      content can't enter the headless tests; the `?anim` precedent). Synthetic grids keep the approximated
      per-family ground (docs/FIDELITY.md). **Open (deferred):** `lmhe` height shading; `emt3`/`emt4` road/
      house-foundation overlays; per-object growth STATE from map data; `lmpa`/`lmpb` triangle logic types →
      sim water/walkability + object block-area collision (the extracted `landscapeGfx` footprints are the
      input); the `fx wave*` engine-fx records (no drawable bob — placeholder `test_effect.bmd`). Data model
      in docs/SOURCES.md "`map.dat` chunk container" + "Terrain ground graphics + landscape objects".
- **Exit:** click to place one workplace; a settler autonomously supplies it via atomics; a carrier
  hauls outputs to a store; the 1000-tick golden hash + trace stay stable. **(Headless slice + golden
  proven; the real-atlas bind + final human pixel check remain.)**

### Render breadth ladder — more decoded assets on-screen (one category per `/iterate`)
The pipeline already emits atlases for most assets (~80% of the bob `.bmd`s), but the render
(`app/src/real-sprites.ts`) currently draws only settlers + one tree species + one HQ house. This ladder
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

1. [x] **Buildings per-type frame selection** — **LANDED** (single→multi-`.bmd` viking families; human
   pixel sign-off ✓). Each viking building draws its OWN house bob via a data-pinned `(typeId→bob)` join
   (`extractBuildingBobs` → `buildingBobs` IR, **336 rows / 6 tribes**) and a layer-aware
   `BuildingTypeBinding` that resolves the canonical `(family,bob)` per type across viking families (HQ =
   `ls_houses_viking4` bob 34). The IR extract, render-consumes-join, layer-aware `BuildingBobRef` binding,
   and the FIRST viking family (HQ + animal farm / druid hut / barracks / tower) all landed →
   [archive](ROADMAP-ARCHIVE.md). **Remaining:**
   - [x] **Load the rest of the viking families** (`ls_houses_viking2/3` + the `housemiller01`/`housedruid01`
     palette-skins) so every viking building (mill, pottery, joinery, smithy, armory, sewery, mason, school,
     herb hut, temple, …) draws its own bob — added the four families to `BUILDING_FAMILIES` (the single
     source of truth that drives both `loadLayer` and which rows may layer-qualify) + a `?scene=viking-families`
     acceptance scene (mill / smithy / armory / temple, one per new family). At this step the few types on the
     not-yet-loaded `house02` skin (stock / brewery / coin mint) still fell back to the representative house
     (the next sub-item, now landed, closes them). **Human pixel sign-off ✓ (2026-06-30; the focused viking-families scene has since been consolidated into `?scene=all-buildings`).**
   - [ ] **Complete the viking building set — the `house02` skin** (stock / brewery / coin mint, the LAST
     viking types still on the fallback house): **binding LANDED, pending human pixel sign-off.** The two
     `house02` families are now loaded in `BUILDING_FAMILIES` — `ls_houses_viking.house02` (stock 7/8/9) and
     `ls_houses_viking2.house02` (brewery 16, coin mint 33) — so the reducer binds all **40** viking
     `[GfxHouse]` typeIds to their OWN bob with **0 fall-backs** (verified running `buildingBobRefsByType`
     over the real `ir.json`; the previously signed-off five stay byte-identical). These three types now draw
     in the consolidated `?scene=all-buildings` gallery. **Pixel sign-off** folds into that scene's single-pass
     check — confirm stock / brewery / coin mint each draw a distinct, non-placeholder house. → flip to `[x]`
     once confirmed.
   - [ ] **Completeness montage (capstone)** — **Exit gate for "EVERY viking building draws its own bob".**
     **Scene LANDED, pending human pixel sign-off.** `?scene=all-buildings` places all **41** viking building
     types from the committed catalog (`viking-buildings.ts`) at once, real graphics by default, zoomed to
     fit — the whole set verifiable in ONE pass so any wrong/placeholder bob is obvious. It replaces the three
     focused building scenes (building-types / viking-families / viking-house02, now deleted). → flip to `[x]`
     once the single-pass pixel check is confirmed.
   - [ ] **The other tribes** (frank/egypt/saracen/byzantine) — deferred behind the viking set; same
     machinery, the `buildingBobs` table already covers all 6; a per-tribe (or montage) scene; **human
     pixel sign-off**.
2. [ ] **Landscape/resource per-type variety** (render-only) — bushes, signs, wonders, harbours + non-yew
   tree species, each via its own `[GfxLandscape]` bob (today every resource is the single yew). Same recipe
   as rung 1 over the already-emitted `extractLandscapeGraphics` atlases (87 landscape types in IR).
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
   - [ ] **Harvest by resource** — clay (`clayworker_work_shovel`), stone (`stonecrusher_work_stonecrushing`),
     grain (`farmer_work_reap_grain`/`_sow`/`_water`), fish (`fisher_work_fishing`/`_walk_angle`), hunter
     (`hunter_attack_bow`).
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
- [x] **Retained `WorldRenderer` + culling + stress scene** — persistent scene graph: terrain meshed ONCE
      (`setTerrain`), sprites pooled by entity id + reused, textures cached per atlas frame, one `app.render()`
      per frame; pure viewport culling (`viewport.ts`, unit-tested) skips off-screen entities. `?scene=stress-crowd`
      (256×256, ~2.5k bobs) + a live FPS overlay are the human's perf proof; `?scene=all-buildings` enlarged to a
      96×96 field.
- [x] **Terrain chunking + zoom cap (pulled forward)** — terrain is meshed in `TERRAIN_CHUNK_TILES`-square blocks
      each with a world-space AABB; `WorldRenderer.update` toggles `chunk.container.visible` against the viewport,
      so **render cost tracks the screen, not the map** (the RTS rule — OpenRA's visible-cell region; see
      `packages/render/CLAUDE.md`). A whole-map single mesh rasterized off-screen ground every frame; chunking
      removed that. `MIN_ZOOM` raised to `0.15` — the target is a **battle-scale** view (a big slab of a large
      map), NOT fitting a whole 256² map on screen; the floor bounds the visible tile + bob count. Whole-map
      zoom-out would need the LOD rung below.
- [x] **Measured the real bottleneck — it was the SIM, not the renderer.** Profiling `?scene=stress-crowd`
      (per-frame `step` vs `snapshot` vs `render`): **render ≈ 1.2 ms, snapshot ≈ 1.5 ms, sim step ≈ 2400 ms**
      (~480 ms/tick for 2592 idle settlers, 2848 entities total). The stress scene's 1 fps was the sim; a real GPU wouldn't change it.
      Root cause was a PATTERN, not one bug: `aiSystem` and `jobSystem` each looped every unit and scanned
      `world.canonicalEntities()` — which `[...alive].sort()`-ed the whole world **per call** → `O(units² · log n)`.
- [x] **Sim scaling, tier 1 (≈8.5×, 480→57 ms/tick, goldens byte-identical).** (a) `World.canonicalEntities()`
      **memoized per alive-set generation** (invalidated only by `create`/`destroy`) — one sort per tick, not one
      per scan; result is shared + read-only. (b) `aiSystem` + `jobSystem` build **per-tick candidate lists**
      (`canonicalById(world.query(C))`, `systems/shared.ts`) and scan those, not the whole world. jobSystem
      191→26 ms, aiSystem 450→31 ms. Ascending-id order preserved → identical tie-break winner → determinism holds.
- [x] **Sim scaling, tier 2 — idle dormancy + same-tile spatial index (goldens byte-identical).** Final result:
      step **480 → 1.9 ms/tick** at 2848 units (~250×), and the `stress-crowd` browser scene **1 → 92–100 fps** at
      battle-scale zoom / 120 fps (RAF cap) zoomed in, even on headless SwiftShader. Two determinism-safe moves:
      (a) **dormancy gate** — `hasHaulableOutput` decides ONCE per tick whether any carrier work exists; if not,
      idle settlers skip the per-settler `nearestWorkplaceOutput` scan (identical outcome, no per-unit work), so an
      idle crowd costs ~0. (b) **`TileBuckets`** (`systems/shared.ts`) — a per-tick spatial bucket of entities by
      tile; `jobSystem`'s "am I standing on a workplace I staff?" adopt-check is now an O(1) same-tile lookup, not a
      building scan per settler. Both only elide work that provably returns null → same winner → goldens hold.
- [ ] **Sim scaling, tier 3 — full ring-search nearest-X** (smaller now; deferred). `TileBuckets` answers same-tile
      in O(1); the remaining gap is "nearest resource/store when it's NOT on my tile" (still `O(idle · candidates)`).
      Extend `TileBuckets` to a grid ring search (expand Manhattan bands from the unit, finish the whole
      minimum-distance band, pick canonically, short-circuit an empty category). Mitigated today by: busy units are
      already skipped, the dormancy gate skips empty categories, candidate lists bound the scan to matching entities.
      Also still open: **content-index** (`Map` by typeId vs `content.*.find()`), **sim in a Web Worker** (parallel
      to render — snapshot already transferable). Each stays deterministic / golden-guarded.
- [ ] **Zoom-out LOD** (deferred) — below a zoom threshold, freeze per-frame animation and draw simplified
      per-player-tinted markers (a `ParticleContainer`) instead of full bobs, skipping the depth sort. Hooks in
      as a `lodPolicy(camera.scale)` gate in `WorldRenderer.update`. Only needed if we ever want below-`MIN_ZOOM`
      whole-map framing; the battle-scale target does not.
- [ ] **Retained HUD** (deferred) — pool the HUD `Text` rows instead of rebuilding them each frame (the double
      `app.render()` is already gone). Minor; do if the HUD shows up in a profile.

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
      (`needforjob`-gated, `systems/jobs.ts`), each bound per-workplace (`JobAssignment{workplace}`),
      walking to its station, with the demolish path unbinding+idling stranded workers; `vehicletypes`
      extracted + `jobEnablesVehicle` resolved, and `stockSlots` wired so a carrier's batch is sized by the
      largest unlocked vehicle (`carrierCarryCapacity`). **Open (recorded deviation):** the carrier→vehicle
      PAIRING (a per-carrier vehicle entity / cart logistics / per-vehicle carry-filter) is oracle-blocked
      and deferred to a vehicle-entity slice (docs/FIDELITY.md — *Carrier→vehicle pairing*).
- [ ] ConstructionSystem: place → deliver materials → build; **house leveling** → capacity → the
      births→housing loop. **Substance-complete** (→ [archive](ROADMAP-ARCHIVE.md)): the `homeSize` housing
      read model; per-level build-cost extracted from `houses.ini` `[GfxHouse]` `LogicConstructionGoods`
      (`BuildingType.construction`, 53/55 buildings); a `placeBuilding{underConstruction}` site builds when
      its hold accumulates the cost (`constructionSystem`); the carrier path delivers build materials with no
      construction-specific transport code (`stockCapacity`'s site branch); an under-construction workshop
      produces nothing (`productionSystem` gate); a built `home` upgrades a tier when it accumulates the next
      tier's cost, raising `housingCapacity`, with its own delivery branch; the whole births→housing→upgrade
      loop proven composing over the real `step()` (`births-housing-upgrade-loop.test.ts`). Inert on the
      golden (no `home`-kind building). Faithful (build cost is the extracted graphics-table param).
- [ ] **ReproductionSystem** — **landed** (→ [archive](ROADMAP-ARCHIVE.md)): one birth per tribe per tick
      while `tribePopulation < housingCapacity` (the `populationWithinHousing` invariant); a newborn is the
      data-pinned youngest age class (`baby_female`), and `growthSystem` ages it baby→child→adult over
      `GROWUP_TICKS`, then employs it. **Approximated:** birth rate/sex + growth cadence are below the
      readable `.ini` (docs/FIDELITY.md). Inert on the golden (no `home`-kind content → 0 births).
- [ ] HUD: stocks, population, jobs, the goods graph. **Landed** (→ archive): the sim-side read views
      (`tribeStocks`/`tribePopulation`/`tribePopulationByJob`/`goodsGraph`, `systems/shared.ts`) and the
      render-side HUD chain over the frozen snapshot (`buildHud`→`layoutHud`→`placeHud`→`renderHud`,
      `packages/render/src/hud.ts` + `pixi-renderer.ts`), overlaid each frame in `main.ts` + `shot.ts`.
      Pure + total + unit-tested; only the glyph rasterization/typography is left for a human via the shot.
- **Open Phase-3 work** is the three **human-gated render items** (the Phase-1 oracle
  pixel-diffs; the Phase-2 real decoded-bob-atlas bind; the Phase-2 real terrain-tile render) — an
  agent cannot self-judge pixels. The
  economy/progression/population substance is otherwise done; feature work has advanced into Phase 4.
- **Exit:** a self-sustaining, progressing single-tribe settlement you can grow.

## Phase 4 — Conflict & content breadth (N tribes)  ← **current target**
- [ ] CombatSystem from `weapontypes`/`armortypes` (a large subsystem: soldier classes, armor tiers,
      heroes, amulets/potions — scope it honestly). **Substance landed** (→ [archive](ROADMAP-ARCHIVE.md)):
      the `combatDamage` `weapontypes`×`armortypes` net-damage join + the full targeting→`attack`(atomic
      81)→hit→death loop (`combatSystem`/`resolveHit`/`Health` drain/`cleanupSystem`); a combatant resolves
      its per-class join through a worn `Armor{armorClass}` and can **wield a *specific* worn
      `Weapon{weaponTypeId}`** overriding the `(tribe,job)` default (both stamped via `spawnSettler{…}`;
      docs/FIDELITY.md). The data-side **soldier-class→weapon roster join** (`weaponsByJob`/`weaponsForJob`)
      is landed (see "Import full base"). Faithful (net-damage param + atomic id 81). Inert on the golden.
      **Open (oracle-blocked, deferred):** walk-into-melee advance, swing cadence, the weapon-good
      acquire/carry equip drive (which roster weapon a class picks) + the soldier-class→weapon/armor loadout
      binding (docs/FIDELITY.md).
- [x] **N data-defined tribes** (viking/frank/saracen/byzantine/egypt), asymmetry expressed through each
      tribe's atomic bindings + `allow*`/`needfor*` graph — never hardcode "two". **Substance-complete**
      (→ [archive](ROADMAP-ARCHIVE.md)): all 41 `[tribetype]`s extracted, every per-tribe rule resolved off
      `settler.tribe`, and `playableTribes`/`isAnimalTribe` split civilizations from animals **by the tech
      graph alone**. `two-civ-combat.test.ts` runs two playable tribes' **asymmetric** weapon/attack
      bindings through the real `step()` (mace vs sword), deterministic. A combatant is stamped from the
      command data (`spawnSettler{hitpoints,armorClass}`); HP magnitude **approximated** (docs/FIDELITY.md).
      **Open (oracle-blocked, deferred):** tribe-vs-tribe diplomacy/alliances, soldier-class→armor-tier
      content binding.
- [x] **Animals as non-controllable tribes** (`animaltypes.ini`: aggression, groups, hitpoints) —
      **substance-complete** (→ [archive](ROADMAP-ARCHIVE.md)). All 35 creature tribes extracted and
      **every** field consumed: the aggression inputs drive the `mayAttack` relation / `Anger{until}` timer
      / `Health` stamp / `mayHunt` predation; animals spawn as herds (`spawnAnimalHerd`/`HerdMember`),
      fight (jobless animal → weapon-by-tribe, reach honored), a hunter's killing blow yields the carcass's
      meat (`harvest_cadaver`), and a creature walks at its data-pinned `movespeed` pace (`MoveSpeed` +
      `movementSystem`, `runspeed` gait stamped inert). Every `animaltypes.ini` field has a sim read view
      (`herdParams`/`locomotionOf`/`animalHitpoints`/`animalBabyHitpoints`/`isWarrantableAnimal`/
      `ignoresHousesAnimal`). Proven by `populated-map-combat.test.ts` (deterministic). Faithful to the
      hitpoint/`movespeed` magnitudes; the scale **direction** + the flee/charge/target/swing-cadence
      DRIVES are **approximated/deferred** (no oracle; docs/FIDELITY.md "Animal locomotion pace").
- [ ] **Sea/Northland identity:** water valency, boats as mobile stores, embark/disembark atomics,
      `fisher_sea`/`trader_sea`/`carpenter ship`, `vehicle_ship`. **First steps landed** (→
      [archive](ROADMAP-ARCHIVE.md)): the `vehicle_ship` rows + each hold's cargo allow-list + the
      `logicSize` footprint class classified by the data alone (`shipVehicles`/`vehicleMayCarry`/
      `vehicleSizeOf` — completing vehicle-record read-view coverage), the ships a tribe has UNLOCKED
      (`tribeShipsUnlocked`), a placed boat-hull ENTITY carrying a `Stockpile` (`placeBoat`) with its
      cargo-LOAD gate inherited through `stockCapacity`, the `fisher_sea`/`trader_sea` jobs by the `_sea`
      suffix (`seaJobs`), and the landscape `allowedon{land,water,everything}` placement-layer triple
      (`systems/readviews/landscape.ts`). **Open:** water-VALENCY terrain — which CELLS are water is now
      **decode-UNBLOCKED** (the map-import slice pinned `lmpa`/`lmpb` = per-triangle
      `trianglepatterntypes` logic ids carrying `iswater`/`humancanwalkon`; a decoded map's ground
      patterns also carry `logicType` — the remaining work is emitting a water lane + consuming it in
      `buildTerrainGraph`), boat movement + embark/disembark atomics (no such atomic in the readable
      `.ini`), and the sea-job BEHAVIOR (a sea worker reaching its station by boat — rides on boat movement).
- [ ] Import full base + `culturesnation` content; bring over the mod's balance edits (data).
      **Substance-complete** (→ [archive](ROADMAP-ARCHIVE.md)): the mod ships NO overriding base
      `Data/logic` type tables (verified on disk), so there is no logic-table overlay merge; the pipeline
      reads each rule table from its single readable source. The mod's readable overlays are all landed —
      the `jobgraphics.ini` cart/ship recolours (`resolveGraphicsBindings`), the `houses.ini` per-level
      build cost (`extractConstructionCosts`, the only balance datum, 53/55), and the `types/weapons.ini`
      weapon fields (`goodType`/`mainType`/`weight`/`munitionType`/`damageType`/`jobType`). Every
      extracted field on the weapon/armor, atomic-animation, vehicle, landscape-placement, and animal
      tables now has a **sim read view** (the data-extraction vein, exhausted; the full per-table
      inventory is in the archive). **Open:** the behaviours those read views seed are all oracle-blocked
      (no mechanics oracle — docs/FIDELITY.md); the file's graphics/coords + render-side timing/cue
      channels are render-atlas overlays.
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
- [ ] **Run the sim in a Web Worker.** Move `step()` off the main thread (it's pure/headless/deterministic)
      so render stays 60fps under heavy ticks. **Transferability PINNED** → [archive](ROADMAP-ARCHIVE.md): a
      real `step()`-driven `WorldSnapshot` round-trips through `structuredClone`/`postMessage` deep-equal +
      byte-identical (no functions/class instances/live `Map`s). **Open:** the app-side Worker wiring (host↔
      worker protocol, render reading the transferred snapshot) — an `app`/`render` concern.
- [ ] **Time-travel / replay inspector.** Scrub ticks, diff state between two ticks, dump an entity —
      "hash diverged at tick N → jump there → inspect." **Headless core fully landed** →
      [archive](ROADMAP-ARCHIVE.md): pure `replay()` (exact state at any tick), the `HashTrace` ring buffer +
      `divergedFrom` (localize the first split without re-replaying), `diffSnapshots`, `dumpEntity`/
      `traceEntity`, `localizeDivergence` (the end-to-end diverged-at-N→diff workflow), and `scrubWindow` (a
      contiguous snapshot window in one forward pass) — all oracle'd by `hashState()` byte-equality. **Open:**
      the dev OVERLAY wiring scrub/diff/dump into UI (a `render` concern, human-eyed).
- [ ] **Content hot-reload.** Wire Vite HMR to re-parse validated content JSON and rebase the sim on file
      change → instant balance-tweak feedback, no rebuild. **Headless core landed** →
      [archive](ROADMAP-ARCHIVE.md): pure `rebaseContent(raw, {seed,map?,log,untilTick?})` validates via
      `parseContentSet` and replays the command log into a fresh sim under the new rules (same history, new
      rules); bad content returns a typed error without touching shared stores. Reversible + deterministic,
      dual-oracle'd by hash. **Open:** the Vite-HMR glue that watches the file and calls this (an `app`/
      `render` concern), plus a future-ticks-only reload policy.

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
