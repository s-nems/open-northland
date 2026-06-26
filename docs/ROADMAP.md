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
- **Open Phase-3 work** is the two long-standing **human-gated render items** (the Phase-1 oracle
  pixel-diffs; the Phase-2 real decoded-bob-atlas bind) — an agent cannot self-judge pixels. The
  economy/progression/population substance is otherwise done; feature work has advanced into Phase 4.
- **Exit:** a self-sustaining, progressing single-tribe settlement you can grow.

## Phase 4 — Conflict & content breadth (N tribes)  ← **current target**
- [ ] CombatSystem from `weapontypes`/`armortypes` (a large subsystem: soldier classes, armor tiers,
      heroes, amulets/potions — scope it honestly). **Substance landed** (→ [archive](ROADMAP-ARCHIVE.md)):
      the `combatDamage` `weapontypes`×`armortypes` net-damage join + the full targeting→`attack`(atomic
      81)→hit→death loop (`combatSystem`/`resolveHit`/`Health` drain/`cleanupSystem`), and a combatant's
      worn `Armor{armorClass}` resolving the per-class join (`spawnSettler{armorClass}`). Faithful
      (net-damage param + atomic id 81). The data-side **soldier-class→weapon roster join** now lands
      (`weaponsByJob`/`weaponsForJob` off each weapon's `jobtype` — see the "Import full base" item); only
      the *equip behavior* (a settler of that job actually holding the weapon) stays oracle-blocked. **Open
      (oracle-blocked, deferred):** walk-into-melee advance, swing cadence, the equip drive +
      soldier-class→armor binding (docs/FIDELITY.md). Inert on the golden.
- [x] **N data-defined tribes** (viking/frank/saracen/byzantine/egypt), asymmetry expressed through each
      tribe's atomic bindings + `allow*`/`needfor*` graph — never hardcode "two". **Substance-complete**
      (→ [archive](ROADMAP-ARCHIVE.md)): all 41 `[tribetype]`s extracted, every per-tribe rule resolved off
      `settler.tribe` (tribe-agnostic by construction), and the `playableTribes`/`isAnimalTribe` read views
      split civilizations from animals **by the tech graph alone**. A multi-civilization scenario
      (`two-civ-combat.test.ts`) runs two playable tribes' **asymmetric** weapon/attack bindings through the
      real `step()` (mace vs sword, each off `settler.tribe`), deterministic. A combatant is stamped FROM THE
      COMMAND DATA — `spawnSettler{hitpoints,armorClass}` (the settler analogue of `spawnAnimalHerd`). HP
      magnitude is **approximated** (below the readable `.ini`; docs/FIDELITY.md). **Open (oracle-blocked,
      deferred):** tribe-vs-tribe diplomacy/alliances, and the soldier-class→armor-tier content binding.
- [x] **Animals as non-controllable tribes** (`animaltypes.ini`: aggression, groups, hitpoints) —
      **substance-complete** (→ [archive](ROADMAP-ARCHIVE.md)). The `animaltypes.ini` table (35 creature
      tribes, keyed on `tribetype`) is extracted and **every** aggression input is consumed: `aggressive`/
      `cannotbeattacked` (the `mayAttack` civ⇄animal relation), `getAngry`/`angryGameTime` (the `Anger{until}`
      timer), `hitpoints_adult` (the `Health` stamp), `catchable` (the `mayHunt` predation relation). Animals
      spawn as herds (`spawnAnimalHerd`/`seedAnimalHerds`/`HerdMember`), fight (jobless animal → weapon-by-tribe,
      `[minRange,maxRange]` reach honored), and a hunter's killing blow yields the carcass's meat
      (`harvest_cadaver`/`cadaverYieldOf`). Proven by `populated-map-combat.test.ts` (seed→combat→hit→death,
      deterministic). Herd/locomotion params surfaced as read views (`herdParams`/`locomotionOf`); the
      **`hitpoints_baby`** life-stage twin of `animalHitpoints` also gets a read view now
      (`animalBabyHitpoints` — the juvenile `Health` pool a spawned baby carries until it ages to the
      adult, read straight off the source's independently-carried baby pool, e.g. wolf baby 500 vs adult
      1000; the deferred animal-growth slice's seed). The **last two unconsumed flags** `warrantable`
      (livestock-ownership) and `ignorehouses` (pathing-through-buildings) now each have a read view too
      (`isWarrantableAnimal`/`ignoresHousesAnimal`, 20/35 + 1/35 over the real IR), which **closes the
      animal-record consumer coverage — every extracted `animaltypes.ini` field now has a sim read view**
      (the behaviours these seed stay deferred). A
      creature walks at its own data-pinned `movespeed` pace (`MoveSpeed{perTick}` + `movementSystem`), with
      its faster `runspeed` gait also stamped (`runPerTick`, inert until a flee/charge drive reads it).
      Faithful to the `movespeed`/`runspeed` magnitudes; the scale **direction** (larger = slower) and the
      flee/charge DRIVE, target-acquisition, swing-cadence, in-place-strike are **approximated/deferred**
      (no oracle; docs/FIDELITY.md "Animal locomotion pace").
- [ ] **Sea/Northland identity:** water valency, boats as mobile stores, embark/disembark atomics,
      `fisher_sea`/`trader_sea`/`carpenter ship`, `vehicle_ship`. **First steps landed** (→
      [archive](ROADMAP-ARCHIVE.md), `systems/readviews/vehicles.ts` + `jobs.ts` + `command.ts` +
      `shared.ts`): the `vehicle_ship` rows classified by the data alone (`shipVehicles`/`largestShipCapacity`,
      2/6 vehicles), the ships a tribe has UNLOCKED via the `jobEnablesVehicle` gate (`tribeShipsUnlocked`),
      each hold's `logicgood` cargo allow-list (`VehicleType.cargoGoods`/`vehicleMayCarry`), a placed boat-hull
      ENTITY carrying a `Stockpile` (`placeBoat` + `Vehicle{vehicleType,tribe}`, gated by the unlocked set),
      the cargo-LOAD gate filtering a haul into a hull by the ship's allow-list (inherited through
      `stockCapacity` with no new system), the `fisher_sea`/`trader_sea` jobs classified by the `_sea`
      id-suffix (`seaJobs`), and a vehicle's `logicSize` footprint class (`vehicleSizeOf`,
      `systems/readviews/vehicles.ts` — `{0:cart, 1:catapult, 2:ship}` over the real 6, a third independent
      ship signal converging with `passengerSlots`/`logiccommander`; the deferred placement/tile-occupancy
      drive's seed), which **completes the vehicle-record consumer coverage** (every extracted vehicle field
      — `stockSlots`/`passengerSlots`/`cargoGoods`/`logicSize` — now has a sim read view). The landscape **placement-LAYER** flags now have a consumer too
      (`systems/readviews/landscape.ts`), the **full `allowedon{land,water,everything}` triple**:
      `landLayerLandscape`/`isLandLayerType` (the `allowedonland` rows — the 86 land types, everything but
      the layer-agnostic `void`), `waterLayerLandscape`/`isWaterLayerType` (the `allowedonwater`
      rows — exactly the 3 wall/gate structures that span water in the real IR) and
      `universalLayerLandscape`/`isUniversalLayerType` (the `allowedoneverything` rows — exactly the `void`
      empty-terrain type), read straight off the genuinely-extracted ints (`walkable`/`buildable` are schema
      defaults, not these flags); land(86)+universal(1) partition the 87 rows exactly, **closing the
      placement-layer consumer coverage**. This is the placement-side seed — distinct from water-VALENCY
      terrain below. All proven over the real IR. **Open:** water-valency terrain
      (which CELLS are water — map-decode-blocked; the water surface lives in the triangle/terrain grid, not a
      `landscapetypes.ini` flag — the placement-layer flag above is the type-table half, not the cell half),
      boat movement + embark/disembark atomics (no such atomic in the readable `.ini` — deferred with
      movement), and the sea-job BEHAVIOR (a sea worker reaching its station by boat — rides on boat movement).
