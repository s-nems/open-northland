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
- [ ] **ProgressionSystem** — experience + tech graph. **Landed** (→ archive): `humanjobexperiencetypes`
      XP extract + accrual; `jobEnables{House,Good}` placement/production gates wired; the
      `{need,train}for{job,good}` extract + the `needfor*` read side + the `needforgood` harvest gate +
      the `needforjob` job-assignment gate (consumed by the JobSystem slice below).
      **Next:** interpret `baseRepeatCounter` into the multi-tier competence curve (output quality/speed
      by XP tier) — **blocked on an oracle**: the XP→tier→output curve is in neither the `.ini` (no
      `level`/`tier` field; `baseRepeatCounter` is on only 3/70 records) nor OpenVikings (its sim is a
      stub), so interpreting it now would be invented, not faithful; deferred until calibration-by-observation
      against the running original (see docs/FIDELITY.md). **All four `jobEnables` edge kinds are now
      consumed** (`house` placement / `good` production / `vehicle` carry-capacity / `job` assignment),
      so the tech-graph read side is complete; only the XP→tier competence curve remains oracle-blocked.
- [ ] **JobSystem** — assignment **landed** (idle settlers take open, tech-enabled, understaffed
      workplace jobs, gated by `needforjob` XP — `systems/jobs.ts`), each is **bound to its workplace**
      (the `JobAssignment{workplace}` record — understaffing is now per-building, so two same-type
      workplaces staff independently and a worker stays latched to *its* mill across a step-off the
      tile), and a freshly-assigned operator **walks to its bound workplace** (the AI
      walk-to-bound-workplace drive — `boundWorkplaceTarget` in `systems/ai.ts` — so a pure-operator job
      like the carpenter reaches its station instead of idling), and the **binding's demolition path is
      closed** (the `demolish` command unbinds + idles every settler bound to a building before
      destroying it — `unbindWorkersOf` in `systems/command.ts` — so a worker is never stranded latched
      to a dead workplace; the JobSystem re-employs it next tick). **Vehicle data extracted** — the
      `vehicletypes` table (incl. `stockSlots` carry capacity: handcart 15 / oxcart 30 / ships 50,200)
      now lands in the IR (`VehicleType`, `Data/logic/vehicletypes.ini`), the param the carrier slice
      consumes, and the **`jobEnablesVehicle` cross-ref is now resolved** in `validateCrossReferences`
      (the `vehicle` kind keys into `VehicleType.typeId`, the distinct `logicvehicletype` namespace — the
      real data's 50 vehicle edges, ids `{1..5}`, all land within the 6-entry table). **`stockSlots` is now
      wired into the sim** — a carrier hauls a batch sized by `carrierCarryCapacity` (`systems/progression.ts`):
      the largest `stockSlots` among the vehicle types its tribe has UNLOCKED via `jobEnablesVehicle`,
      falling back to 1 (a single unit on foot) before any vehicle is available — the **sim's first
      consumer of the `vehicle` `jobEnables` edge kind**. The carrier→vehicle PAIRING (a per-carrier
      vehicle entity, cart logistics) is still approximated (see docs/FIDELITY.md). **The `job`
      `jobEnables` edge kind is now also consumed** — `jobEnabled` (`systems/progression.ts`, called from
      `openJobAt`) gates an idle settler's assignment on the `jobEnablesJob` tech edge (a job a settler
      must already be present to unlock, e.g. a smith unlocking a weaponsmith), so the `tribeUnlockEnabled`
      read side now covers **all four** edge kinds. The carrier→vehicle PAIRING (a per-carrier vehicle
      entity, cart logistics, the per-vehicle `logicgood` carry-filter) is now a **recorded conscious
      deviation** (docs/FIDELITY.md — *Carrier→vehicle pairing*): it is oracle-blocked (`vehicletypes.ini`
      carries no carrier→vehicle binding or dispatch key; OpenVikings' sim is a stub), so modelling a
      cart-as-entity now would be invented, not faithful — the data (`stockSlots` + the `vehicle` unlock
      edge) is consumed, the divergence is knowable, and the faithful path is named, deferred to a
      vehicle-entity slice once an oracle exists. With that decision recorded, the JobSystem has no
      remaining *unrecorded* unmodelled behavior.
- [ ] ConstructionSystem: place → deliver materials → build; **house leveling** (`home level 00..04`)
      → population capacity → the births→housing→births loop. **Housing read model landed** — the
      `homeSize` param (`logichousetype` `logichomesize`: home level 00→1 … 04→5) is extracted into the
      `BuildingType` IR, and `housingCapacity`/`tribePopulation` (`systems/shared.ts`) are its first sim
      consumer: the ceiling-vs-count the births loop gates on (births are now wired — the
      ReproductionSystem below). **Material-delivery half is source-blocked:** `houses.ini` carries NO
      build-cost/material key (only `logicstock`/`logicworker`/`logicproduction`/`logichomesize`), so
      "deliver materials → build" has no readable oracle (the cost lives below the `.ini`) and is
      deferred; for now a placed building is immediately built (`built = ONE`). **Next:** house
      *leveling* (`home level 00..04` raising capacity) — blocked on the same below-`.ini` upgrade-cost
      source as material delivery, so deferred together.
- [ ] **ReproductionSystem** — birth **landed** (`systems/reproduction.ts`): one settler per tribe per
      tick while `tribePopulation < housingCapacity` — the first WRITER of the housing read model, born a
      **baby** at the tribe's lowest-id built `home` tile. The cadence IS the gate (deterministic, no RNG,
      self-limiting at capacity), so the **`populationWithinHousing` invariant** (a content-bound factory
      in `invariants.ts` — it needs the `homeSize` param the `Invariant` signature doesn't carry) can
      never be breached by a birth. **Age-class structure now landed** — a newborn's `jobType` is the
      data-pinned youngest age class (`NEWBORN_AGE_CLASS` = `baby_female` id 1, pinned to `logicdefines.inc`
      `JOB_TYPE_HUMAN_BABY_FEMALE` + the `jobtypes.ini` records), because in the original the first five
      `jobtypes` (`baby_female`/`baby_male`/`child_female`/`child_male`/`woman`) are **age/sex classes**,
      not working trades. `systems/ageclass.ts` is the sim-side recognition (`isBaby`/`isChild`/
      `isNonWorkingAge`, ids 1–4 non-working), so the JobSystem leaves a baby unemployed (non-null jobType
      → skipped; no `workers` slot lists a baby → never adopted). The birth *rate*, *sex*, and the
      **growth cadence** are below the readable `.ini` (no birth-rate/sex/grow-up key; `make_love` restores
      the leisure channel, not a birth yield), so they are **approximated** (see docs/FIDELITY.md).
      **The growth transition now LANDED** — `systems/ageclass.ts`'s `growthSystem` ages each born settler
      (the new **`Age{ticks}`** optional component the ReproductionSystem adds at birth, mirroring
      `JobAssignment`) and promotes its age-class `jobType` baby→child→adult-eligible over `GROWUP_TICKS`
      per stage, **sex preserved** (baby_female→child_female, baby_male→child_male), removing the `Age`
      component once it reaches adult-eligibility (`jobType` null) so the JobSystem then employs it. The AI
      planner skips a still-growing settler (keyed on the **`Age` component**, not the age-class id — a
      synthetic fixture's adult job id can collide with a real age-class id, but only a born-young settler
      carries `Age`), so a baby/child no longer runs the adult eat/sleep/pray drives — faithful to "a baby
      is cared for, it doesn't self-feed". `GROWUP_TICKS`=8192 is the unpinned approximated cadence (the
      hunger-rise-style constant pattern); inert in the golden/slice (no `home`-kind content → 0 births →
      golden hash + trace unchanged). **Next:** the carrier→vehicle pairing / a per-carrier vehicle entity
      (the JobSystem's last unmodeled behavior), or the HUD slice — births→growth→employment now closes
      the population lifecycle loop.
- [ ] HUD: stocks, population, jobs, the goods graph. **Read model started** — the HUD's data half is
      a set of pure, deterministic derived views over world state (no mechanic, no pixels): `tribeStocks`
      (`systems/shared.ts`) sums each good a tribe holds across all its stores (`Building`+`Stockpile`),
      the **stocks** panel's source, joining `tribePopulation`/`housingCapacity` (the **population** half,
      already landed). The **jobs** breakdown now landed too — `tribePopulationByJob` (`systems/shared.ts`)
      tallies a tribe's settlers by `jobType` into a `Map<jobType, count>`, idle (`null`) adults keyed by
      the negative `IDLE_JOB` sentinel so they can't collide with a real job id, with the age-class
      (ids 1–4) vs trade split left to the consumer to partition by key (the `jobType`-as-life-stage model).
      The **goods-graph** view now landed too — `goodsGraph` (`systems/shared.ts`) surfaces the recipe-DAG
      IR as one `GoodsGraphNode` per good: its node `layer` (raw / produced / unclassified, from
      `GoodClassification`), `inputGood` flag, the input-side edges (`GoodType.productionInputs`), and the
      **output side** joined in — the building **type ids** that make it (`BuildingType.produces`, falling
      back to a materialized `recipe.outputs`), `producedBy` sorted for a stable view. The only read view
      over `content` rather than world state, so it is pure of world/RNG (deterministic by construction).
      **Render-side HUD MODEL landed** — `buildHud(snapshot, tribe)` (`packages/render/src/hud.ts`) is the
      pure, self-verifiable data half of the on-screen HUD, exactly analogous to `buildScene` for the world
      view: it re-derives population / per-job head-counts / per-good stock totals from the **frozen
      `WorldSnapshot`** (not the live stores — `render` is a pure consumer), emitting a flat, sorted
      `HudModel`. The aggregates match the sim read views by construction (a count/sum is order-independent)
      but never re-enter the sim; output is total-ordered (ascending id), so the panel is reproducible
      frame-to-frame. **Render-side HUD LAYOUT landed too** — `layoutHud(model)` (`packages/render/src/hud.ts`)
      is the pure, self-verifiable bridge from the `HudModel` to its pixels, exactly analogous to how
      `buildScene` turns a snapshot into positioned `DrawItem`s before the GPU draws them: it stacks the model
      into labelled sections (header `Tribe N · tick T` / `Population` / an indented **Jobs** tally list with
      the idle sentinel rendered as `idle` / an indented **Stocks** tally list), assigning each row a
      panel-relative `(x, y)` (rows advance by a fixed line height; tallies indented under their heading) and
      sizing the panel `height` to exactly fit the row count. Pure + total (a function of the model alone — no
      Pixi, no glyph metrics; width is a fixed column, height counts rows), so the same model lays out
      byte-identically — *which line lands where* is now unit-tested without a screen, leaving only the glyph
      rasterization to a human. **Render-side HUD PLACEMENT + Pixi DRAW landed too** — the last
      self-verifiable decision (where on the canvas the panel lands) is `placeHud(layout, corner, screen)`
      (`packages/render/src/hud.ts`): it anchors the `HudLayout` to a screen `HudCorner`, **clamps** it
      on-screen, and re-anchors every row's panel-relative `(x, y)` to absolute canvas pixels (the
      screen-space analogue of `terrainMapToScene`) — pure + total, unit-tested. `renderHud(app, placement,
      style?)` (`packages/render/src/pixi-renderer.ts`) is the GPU half (twin of `renderScene`): a pure
      consumer of the `HudPlacement` that paints a backing rect + one Pixi `Text` per screen-positioned row,
      now overlaid on the scene each frame in BOTH `main.ts` (live) and `shot.ts` (the screenshot harness,
      single-tribe viking). Only the **glyph rasterization/typography** (font/colour) is left un-self-verifiable
      — a human eyeballs it via the shot. The goods-graph view (over `content`, not the snapshot) stays a
      sim-side read view the panel can call directly. **Next:** the HUD slice is complete, and the
      carrier→vehicle PAIRING is now a **recorded conscious deviation** (docs/FIDELITY.md — oracle-blocked,
      so the decision was to defer the cart-as-entity rather than invent it). With both closed, every
      Phase-3 mechanic is either landed or explicitly recorded as deferred. The only remaining Phase-3
      work is the two long-open **human-gated render items** (the Phase-1 oracle pixel-diffs; the Phase-2
      real decoded-bob-atlas bind) — an agent cannot self-judge pixels, so they await an owned game copy +
      a human eyeballing the OpenVikings oracle, and Phase 3's economy/progression/population substance is
      otherwise done; the next feature iteration should advance toward **Phase 4 (Conflict & content
      breadth)** — the smallest start being the **N data-defined tribes** scaffolding or the
      `weapontypes`/`armortypes` CombatSystem read side.
