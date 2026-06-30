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
- [x] **Render terrain from real landscape ground textures** — **LANDED (approximated, behind `?terrain`).**
      Real decoded `text_*.pcx` ground (meadow grass + rock) draws per cell instead of the flat 4-colour tint
      (human pixel-check done). **Placement is APPROXIMATED** (docs/FIDELITY.md): the 1:1 pattern algorithm is
      oracle-blocked, so every cell of a landscape family draws the same representative tile. Pipeline
      patterns/triangle-types + typeId→pattern map + the batched-`Mesh` textured ground + the `?terrain`
      app/shot flag all landed → [archive](ROADMAP-ARCHIVE.md). **Open (deferred):** per-cell variety; water-
      surface cells (map-decode-blocked, Phase 4 Sea/Northland); terrain-mesh caching. Data model in
      docs/SOURCES.md "Terrain ground graphics + landscape objects".
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
> girl, baby, and the viking-specific civ body). (1) Finish the viking **buildings** (rung 1's `house02` skin
> → all viking `[GfxHouse]` types draw their own bob). (2) Add **multi-body render support**, then bind the
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
     acceptance scene (mill / smithy / armory / temple, one per new family). The few types on the
     not-yet-loaded `house02` skin (stock / brewery / coin mint) still fall back to the representative house
     (the next sub-item closes them). **Human pixel sign-off ✓ (2026-06-30, `?scene=viking-families&atlas=real`).**
   - [ ] **Complete the viking building set — the `house02` skin** (stock / brewery / coin mint, the LAST
     viking types still on the fallback house): load the `ls_houses_viking*.house02` family so they draw
     their OWN bob. Same recipe — resolve the `(bmd, house02)` pair(s) from `buildingBobs`, add to
     `BUILDING_FAMILIES`, extend a scene, **human pixel sign-off**. **Exit = EVERY viking building draws its
     own bob** — prove it with a completeness scene/montage of all viking `[GfxHouse]` types where NONE
     falls back to the placeholder.
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
      (`systems/readviews/landscape.ts`). **Open:** water-VALENCY terrain (which CELLS are water —
      map-decode-blocked; the water surface lives in the triangle/terrain grid, not a `landscapetypes.ini`
      flag), boat movement + embark/disembark atomics (no such atomic in the readable `.ini`), and the
      sea-job BEHAVIOR (a sea worker reaching its station by boat — rides on boat movement).
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
- [ ] Audio (transcoded ogg; no DirectMusic `.sgt`/`.dls` dependency).
- [ ] Tauri desktop builds for Mac/Win/Linux (renderer stays WebView-compatible).
- [ ] (Stretch) lockstep multiplayer — the determinism work pays off here.

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