- [ ] Import full base + `culturesnation` content; bring over the mod's balance edits (data).
      **Scoped (corrected):** the mod ships NO overriding copies of the base `Data/logic` type tables
      (verified on disk), so there is no logic-table overlay merge — the pipeline already reads each rule
      table from its single readable source. The mod's readable contribution is its richer graphics/tribe/
      house/weapon/atomic `.ini`s, most already preferred (golden rule #4). **Overlays landed** (→
      [archive](ROADMAP-ARCHIVE.md)): the mod's `jobgraphics.ini` cart/ship recolours overlay the base
      `.cif` (`resolveGraphicsBindings`, vehicle bindings 6→28 across all four tribes), `houses.ini`'s
      `[GfxHouse]` `LogicConstructionGoods` **build cost** is extracted onto buildings by `typeId`
      (`extractConstructionCosts`, 53/55), and the mod's `types/weapons.ini` `goodtype` — the good that IS
      each weapon — is now extracted onto `WeaponType.goodType` (cross-ref-resolved; 70/105 to a real good,
      35 natural-weapon `goodtype 0` sentinels dropped to undefined), the weapon-side twin of the armor
      `goodType` join, **plus the weapon's `mainType` (coarse weapon class) + `weight` (encumbrance)** onto
      `WeaponType.mainType`/`weight` (all 105 weapons; the `mainType`/`weight` twins of the armor record —
      the soldier-class→weapon-class binding prerequisite, captured ahead of its drive), **and the weapon's
      `munitiontype` (the ranged-ammo class: 1=bow ammo / 2=catapult projectile)** onto
      `WeaponType.munitionType` (30/105 — the 5 bow types + catapult; absent on melee, so it doubles as the
      "is ranged" marker for the deferred ranged-attack drive), **and the weapon's `damagetype` (the
      siege/damage class)** onto `WeaponType.damageType` (5/105 — catapult-only, value 2; the all-lowercase
      twin of `munitiontype`, marking the AoE damage class for the deferred combat-resolution drive). **The
      `munitionType`/`damageType` markers now have a CONSUMER:** the `isRangedWeapon`/`rangedWeapons` +
      `isSiegeWeapon`/`siegeWeapons` read views (`systems/readviews/combat.ts`) classify the weapon table by
      those markers *by the data alone* (30 ranged = 25 bows + 5 catapults, 5 siege = the catapults; siege ⊆
      ranged) — the weapon twin of `isShipVehicle`/`shipVehicles`, the data-defined seed the deferred
      ranged/siege drives switch on. **The third (multi-valued) marker `mainType` is now also consumed:**
      `weaponClassOf`/`weaponsByClass` group all 105 weapons by their coarse class into a lossless
      `Map<mainType, WeaponType[]>` (7 classes `{1:25,2:15,3:20,4:10,5:5,6:25,7:5}`) — a grouping, not a
      filter (every weapon carries a `mainType`); the seed the deferred soldier-class→weapon-class roster
      binding joins on. The weapon-marker classification family is now complete, and **the armor-side twin
      mirrors it** (`armorClassOf`/`armorByClass`, `systems/readviews/combat.ts`): the same multi-valued
      `mainType` grouping over `content.armor` (`Map<mainType, ArmorType[]>`, 4 records → 2 classes — light
      `{woolen,leather}`, heavy `{chain,plate}` — read straight from `armortypes.ini`'s `mainType {1,1,2,2}`),
      so both combat tables expose their coarse class identically — the data-defined seed the deferred
      soldier-class→armor-tier binding joins on. **The finer material-tier axis now lands too**
      (`armorMaterialOf`/`armorByMaterial`, `systems/readviews/combat.ts`): the same grouping over the armor's
      `materialType` (`{1,2,3,4}` — cloth/leather/chain/plate, all distinct in the real data, vs `mainType`'s
      collapsing `{1,1,2,2}`), so the four records split into four singleton material buckets vs two coarse
      light/heavy buckets — the granular tier the soldier-class→armor-tier binding joins on. **The `weight`
      (encumbrance) field on both tables now gets its read-side consumer too** (`weaponWeightOf`/`armorWeightOf`,
      `systems/readviews/combat.ts`): a plain field accessor on each combat record (unlike the class-enum
      groupings, `weight` is a quantity the schema defaults to `0`, never `undefined` — so it reads a `number`,
      not an optional class), completing the per-record consumer coverage across BOTH combat tables — every
      extracted weapon field (`mainType`/`weight`/`munitionType`/`damageType`/`jobType`/`goodType`/`damage`) and
      every extracted armor field (`mainType`/`materialType`/`weight`/`blockingValue`/`goodType`/`typeId`) now
      has a sim read view. `weight` is the per-record load a deferred carry/movement-penalty drive will read
      (the drive itself oracle-blocked); note armor `weight` does NOT track the material tier monotonically
      (leather tier 2 weighs 0 < cloth tier 1 weighs 1), so it is its own field, not derivable from the tier.
      **The soldier-class→weapon ROSTER JOIN itself now lands**
      (`weaponsByJob`/`weaponsForJob`, `systems/readviews/combat.ts`): each `[weapontype]`'s `jobtype` (the
      job that wields it — already extracted + cross-ref-validated) groups all 105 weapons into a lossless
      `Map<jobType, WeaponType[]>` (20 wielding jobs over the real IR, e.g. `soldier_unarmed→{fist,claw}`,
      `hunter→hunter_bow`), with `weaponsForJob(content, job)` the per-job slice — the data-defined answer to
      "which weapons does soldier-class N wield", the seed the deferred equip drive joins on (the equip
      *behavior* stays oracle-blocked). The `atomicanimations.ini` table's two **behavioral** scalars now
      get a read-side consumer too (`systems/readviews/animations.ts`): `atomicAnimationByName` (the
      canonical name→record resolver the `atomicDuration`/combat-cadence lookups spelled out inline),
      plus `isInterruptibleAtomic` (the `interruptable` flag — 245/896 true; the seed the deferred
      atomic-preemption drive reads) and `atomicStartDirection` (the `startdirection` facing — 89/896
      pinned; the deferred orientation drive's seed), read straight off the genuinely-extracted scalars
      (vs `length`, already consumed by `atomicDuration`). **Open:** the file's graphics/coords +
      `animations.ini`'s render-side timing/`event` vocabulary are render/animation overlays — deferred
      with the render-atlas work (their only balance datum, the construction cost, is already imported).
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