- **Exit:** a self-sustaining, progressing single-tribe settlement you can grow.

## Phase 4 — Conflict & content breadth (N tribes)  ← **current target**
- [ ] CombatSystem from `weapontypes`/`armortypes` (a large subsystem: many soldier classes, armor
      tiers, named heroes, amulets/potions — scope it honestly). **Armor data now extracted** — the
      `armortypes` table (`ArmorType`, base `Data/logic/armortypes.ini`: 4 classes woolen/leather/chain/plate,
      each with a `blockingValue` damage-mitigation + a `goodType`) lands in the IR alongside the
      already-extracted `weapontypes` (`WeaponType`, with per-armor-class `damage`). This **closes the
      data join the combat read side needs**: a weapon's `damagevalue <armorClass>` keys were unresolvable
      until the armor-class table existed; now class 1..4 resolve to an armor record (class 0 = unarmored,
      no record). **CombatSystem read side now landed** — `combatDamage(content)` (`systems/shared.ts`),
      a pure content-only derived view (the analogue of `goodsGraph`), joins each `WeaponType.damage`
      against each `ArmorType.blockingValue` into one `CombatProfile` per weapon: its identity (the
      composite `(tribeType, typeId)` `key` + `id`) and a `CombatDamageRow` per armor class it can target,
      carrying `netDamage = max(0, rawDamage - blockingValue)` (clamped — armor never heals). The class set
      is the union of class 0 (unarmored, no record) + the armor records (1..4) + any class the weapon's own
      `damage` lists; the **KNOWN GAP is handled** — out-of-table classes 6/7 (no `[armortype]` record) are
      treated as **unarmored** (`blockingValue 0`, `hasArmorRecord false`), never a crash. Returned as an
      **array, not a Map** — no weapon key is unique (the real animal weapons reuse even `(tribeType,
      typeId)`: tribe 5's `chicken`+`claw`, tribe 8's doubled `bearfist`), so a keyed map would silently
      drop records; the array keeps all 105. **The hit-resolution mechanic now LANDED** — the first real
      combat *behavior*: a completed `attack` `AtomicEffect` (`atomic.ts` → `resolveHit`) drains the
      **resolved net `combatDamage`** (carried already-resolved on the effect, like `pickup`/`eat`'s
      `amount`) from the target's new optional **`Health{hitpoints, max}`** component, **clamped at 0** (a
      hit never heals). So the read-side damage table now has its first consumer. **Faithful (net-damage
      param):** the per-hit amount is the verbatim `weapontypes`×`armortypes` join. **Approximated (no
      oracle):** the **hitpoint pool** (only `animaltypes.ini` carries readable `hitpoints` — 200..20000;
      humans' are below the `.ini`) is a per-content stamp on the large-integer scale, and the **hit loop**
      (who attacks whom, target selection, swing cadence, death/cleanup at 0 HP) is deferred — for now a
      0-HP target just stops being viable and a missing-`Health` target is a no-op (see docs/FIDELITY.md).
      `Health` is a separate optional component (like `JobAssignment`/`Age`), so the golden slice has none
      and the hash is untouched. **The death/cleanup half now LANDED** — `cleanupSystem` (`systems/cleanup.ts`,
      graduated from the stub, runs **last** in `SYSTEM_ORDER`) destroys every entity whose `Health.hitpoints`
      has reached 0 and emits a `settlerDied{entity, cause:'damage'}` event for render/audio. It runs after
      AtomicSystem so a lethal `attack` landed earlier in the tick is reaped the **same** tick (nothing
      downstream sees a 0-HP zombie; the entity is gone by the snapshot render reads). The reaped entity holds
      its own cross-references (a worker's `JobAssignment` points settler→building, never the reverse), so
      destroying it leaves no dangling binding — the reverse hazard (a *building* destroyed under a bound
      worker) stays handled at the `demolish` seam. Collect-then-destroy (canonical ascending-id) keeps the
      scan mutation-safe and the death-event order reproducible. Inert on the goldens/slice (no `Health`-bearing
      entity → no death → hash untouched). **The targeting half now LANDED** — `combatSystem`
      (`systems/combat.ts`, graduated from the stub) gives each idle, living **combatant** (a `Settler` carrying
      a `Health` pool) a target: the nearest **enemy** (`Health`-bearing settler of a *different* tribe) within
      its weapon range, issuing the `attack` `CurrentAtomic` with the `combatDamage`-resolved net damage (the
      attacker's weapon, keyed by `(tribeType, jobType)`, vs an **unarmored** target — settlers wear no armor
      yet). The **attack atomic id is 81** (the original's `setatomic <job> 81 "..._attack"`, verified in
      `DataCnmd/tribetypes12/tribetypes.ini`), its duration resolved through the tribe's binding like every
      atomic. This **closes the targeting→attack→hit→death loop**: combatSystem picks + swings, the AtomicSystem
      `attack` effect lands the hit (drains `Health`), and `cleanupSystem` reaps the felled one — all in-order
      within a tick. Faithful (net-damage param + atomic id); **approximated** (target acquisition = nearest
      enemy in range, swing cadence, in-place strike with no walk-into-melee, every target unarmored — no
      oracle; see docs/FIDELITY.md). Inert on the goldens/slice (no settler carries `Health` → no combatant →
      hash untouched). **Next:** the **N data-defined tribes** scaffolding (never hardcode "two") — the next
      roadmap item — which combat then exercises; the deferred combat refinements (armor-on-a-settler, the
      walk-into-melee advance, animal combatants) ride on that + an oracle.
- [ ] **N data-defined tribes** (viking/frank/saracen/byzantine/egypt), asymmetry expressed through
      each tribe's atomic bindings + `allow*`/`needfor*` graph — never hardcode "two". **Scaffolding
      landed** — the pipeline already extracts ALL 41 `[tribetype]`s (the 5 civilizations + 36
      animal/monster tribes), and the sim already resolves every per-tribe rule (`jobEnables`/`needfor*`
      gates, weapon/atomic bindings) off `settler.tribe` → `content.tribes.find(...)`, so the mechanics
      are tribe-agnostic by construction. The new **`playableTribes`/`isPlayableTribe` read view**
      (`systems/readviews.ts`) is the data-defined enumeration of the **controllable** civilizations —
      distinguished from animals **by the tech graph alone** (only a civilization carries `jobEnables`
      edges; an animal tribe has none), never by a hardcoded name or the count "two". This is the
      foundation the combat cross-tribe targeting and the next item (non-controllable animals) both build
      on. **The animal-vs-civ split is now wired into combat targeting** — `combatSystem`'s
      player-vs-player drive excludes a **known animal tribe** (`isAnimalTribe` in `systems/readviews.ts`
      — a recorded `[tribetype]` with no tech graph, the complement of `isPlayableTribe` *restricted to
      recorded tribes*) both as attacker and as target, so a civilization no longer mis-fires the
      same-different-tribe rule on wildlife; civ-vs-animal aggression is left to the next item's
      `animaltypes.ini` model. The boundary is faithful to the unknown case: a different-tribe combatant
      with **no record at all** (a synthetic enemy) is NOT an animal and stays a valid PvP enemy.
      **Next:** the **animals as non-controllable tribes** item below (the `animaltypes.ini`
      aggression/hitpoints/groups model that drives civ-vs-animal combat), and/or seed a real
      **multi-civilization** scenario/slice exercising two playable tribes' asymmetric bindings
      end-to-end (the asymmetry is in the data; a scenario proves the sim runs it).
- [ ] **Animals as non-controllable tribes** (`animaltypes.ini`: aggression, groups, hitpoints) —
      same entity/AI model, not a separate bolt-on. **Data extracted** — the `animaltypes.ini` table
      (`AnimalType`, base `Data/logic/animaltypes.ini`) lands in the IR: 35 creature/monster tribes with
      `aggressive`/`getAngry`/`angryGameTime` (the aggression inputs), `hitpointsAdult`/`hitpointsBaby`
      (the HP param the `Health`-stamp already reads), the herd/territory params (`maximumGroupSize`/
      `searchForLeader`/`maximumDistanceTo*`/…) and locomotion+flags (`moveSpeed`/`runSpeed`/`catchable`/
      `cannotBeAttacked`/…). **Keyed on `tribetype`** (not `type` — an animal's identity IS its tribe),
      cross-ref-validated; a record with no `tribetype` (a disabled stub) is dropped. **The sim-side
      civ-vs-animal aggression behavior now LANDED** — `combatSystem`'s targeting now consults a single
      hostility relation `mayAttack(content, attacker, target)` (`systems/readviews.ts`) for both
      attacker-eligibility and per-candidate targeting: an **aggressive** animal (`isAggressiveAnimal` —
      `animaltypes.ini` `aggressive`) attacks a nearby civilization unprovoked, the civilization fights
      it back (the fight is mutual), a **passive** animal (no record / not aggressive) neither attacks
      nor is attacked (hunting prey is the separate `catchable`/hunter mechanic), a `cannotBeAttacked`
      animal (`animalCannotBeAttacked` — decorative fauna/bees) is exempt as a civ's *target* (yet, if
      aggressive, can still attack), and two animals don't fight each other. The animal `Health`-stamp
      source is now read by `animalHitpoints(content, tribeType)` (the `hitpoints_adult` pool — a bear's
      15000 — the value a spawned animal's `Health` gets). Faithful (the `aggressive`/`cannotbeattacked`
      flags + net-damage param + atomic id 81); **approximated** (nearest-in-range target acquisition,
      swing cadence, in-place strike, civ-engages-only-aggressive-animals split). **Provoked anger now
      LANDED** — `getAngry`/`angryGameTime` (a passive animal struck → temporarily hostile) is wired via
      a per-entity **`Anger{until}`** timer: the AtomicSystem's `attack` effect stamps it on a struck
      `isProvokableAnimal` (`provokeAnger`, reading `angryGameTimeOf`), and `combatSystem` reads it
      (`hostileAnimalNow` attacker side, `mayTarget` target side) so a provoked animal fights back and is
      a valid target until the timer lapses (reaped on the attacker scan), a re-strike refreshing it — so
      **every** `animaltypes.ini` aggression input is now consumed (see docs/FIDELITY.md). Inert on the
      goldens/slice (no settler carries `Health`). **The herd/spawn
      read side now LANDED** — `herdParams(content, tribeType)` (`systems/readviews.ts`) surfaces the
      already-extracted `animaltypes.ini` group/leader/territory params as one struct (`maxGroupSize`
      from `maximumgroupsize`, `searchForLeader`, `birthPointRange` from `maximumdistancetobirthpoint`,
      `stayPointRange` from `maximumdistancetostaypoint`) — null when the tribe has no animal record (a
      civilization / unknown), the same one-call read shape `animalHitpoints` gives the HP stamp. It is
      a pure derived view (FIDELITY n/a — invents no behaviour; the params are verbatim, 0-passthrough
      drift across all 35 real animals), the data foundation the spawner consumes: every real animal
      carries a herd (`maximumGroupSize` 3..6) and 23 of 35 follow a leader. **The spawn/placement
      mechanic now LANDED** — the `spawnAnimalHerd{tribe,x,y}` command (`systems/command.ts`, the animal
      analogue of `spawnSettler` on the mutation seam) actually places a group of creatures on the map:
      `max(1, maximumGroupSize)` `Settler`s of the animal tribe (jobType null — an animal isn't born into
      a trade), each carrying a `Health` pool stamped from `animalHitpoints` (`hitpoints_adult`),
      deterministically scattered (an expanding 8-direction ring, no RNG) within `birthPointRange` of the
      birth point, and — when `searchForLeader` — a designated **leader** (the herd's lowest-id member)
      every member records via the new optional `HerdMember{leader}` component (a solitary animal carries
      none). A non-animal tribe (a civilization) is bad input and skipped (still command-logged). Faithful
      (group size / HP / birth-range / leader-presence params); **approximated** (the scatter pattern and
      the one-shot placement with no respawn/territory upkeep — recorded in docs/FIDELITY.md "Animal herd
      spawn/placement"). Inert on the goldens/slice (no herd is spawned there). **The animal→weapon binding
      now LANDED** — a spawned animal carries `jobType: null`, but `combatSystem`'s `attackerWeapon`
      (`systems/combat.ts`) now resolves a **jobless animal's** weapon by **`tribeType` alone** (an
      animal's combat identity IS its tribe — each animal tribe carries one attack weapon, `claw`/
      `bearfist`/`wolvefist`; the weapon's `jobType` in the data is the monster combat-class, not a
      player-assignable trade), while a settler with a job still resolves by `(tribeType, jobType)` and a
      jobless *civilian* stays unarmed. So a spawned aggressive animal now actually does damage (the gap
      the spawn opened — faithful, the weapon param is the verbatim `weapontypes` join; docs/FIDELITY.md
      "Combat targeting drive"). **The follow-the-leader movement drive now LANDED** — `herdingSystem`
      (`systems/herding.ts`, runs just before `aiSystem` so the goal is routed same-tick) is the first
      reader of the `HerdMember` relation: a strayed idle follower (farther than `maximumLeaderDistance`
      from its leader — surfaced via `herdParams().leaderDistance`) gets a `MoveGoal` to the leader's cell
      and walks back via the existing path chain, coming to rest inside the radius; the leader itself
      (`leader === self`) and a solitary animal (no `HerdMember`) run no drive, and a reaped leader leaves
      the follower in place. Faithful (the cohesion-radius param); approximated (walk-straight-back-to-
      leader-cell behavior — no flocking/formation oracle; see docs/FIDELITY.md). Inert on the goldens/
      slice (no `HerdMember` there). **The map populator now LANDED** — `seedAnimalHerds(content, terrain, options?)`
      (`packages/sim/src/populate.ts`) is the AnimalSystem/scenario seam that *issues* `spawnAnimalHerd` to seed a
      real loaded map's wildlife: a **pure command-producer** (not a per-tick system — seeding is a one-shot at map
      load) that returns the ordered `spawnAnimalHerd` commands placing every **recorded** animal tribe's herds
      (canonical ascending order; a civilization is never seeded) at **walkable** birth points (stride through the
      terrain's walkable cells in canonical row-major order, round-robin successive birth points across the animal
      tribes, capped by `cellStride`/`maxHerds`). The caller enqueues the returned commands through the one mutation
      seam, so seeding is replay-faithful for free. Faithful (the set of animal tribes + each herd's
      size/HP/range/leader params); **approximated** (*where* + *how many* birth points — the original's per-map
      animal spawn points are below the readable `.ini`; recorded in docs/FIDELITY.md "Animal map populator").
      Verified on the REAL pipeline IR (35 animals) + a real 250×250 decoded map: 125 herds across 34 distinct
      animal tribes, all birth points walkable + in-bounds, deterministic. **The populated-map combat scenario
      now LANDED** — `populated-map-combat.test.ts` is the end-to-end slice this item named: it wires the
      already-landed pieces together as ONE run through the real `step()` schedule — `seedAnimalHerds` produces
      the `spawnAnimalHerd` commands, the caller enqueues them through the mutation seam, the `commandSystem`
      places a real seeded **bear herd** (3 creatures, leader, HP 15000), and a **civilization combatant** beside
      it triggers the mutual civ⇄animal fight: the aggressive bear charges the viking (the unprovoked-aggression
      drive), the viking fights it back, the `attack` atomic drains `Health`, and a lone frail viking is ground
      down by the pack and **reaped** by the `cleanupSystem` (one `settlerDied`) — the seed→combat→hit→death loop,
      end-to-end + deterministic (two same-seed runs reach the same `hashState`). The civ combatant is placed
      directly (with `Health`), since `spawnSettler` mints no `Health` pool yet (settler-side Health/soldier
      stamping is a later slice); the test verifies the *integration* of landed pieces, adds no mechanic, and is
      inert on the goldens. With the **provoked-anger timer now landed** (above), **every** `animaltypes.ini`
      aggression input — `aggressive`, `cannotbeattacked`, `getAngry`/`angryGameTime`, `hitpoints_adult` — is
      consumed, so this item is **substance-complete**. **The hunter strike on `catchable` prey now LANDED** —
      the last unconsumed `animaltypes.ini` driver (`catchable`) is wired, and it is the real **provocation
      SOURCE** the `Anger` timer waits on. `combatSystem`'s targeting (`mayTarget`) now composes a third relation
      alongside hostility (`mayAttack`) and provoked-anger: the **predation** relation
      `mayHunt(content, attackerJob, targetTribe)` (`systems/readviews/tribes.ts`) — a civilization **hunter**
      (`HUNTER_JOB` 15, pinned to `jobtypes.ini` `type 15` + `logicdefines.inc` `JOB_TYPE_HUMAN_HUNTER`) may
      strike a `catchable` prey animal (`isCatchableAnimal` — the cow/livestock a non-hunter combatant leaves
      alone), gated by the attacker's *job* not tribe hostility. The strike reuses the **same `attack` atomic id
      81** every fighting job binds (the original's `setatomic 15 81 "..._hunter_attack"`) and the verbatim
      `weapontypes` net-damage, so the hunter's hit drains `Health` and — for a `getAngry catchable` prey — flows
      through the existing `provokeAnger` path → the `Anger` timer (the provocation the timer waited on). A
      `cannotbeattacked` animal stays exempt from a hunter too. Faithful (the `catchable` param + hunter job id +
      net-damage + atomic id 81); **approximated** (nearest-prey-in-range acquisition, an in-place strike with no
      walk-to-prey advance and no `harvest_cadaver` follow-up, prey only fighting back once provoked — see
      docs/FIDELITY.md "Hunter strike on catchable prey"). Verified on the REAL pipeline IR (2 catchable animals
      tribes 10/19; each of the 5 civilizations carries a real `hunter_bow` job-15 weapon) + a real `step()`
      schedule (a viking hunter drains a real cow's `Health`; a non-hunter leaves it alone). Inert on the
      goldens/slice. **Next:** seed a real **multi-civilization** scenario exercising two playable tribes'
      asymmetric bindings end-to-end (the asymmetry is in the data; a scenario proves the sim runs it) — or the
      hunter's `harvest_cadaver` (atomic 33) follow-up that yields meat from a felled animal.
- [ ] **Sea/Northland identity:** water valency, boats as mobile stores, embark/disembark atomics,
      `fisher_sea`/`trader_sea`/`carpenter ship`, `vehicle_ship`.
- [ ] Import full base + `culturesnation` content; bring over the mod's balance edits (data).
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
