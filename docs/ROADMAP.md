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
- **Exit:** click to place one workplace; a settler autonomously supplies it via atomics; a carrier
  hauls outputs to a store; the 1000-tick golden hash + trace stay stable. **(Headless slice + golden
  proven; the real-atlas bind + final human pixel check remain.)**

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
- [ ] ConstructionSystem: place → deliver materials → build; **house leveling** (`home level 00..04`) →
      capacity → the births→housing loop. **Landed** (→ archive): the `homeSize` housing read model
      (`housingCapacity`/`tribePopulation`, `systems/shared.ts`); a placed building is immediately built.
      **Build-cost DATA now LANDED** (→ `BuildingType.construction` + `extractConstructionCosts`): the
      per-level build-material cost (and the home level chain typeIds 2..6, each its own tier cost) is
      extracted from the **graphics** table `DataCnmd/budynki12/houses/houses.ini` (`[GfxHouse]`
      `LogicConstructionGoods`) — correcting the earlier "the cost lives below the `.ini`" claim, which
      conflated the logic table (`types/houses.ini`, no cost key) with its graphics twin. Overlaid onto
      buildings by `typeId`, run-length-encoded to `{goodType, amount}`, cross-checked against goods;
      53/55 buildings carry a cost (HQ + one omitted type free). Per-tribe cost spread collapsed to the
      reference tribe (docs/FIDELITY.md). **Build-completion behavior now LANDED** (→ `constructionSystem`,
      `systems/construction.ts` — graduated from the stub): a building placed `underConstruction` (a new
      `placeBuilding{underConstruction}` flag, the opt-in richer entity like `spawnSettler{hitpoints}`)
      enters at `built = 0` with an empty hold; once its own stockpile holds the full `construction`
      material cost the system **consumes** those materials and flips `built` to `ONE`, emitting
      `buildingFinished` (the construction analogue of production's consume-inputs→deposit-outputs cycle;
      a free type — HQ, empty cost — finishes on the first tick). Proven by `construction-system.test.ts`
      (8 cases: partial-cost waits, full-cost builds+consumes, surplus left, free type, never-revisit-a-built,
      determinism, the command path) + hands-on over the real `step()` schedule. The `housingCapacity`
      gate already counted only `built >= ONE` homes, so a finished home now joins housing with no extra
      wiring. **Material-DELIVERY dispatch now LANDED** (→ `stockCapacity`'s under-construction branch,
      `systems/shared.ts`): a `built < ONE` building advertises room for *exactly* its outstanding
      `construction` materials (capacity = the cost-line amount, 0 for any non-material or already-full
      good), so the EXISTING carrier path (`nearestStoreFor` → `MoveGoal` → `pileup`) hauls the build
      goods to the site with **no construction-specific transport code** — a carrier carrying a needed
      good walks to the site, deposits it (capped at the need), and once the full cost lands the
      `constructionSystem` finishes it the same tick. A built building reverts to its normal stock-slot
      capacity, so it stops attracting materials. Proven by `construction-system.test.ts` (3 new cases:
      single-good sink, end-to-end full-cost build via three loaded carriers, determinism) over the real
      `step()` schedule. **Open (still our design, no oracle):** the **home level-up** trigger (a built
      home consuming the next tier's cost to upgrade `level` → larger `homeSize`).
- [ ] **ReproductionSystem** — **landed** (→ archive): one birth per tribe per tick while
      `tribePopulation < housingCapacity` (deterministic cadence, the `populationWithinHousing` invariant);
      a newborn is the data-pinned youngest age class (`baby_female`), `systems/ageclass.ts` recognizes the
      non-working age classes (ids 1–4), and `growthSystem` ages a born settler (the `Age` component)
      baby→child→adult over `GROWUP_TICKS`, sex preserved, then employs it. **Approximated:** birth
      rate/sex + growth cadence are below the readable `.ini` (docs/FIDELITY.md). Inert on the golden (no
      `home`-kind content → 0 births).
- [ ] HUD: stocks, population, jobs, the goods graph. **Landed** (→ archive): the sim-side read views
      (`tribeStocks`/`tribePopulation`/`tribePopulationByJob`/`goodsGraph`, `systems/shared.ts`) and the
      render-side HUD chain over the frozen snapshot (`buildHud`→`layoutHud`→`placeHud`→`renderHud`,
      `packages/render/src/hud.ts` + `pixi-renderer.ts`), overlaid each frame in `main.ts` + `shot.ts`.
      Pure + total + unit-tested; only the glyph rasterization/typography is left for a human via the shot.
- **Open Phase-3 work** is the two long-standing **human-gated render items** (the Phase-1 oracle
  pixel-diffs; the Phase-2 real decoded-bob-atlas bind) — an agent cannot self-judge pixels. The
  economy/progression/population substance is otherwise done; feature work has advanced into Phase 4.
- **Exit:** a self-sustaining, progressing single-tribe settlement you can grow.

## Phase 4 — Conflict & content breadth (N tribes)  ← **current target**
- [ ] CombatSystem from `weapontypes`/`armortypes` (a large subsystem: soldier classes, armor tiers,
      heroes, amulets/potions — scope it honestly). **Substance landed** (→ [archive](ROADMAP-ARCHIVE.md)):
      `armortypes` extracted + the `combatDamage(content)` read view (the verbatim `weapontypes`×`armortypes`
      net-damage join, all 105 weapons, out-of-table classes treated unarmored); the full
      targeting→`attack`(atomic 81)→hit→death loop (`combatSystem` + the `resolveHit`/`Health{hitpoints}`
      drain + `cleanupSystem` reaping a 0-HP entity, `settlerDied` emitted). Faithful (net-damage param +
      atomic id 81). **Armor-on-a-settler now LANDED:** a combatant may wear an `Armor{armorClass}` tier
      (stamped via `spawnSettler{armorClass}`), and a hit resolves the per-class `damage[targetClass] −
      blockingValue` join, not always class 0 (docs/FIDELITY.md "Settler-side Armor stamping"). **Deferred
      refinements** (walk-into-melee advance, swing cadence, soldier-class→armor binding — ride on later
      items + an oracle; docs/FIDELITY.md). Inert on the golden (no settler carries `Health`/`Armor`).
- [x] **N data-defined tribes** (viking/frank/saracen/byzantine/egypt), asymmetry expressed through each
      tribe's atomic bindings + `allow*`/`needfor*` graph — never hardcode "two". **Substance-complete**
      (→ [archive](ROADMAP-ARCHIVE.md) for the scaffolding narrative): all 41 `[tribetype]`s extracted, every
      per-tribe rule resolved off `settler.tribe` (tribe-agnostic by construction), and the
      `playableTribes`/`isPlayableTribe`/`isAnimalTribe` read views distinguish controllable civilizations
      from animals **by the tech graph alone** (only a civilization carries `jobEnables` edges) — wired into
      combat targeting so a civ doesn't mis-fire the PvP rule on wildlife. The **multi-civilization scenario
      now runs end-to-end** (`two-civ-combat.test.ts`): two playable tribes wielding **asymmetric** weapon +
      attack-animation bindings fight each other through the real `step()` schedule — each resolves ITS OWN
      `weapontypes` damage/reach + `setatomic 81` swing duration off `settler.tribe` (viking mace 50/reach2/dur4
      vs saxon sword 30/reach3/dur6), the fight is mutual, a frail side is felled+reaped, and the skirmish is
      deterministic. The asymmetry is purely in the data; a real N-tribe set is the same shape with more rows.
      **Settler-side `Health` stamping now LANDED:** a civilization becomes a **combatant FROM THE COMMAND
      DATA** — `spawnSettler{hitpoints}` stamps a `Health` pool through the one mutation seam (the settler
      analogue of `spawnAnimalHerd`'s `hitpoints_adult`), so a fighter no longer needs a test reaching into
      the world; omitting `hitpoints` leaves a non-combatant (golden untouched). The HP **magnitude is
      approximated** — humans' hitpoints are below the readable `.ini` (the engine manages them via
      `atomicanimations` CHANGE_HITPOINTS events; docs/FIDELITY.md "Settler-side Health stamping").
      **Settler ARMOR now LANDED:** a combatant carries an optional `Armor{armorClass}` (stamped via
      `spawnSettler{armorClass}`), and a hit resolves the per-class `weapontypes`×`armortypes` net-damage
      join against the target's worn class rather than always class 0 (docs/FIDELITY.md "Settler-side Armor
      stamping"). **Open (oracle-blocked, deferred):** tribe-vs-tribe diplomacy/alliances, and the
      soldier-class→armor-tier content binding (which job/unit wears which class — caller-supplied for now).
- [x] **Animals as non-controllable tribes** (`animaltypes.ini`: aggression, groups, hitpoints) —
      **substance-complete** (→ [archive](ROADMAP-ARCHIVE.md) for the full landed-narrative). The
      `animaltypes.ini` table (35 creature tribes, keyed on `tribetype`) is extracted, and **every**
      aggression input is consumed: `aggressive`/`cannotbeattacked` (the `mayAttack` civ⇄animal hostility
      relation), `getAngry`/`angryGameTime` (the provoked-anger `Anger{until}` timer), `hitpoints_adult`
      (the `Health` stamp), `catchable` (the hunter-strike predation relation `mayHunt`, the real
      provocation source). Animals spawn as herds (`spawnAnimalHerd` + the `seedAnimalHerds` map
      populator + the `HerdMember` follow-the-leader drive), do damage (jobless animal → weapon-by-tribe),
      and a weapon's `[minRange,maxRange]` reach band is honored. A hunter's **killing blow on catchable
      prey now yields the carcass's meat** (the `harvest_cadaver` payoff: `cadaverYieldOf` `maximumcadaversize`
      meat → the slayer's back, good 21). End-to-end proven by `populated-map-combat.test.ts`
      (seed→combat→hit→death, deterministic). Faithful to the named params; target-acquisition /
      swing-cadence / in-place-strike / separate-walk-to-corpse-`harvest_cadaver`-atomic approximations
      recorded in docs/FIDELITY.md.
- [ ] **Sea/Northland identity:** water valency, boats as mobile stores, embark/disembark atomics,
      `fisher_sea`/`trader_sea`/`carpenter ship`, `vehicle_ship`. **First step landed** (→ the
      `shipVehicles`/`isShipVehicle`/`largestShipCapacity` read view, `systems/readviews/vehicles.ts`):
      the `vehicle_ship` rows are classified out of `content.vehicles` **by the data alone** (a vehicle
      that carries passengers, `passengerSlots > 0` — the two ships are also the only `logicSize 2` rows),
      sorted by typeId, with the largest ship `stockSlots` exposed as the "boat as mobile store" hold
      (50/200). Proven over the **real IR** (2 ships out of 6 vehicles, `largestShipCapacity 200`).
      **Ship-unlock tech gate now LANDED** (→ `tribeShipsUnlocked`, `systems/progression.ts`): the ships
      a tribe has currently UNLOCKED — `isShipVehicle` ∩ the SAME `jobEnablesVehicle` `vehicle`-kind gate
      `carrierCarryCapacity` uses (`tribeUnlockEnabled`) — so a boat-building/embark slice can ask which
      hulls a tribe may field. In the **real IR** both ships are GATED (job 9 enables ships 3 & 4), so a
      tribe with no settlers fields zero ships; spawning a job-9 settler flips the unlocked set to `[3,4]`.
      **Cargo allow-list now LANDED** (→ `VehicleType.cargoGoods` + `vehicleCargoGoods`/`vehicleMayCarry`,
      `systems/readviews/vehicles.ts`): `extractVehicles` pulls each vehicle's `logicgood` allow-list (the
      goodtype ids a hold may carry — WHAT a boat-as-mobile-store holds, distinct from `stockSlots`' how
      *much*), and the read side gives the per-hold load gate. In the **real IR** both ships + all 3 carts
      enumerate 49 cargo goods, the catapult none.
      **Boat-hull ENTITY now LANDED** (→ `placeBoat` command + the `Vehicle{vehicleType,tribe}` component,
      `systems/command.ts`): a placed hull carrying an (empty) `Stockpile` — the "boats as mobile stores"
      entity, the boat analogue of `placeBuilding`, entering the world through the one mutation seam. Gated
      by `tribeShipsUnlocked` (only a `vehicle_ship` row the tribe has UNLOCKED is fielded; a cart/catapult/
      unknown/locked type is skipped, still logged), so a hull always references a ship the tribe may field.
      Proven by `place-boat.test.ts` through the real `step()` schedule (place ungated ship / gate-then-unlock
      a shipwright ship / refuse cart+unknown+wrong-tribe / deterministic). The hull is a STATIC store for now.
      **Cargo-LOAD gate now LANDED** (→ `stockCapacity`'s Vehicle branch, `systems/shared.ts`): hauling a
      good INTO a hull's `Stockpile` is filtered by the ship's `VehicleType` — a `cargoGoods` (`logicgood`)
      good gets the whole `stockSlots` hold capacity, a forbidden good gets 0 (refused), so a carrier never
      deposits an unhaulable good into a boat. The existing `nearestStoreFor`+`pileup` deposit path routes
      through `stockCapacity` unchanged, so the load gate is inherited with NO new system — the load half of
      the empty hull. Proven by `boat-cargo-load.test.ts` (deposit a carryable plank / refuse a forbidden
      good / never over-fill the hold / deterministic) + hands-on over the real IR (`ship_big#4` resolves
      capacity 200 for a carryable good, 0 for a forbidden one). The carrier carry-BATCH filter (sizing a
      haul by the cart's allow-list) stays deferred with the cart entity (docs/FIDELITY.md — *Carrier→vehicle
      pairing* (a)).
      **Sea-job read view now LANDED** (→ `seaJobs`/`isSeaJob`, `systems/readviews/jobs.ts`): the
      `fisher_sea`/`trader_sea` water trades classified out of `content.jobs` **by the data alone** (the
      `_sea` id suffix the `jobtypes` data carries — the sea variants are distinct jobtypes whose only
      extracted distinguisher from their land counterparts is the name, their atomics coming per-tribe via
      `setatomic`), sorted by typeId. The job-side analogue of `shipVehicles`. In the **real IR** the
      suffix isolates EXACTLY `fisher_sea#23` and `trader_sea#26` out of 55 jobs (no false positives), and
      a [3826bab] *distinguishable-before-planning* check confirmed no other extracted param splits sea
      from land (so the data's name is the discriminator, not an invented flag).
      **Open:** water-valency terrain (which cells a ship floats on — map-decode-blocked, the water
      surface lives in the triangle/terrain grid, not a `landscapetypes.ini` flag), boat movement +
      embark/disembark atomics (no embark/disembark atomic exists in the mod `.ini` — that vocabulary is
      below the readable data, deferred with movement), and the sea-job BEHAVIOR (a sea worker reaching
      its fishing/trading station by boat — rides on boat movement).
- [ ] Import full base + `culturesnation` content; bring over the mod's balance edits (data).
      **Scoped (corrected):** the mod does NOT ship overriding copies of the base `Data/logic` type
      tables (no `goodtypes`/`jobtypes`/`landscapetypes`/`vehicletypes`/`armortypes`/`animaltypes`.ini
      under `DataCnmd` — verified on disk), so there is no logic-table overlay merge to do; the
      pipeline already reads each rule table from its single readable source. The mod's *readable*
      contribution is its richer **graphics + tribe + house + weapon + atomic** `.ini`s, most of which
      the pipeline already prefers (golden rule #4). **First overlay landed** (→ `resolveGraphicsBindings`):
      the mod's `types/vehiclestype/jobgraphics.ini` `[jobgraphics]` cart/ship recolours now overlay the
      base `vehicles/jobgraphics.cif` (22 records across tribes 1..4 vs the base's 6 across tribes 1 & 4),
      mirroring the existing humans overlay; `convertBmdTree` keys atlases on `(bmd, palette)` so the
      base pairs (a subset) emit the same atlas files while the mod gains the extra tribes' cross-refs.
      Proven over the **real IR** (vehicle-bmd bindings 6→28, now spanning all four base tribes; 5
      distinct atlas keys unchanged). **Second overlay landed** (→ `extractConstructionCosts`,
      `BuildingType.construction`): the mod's `budynki12/houses/houses.ini` is NOT purely graphics —
      its `[GfxHouse]` records carry the per-level `LogicConstructionGoods` **build-material cost** (and
      the home level chain), now extracted and overlaid onto the logic-table buildings by `typeId`
      (53/55 buildings get a cost). This corrects the earlier scoping that deferred the whole file as
      render-only. **Open:** the file's actual graphics/coords (`GfxBobId`/`GfxFirePoint`/walk-block
      areas) + `animation/.../animations.ini` are render/animation overlays for the render-atlas leg,
      not balance data — deferred with the render-atlas work (the only balance datum the file held was
      the construction cost, now imported).
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
- [ ] **Run the sim in a Web Worker.** It's pure/headless/deterministic, so moving `step()` off the
      main thread keeps render at 60fps under heavy ticks. Design the Phase-2 snapshot as a plain
      **transferable** structure (no class instances / live `Map`s) so this is free later, not a retrofit.
- [ ] **Time-travel / replay inspector.** With `rng.getState/setState`, the command log, and
      `hashState`, a dev overlay can scrub ticks, diff state between two ticks, and dump an entity.
      "Hash diverged at tick 432" → jump there → inspect. Biggest debuggability multiplier for agents.
- [ ] **Content hot-reload.** Content is validated JSON injected into the sim; wire Vite HMR to
      re-parse and rebase the sim on file change → instant balance-tweak feedback, no rebuild.

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
