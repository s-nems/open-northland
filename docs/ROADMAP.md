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
- [ ] **Render terrain from real landscape tile graphics** — bind the decoded landscape/`.bmd` terrain
      tiles (and the triangle-grid transitions between landscape types) so the ground draws 1:1, not
      flat-tinted cells. The `SceneTerrain` already carries per-cell `typeId` (`packages/render/src/scene.ts`,
      "the GPU layer can pick the tile sprite"); this is the texture-binding half. Human-gated like the
      bob-atlas bind — an agent can't self-judge pixels (OpenVikings oracle + owned game copy + a human eye).
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
- [ ] **Run the sim in a Web Worker.** It's pure/headless/deterministic, so moving `step()` off the
      main thread keeps render at 60fps under heavy ticks. Design the Phase-2 snapshot as a plain
      **transferable** structure (no class instances / live `Map`s) so this is free later, not a retrofit.
      **Transferability now PINNED** (`test/snapshot-transferable.test.ts`): the load-bearing
      precondition — that a real `step()`-driven `WorldSnapshot` survives the `postMessage` boundary —
      is proven against the actual structured-clone algorithm, not just asserted in the docstring. A
      live run's snapshot `structuredClone()`s without throwing (a function / class instance / live
      `Map` would raise `DataCloneError`), round-trips deep-equal AND byte-identical via `JSON.stringify`
      (lossless transfer), deep-copies without aliasing the sim's live state (a worker owns its copy),
      and a building's `Stockpile` `Map` is confirmed lowered by `takeSnapshot` to a clone-safe sorted
      `[k,v]` array. **Open:** the app-side Worker wiring itself (host ↔ worker `postMessage` protocol,
      render reading the transferred snapshot) — an `app`/`render` concern, not headless-verifiable.
- [ ] **Time-travel / replay inspector.** With `rng.getState/setState`, the command log, and
      `hashState`, a dev overlay can scrub ticks, diff state between two ticks, and dump an entity.
      "Hash diverged at tick 432" → jump there → inspect. Biggest debuggability multiplier for agents.
      **Headless core landed** (`packages/sim/src/replay.ts`): a pure `replay({content,seed,map?,log,untilTick?})`
      reconstructs the exact state at any tick by re-applying the command log into a fresh sim — the
      "jump to tick N" primitive (scrub backward past later commands = the live state AT tick N;
      run past the last command = the deterministic tail). Its oracle is `hashState()` byte-equality
      with the original run at every tick (`test/replay.test.ts`; hands-on: a 1000-tick command-driven
      run replayed bit-for-bit at 4 scrub points, and state created OUTSIDE the command seam correctly
      does NOT reconstruct — replay rebuilds command-driven state only). Single-world constraint: the
      replayed sim supersedes the original (component stores are shared singletons — docs/LESSONS.md
      [56e8d3e]). The **per-tick hash/snapshot ring buffer** that feeds it is also landed
      (`packages/sim/src/hashtrace.ts`): a pure, bounded `HashTrace` records `{tick, hash, snapshot?}`
      during a live run (a large cheap hash window + a smaller recent-snapshot window, oldest dropped
      when full) and `divergedFrom(other)` localizes the FIRST tick two runs' hashes split — "hash
      diverged at tick N" computed WITHOUT re-replaying (hands-on: a 200-tick live run recorded, a
      2000-tick run capped at 500 held exactly the most-recent 500, a different-seed run localized to
      tick 1). It is a passive recorder the caller drives (it deliberately does NOT hook `step()`), so
      the inspector is opt-in and can't perturb the golden hashes. The **"diff state between two ticks"**
      half is also landed (`packages/sim/src/snapshot-diff.ts`): a pure `diffSnapshots(a,b)` merge-joins
      two plain `WorldSnapshot`s into a per-entity / per-component delta (entities added/removed, and for
      survivors the components added/removed/changed with before/after), canonical-JSON equality mirroring
      `hashState()` so "diverged" agrees with the hash, output ascending-id / sorted-name without a
      re-sort (hands-on: a real `step()`-run diffed tick 2→8 surfaced the spawned woodcutter as the lone
      `added` entity with its `Position`+`Settler` components, byte-identically re-diffable). The
      **"dump an entity"** half is also landed (`packages/sim/src/entity-dump.ts`): a pure
      `dumpEntity(snapshot,id)` binary-searches the canonical entity list for ONE entity's full component
      view at a tick (null when absent), and `traceEntity(snapshots,id)` follows that entity across a tick
      window — per step its alive flag, components, the spawn/despawn life-edge, and (on a survivor
      transition) its per-component `changes`, reusing the same canonical-JSON comparison as
      `diffSnapshots` so an entity's per-tick delta equals its slice of the full two-tick diff (hands-on: a
      real 8-tick run dumped the spawned woodcutter's `Position`+`Settler` block and traced it absent→
      SPAWNED@3→`Settler:changed` per tick, byte-identically re-traceable). The **end-to-end composition**
      is also landed (`packages/sim/src/localize-divergence.ts`): a `localizeDivergence(runA,traceA,runB,
      traceB)` wires the four primitives into the inspector's documented workflow — `HashTrace.divergedFrom`
      finds the first split tick WITHOUT re-replaying, then `replay()`s BOTH runs to that tick (serially,
      respecting the single-world shared-store constraint — A snapshot, clear, B snapshot) and
      `diffSnapshots()` the two states, returning `{tick,hashA,hashB,diff}` (or `null` when the traces'
      overlap agrees). Self-verifiable headlessly (hands-on: two runs differing by one tick-7
      `spawnSettler` localized to tick 7 with the carpenter as the lone `added` entity, byte-equal to a
      hand-replayed `diffSnapshots`; identical runs → `null`). The **single-run "free scrubbing"**
      composition is also landed (`packages/sim/src/scrub-window.ts`): a `scrubWindow(run,fromTick,toTick)`
      reconstructs a CONTIGUOUS window of plain `WorldSnapshot`s from one command log in a single forward
      pass (replay once, enqueue each logged command on its recorded tick, snapshot the in-window ticks —
      byte-identical to N separate `replay()`s but O(toTick), not O(window×toTick)), ready to feed
      `traceEntity()` (the whole window) and `diffSnapshots()` (adjacent pairs); it clamps `fromTick` to 1
      (tick 0 is the un-snapshotted initial state), yields `[]` on an empty window, throws on a negative
      target, and steps the deterministic tail past the last command. Self-verifiable headlessly (hands-on:
      a 30-tick run scrubbed `[4..8]`, the carpenter traced absent→SPAWNED@6, the 5→6 step diffed to the
      lone added settler, and both an in-window tick and a tail tick byte-equalled an independent `replay()`).
      **Open:** the dev OVERLAY that wires scrub/diff/dump into UI (a `render` concern, human-eyed) — it
      calls `localizeDivergence()` for the "diverged at N → inspect" path and `scrubWindow()`+`traceEntity()`
      for free scrubbing.
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
