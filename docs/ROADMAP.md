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

## Phase 3 — Economy, progression & population  ← **current target**
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
      read side now covers **all four** edge kinds. **Next:** model multiple carriers / a per-carrier
      vehicle entity (so a carrier visibly fetches a cart) — the last unmodeled JobSystem behavior.
- [ ] ConstructionSystem: place → deliver materials → build; **house leveling** (`home level 00..04`)
      → population capacity → the births→housing→births loop. **Housing read model landed** — the
      `homeSize` param (`logichousetype` `logichomesize`: home level 00→1 … 04→5) is extracted into the
      `BuildingType` IR, and `housingCapacity`/`tribePopulation` (`systems/shared.ts`) are its first sim
      consumer: the ceiling-vs-count the births loop gates on (no births wired yet — that's the
      ReproductionSystem). **Material-delivery half is source-blocked:** `houses.ini` carries NO
      build-cost/material key (only `logicstock`/`logicworker`/`logicproduction`/`logichomesize`), so
      "deliver materials → build" has no readable oracle (the cost lives below the `.ini`) and is
      deferred; for now a placed building is immediately built (`built = ONE`). **Next:** the
      ReproductionSystem birth — create a settler when `tribePopulation < housingCapacity`, the first
      writer of the housing read model.
- [ ] ReproductionSystem: families, children growing up, gated by housing.
- [ ] HUD: stocks, population, jobs, the goods graph.
- **Exit:** a self-sustaining, progressing single-tribe settlement you can grow.

## Phase 4 — Conflict & content breadth (N tribes)
- [ ] CombatSystem from `weapontypes`/`armortypes` (a large subsystem: many soldier classes, armor
      tiers, named heroes, amulets/potions — scope it honestly).
- [ ] **N data-defined tribes** (viking/frank/saracen/byzantine/egypt), asymmetry expressed through
      each tribe's atomic bindings + `allow*`/`needfor*` graph — never hardcode "two".
- [ ] **Animals as non-controllable tribes** (`animaltypes.ini`: aggression, groups, hitpoints) —
      same entity/AI model, not a separate bolt-on.
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
