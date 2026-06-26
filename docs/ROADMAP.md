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
      **Open (source-blocked):** material delivery + house leveling — `houses.ini` carries no
      build/upgrade-cost key (the cost lives below the `.ini`), so both are deferred together.
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
      atomic id 81); **deferred refinements** (armor-on-a-settler, walk-into-melee advance, swing cadence —
      ride on later items + an oracle; docs/FIDELITY.md). Inert on the golden (no settler carries `Health`).
- [ ] **N data-defined tribes** (viking/frank/saracen/byzantine/egypt), asymmetry expressed through each
      tribe's atomic bindings + `allow*`/`needfor*` graph — never hardcode "two". **Scaffolding landed**
      (→ [archive](ROADMAP-ARCHIVE.md)): all 41 `[tribetype]`s extracted, every per-tribe rule resolved off
      `settler.tribe` (tribe-agnostic by construction), and the `playableTribes`/`isPlayableTribe` /
      `isAnimalTribe` read views distinguish controllable civilizations from animals **by the tech graph
      alone** (only a civilization carries `jobEnables` edges) — wired into combat targeting so a civ
      doesn't mis-fire the PvP rule on wildlife. **Next:** seed a real **multi-civilization** scenario
      exercising two playable tribes' asymmetric bindings end-to-end (the asymmetry is in the data; a
      scenario proves the sim runs it).
- [x] **Animals as non-controllable tribes** (`animaltypes.ini`: aggression, groups, hitpoints) —
      **substance-complete** (→ [archive](ROADMAP-ARCHIVE.md) for the full landed-narrative). The
      `animaltypes.ini` table (35 creature tribes, keyed on `tribetype`) is extracted, and **every**
      aggression input is consumed: `aggressive`/`cannotbeattacked` (the `mayAttack` civ⇄animal hostility
      relation), `getAngry`/`angryGameTime` (the provoked-anger `Anger{until}` timer), `hitpoints_adult`
      (the `Health` stamp), `catchable` (the hunter-strike predation relation `mayHunt`, the real
      provocation source). Animals spawn as herds (`spawnAnimalHerd` + the `seedAnimalHerds` map
      populator + the `HerdMember` follow-the-leader drive), do damage (jobless animal → weapon-by-tribe),
      and a weapon's `[minRange,maxRange]` reach band is honored. End-to-end proven by
      `populated-map-combat.test.ts` (seed→combat→hit→death, deterministic). Faithful to the named params;
      target-acquisition / swing-cadence / in-place-strike / `harvest_cadaver`-follow-up approximations
      recorded in docs/FIDELITY.md.
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
