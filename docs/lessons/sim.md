# Lessons — sim (mechanics, determinism, goldens, sim tests)

Part of the loop's hard-won memory. The contract (one entry per trap, commit-grounded,
extend-don't-duplicate, graduate a thrice-hit trap to a `CLAUDE.md`) lives in
[`../LESSONS.md`](../LESSONS.md) — read it before adding here.

- [fec4ded] Integer atomic durations: `progress = ONE/duration` truncates, so an odd duration never
  reaches `ONE` and the atomic hangs forever — count an integer `elapsed` to the exact
  `elapsed >= duration`; keep `progress` only as a derived display value. (sim/atomic)
- [6a4d20a] Path completion removes `PathFollow` in pass 1, so a `Velocity`-bearing entity
  double-moves on its arrival tick unless pass 2 skips path-handled ids — record handled ids in a
  membership Set and skip them. (sim/movement)
- [9a497c9] `npm run build` (tsc) only compiles `src/**` — test files aren't in the project graph and
  vitest doesn't typecheck, so adding a required `SystemContext` field leaves stale test `ctx` literals
  type-broken yet green; grep `SystemContext = {` across `test/` when the context shape changes. (sim/tooling)
- [94bae6d] A speculative/dead named-import added when extracting helpers into a new module slips
  past BOTH gates: biome's `recommended` set doesn't error on `noUnusedImports`, and `tsc`'s
  `noUnusedLocals` won't flag one *member* of a still-partly-used import group (`{ Building, Stockpile }`
  where only `Building` is used). Eyeball the new file's imports against its body after a module split —
  green build + green check don't prove every import is live. (sim/tooling)
- [ac6a287] **(THE recurring trap — rediscovered 6×; graduated to `packages/sim/CLAUDE.md`.)** Component
  stores are module-level singletons SHARED by every `Simulation`/`World` (`defineComponent` makes one
  `Map`; `new World()` resets the id counter but NOT the stores). Any code that builds >1 sim in one
  process leaks the earlier run's entities/components onto the later run's fresh-but-reused ids, and
  because `world.query` iterates **store insertion order**, a planner then acts on stale entities →
  nondeterminism. This bites two ways: (a) a multi-run **hands-on** smoke/determinism harness — a two-run
  `hashState()` compare FALSE-fails, or a "bug" is really state-bleed; (b) a **test** whose `beforeEach`
  clears only a hand-picked subset — green alone, red in-suite (a stale `CurrentAtomic`/`Health`/
  `JobAssignment` on a reused id diverts a decision). `hashState()` won't catch mid-tick query-order
  divergence (it hashes sorted `canonicalEntities()`). Fix: clear the WHOLE namespace between runs —
  `for (const c of Object.values(components)) if (c?.store instanceof Map) c.store.clear()` (a subset
  misses a component a future system adds; a brand-new optional component must join every clear list),
  exactly as the vitest suites' `beforeEach` does. (sim/test)
- [20282ef] A worker-presence production gate moves the integration golden's state HASH but not its
  atomic TRACE: staffing the sawmill adds a new operator entity (the canonical full-state hash hashes
  every component on every entity, so a new entity shifts it), yet the behavioral atomic-trace +
  produced count are unchanged. That split is the right read of an intentional golden move — re-baseline
  the hash, but if the trace also moves, a real *behavior* changed and you must look harder. Keep the
  worker pinned without the full JobSystem by a narrow "a settler standing on a workplace it staffs is
  left put" planner rule (gated on the building having a RECIPE, so a store/HQ listing the same job
  doesn't freeze a harvester). (sim/goldens)
- [2cf9301] A behavior with no sim-oracle can still pin its *atomic id* from the original `tribetypes`
  `setatomic <job> <atomicId> "<animation>"` table even when nothing else about the behavior is
  pinned: grepping the real `tribetypes.ini` for the activity name (`eat_slot_food` → `setatomic 5 10`)
  reveals the canonical atomic id (eat=10, candy=11) for free, splitting a planner mechanic into a
  faithful id + animation-`length` join and an approximated trigger/target. Before inventing a magic
  atomic-id constant, grep `tribetypes` for the action name — the slot id is sitting right there. And
  put the eat-drive ABOVE the workplace-staffing pin in the planner, or a starving operator never
  leaves to feed. (sim/fidelity)
- [e13314d] A **target-bound** need (the settler must reach a SITE to satisfy it, unlike eat-at-a-store
  / sleep-in-place) needs a need→satisfier→**building** lookup — and the satisfier building is often
  identified by a *structural signature*, not a readable flag: the original "work temple" (logictype 37,
  logicmaintype 3) carries no `logicworker`/`logicstock`/`logicproduction`, so it surfaces as a
  `workplace` kind with no recipe/workers/stock — exactly the "infer the binding that lives below the
  readable data" pattern `isFood` uses (the `food_` id prefix). Don't invent a content flag the data
  lacks; recognise the building by what it conspicuously *omits*. And the new walk-to-target reuses the
  existing MoveGoal→PathRequest→PathFollow chain for free — the drive only sets the goal. (sim/fidelity)
- [3826bab] The temple structural-signature trick does NOT generalize to every target-bound need — it
  worked for `pray` only because the temple is (nearly) the unique no-recipe/no-worker/no-stock house.
  `enjoy` (id 17) has no readable building satisfier: the only houses with that signature are `work
  temple` (lt 37) and `work murek` (a decorative wall, lt 55), so structural inference can't name a
  leisure site. Verify the satisfier is actually distinguishable in `houses.ini` BEFORE planning a
  drive — don't assume the previous need's approach ports. When it can't be pinned, ship the rise+reset
  half (both pinned to data) and defer the drive in FIDELITY rather than inventing a satisfier. (sim/fidelity)
- [8302ea7] A named atomic isn't necessarily a new NEED — it may be a second SATISFIER of an existing
  one. `make_love` (id 78) reads like a distinct social need, but its animation restores the **same
  channel 3** as `enjoy` (`event <at> 3 +800` vs enjoy's `+100`), i.e. the leisure/`enjoyment` bar — so
  it resets the existing field, no new component. Before adding a need field for a satisfier atomic,
  read the animation's `event <at> <channel> <delta>` tuples and check which channel it restores; the
  bar count is set by the distinct channels, not by the atomic count. (sim/fidelity)
- [97d6755] A roadmap item's logic doesn't always belong in the system named after it. The
  ProgressionSystem's XP-accrual is **event-shaped** (it fires at the instant a work atomic completes),
  but sim events are render-only (must not be read back in sim logic), so a poll-driven `System` can't
  see the completion. The grant lives in the AtomicSystem's effect-apply (where the completion is
  known), exactly like the hunger/fatigue resets; the `progressionSystem` stub stays for the *gating*
  half. Before graduating a stub system, ask whether its logic is poll-shaped or event-shaped — the
  latter belongs at the event source. (sim/architecture)
- [dc1bb9b] **Canonicalize only a PICK, not every scan.** Ask "does the output change if matches are
  reordered?" — only a query whose RESULT depends on *which* match wins (a pick / a sum-with-order / a
  first-found mutation) needs `canonicalEntities()` + a sort. Three cases iterate raw `world.query(...)`
  insertion order and STAY deterministic because the outcome is order-invariant: (a) a boolean "does ANY
  match?" membership scan (like `Map.has` — e.g. the `buildingEnabled` placement gate); (b) an aggregate
  whose VALUES commute (a `Map`-valued read-view sum like `tribeStocks` — but document that a *display*
  consumer must sort the keys itself, insertion order isn't canonical); (c) a per-entity planner pass
  where one entity acting doesn't change another's eligibility (combatSystem/aiSystem target scans — the
  target *pick itself* still uses `canonicalEntities()` + an id tie-break). The determinism test (two
  same-seed runs hash-equal) is what proves it, not the iteration choice. (sim/determinism)
- [c587b2b] When a *threshold-reader* consumes state a *writer* accrued, the fidelity win is that they
  key on the **same** id space with no translation layer: the `needfor*` `experienceTypes` reference the
  exact `humanjobexperiencetypes` track typeIds `grantWorkExperience` writes onto `Settler.experience`,
  so `experienceRequirementMet` joins the accrual half for free. But the reader must NOT cross-validate
  those ids — 23/26 real `need` expTypes resolve to a track, the other 3 (72/73/75) live in the wider
  id space the extractor already leaves unchecked ([f6619a4]) — so the read-side helper consumes the raw
  id and `.get()` simply returns 0 for an unmatched track (vacuously unmet), never throwing. Verify the
  join hands-on against the REAL IR (the keyspace overlap + the boundary gate), not just the fixture.
  (sim/progression)
- [8a0e4d6] An XP-`need` gate must be wired where the gated agent can ALSO satisfy it, or it deadlocks:
  reading `needforgood` as "the workplace OPERATOR's XP" looked obvious, but the operator (a carpenter)
  accrues no XP under the current sim (production grants none — `grantWorkExperience` fires only on
  harvest), so any non-zero threshold would lock that output forever. The faithful, non-deadlocking seam
  is the HARVEST planner (`nearestHarvestableFor`), where the gated settler IS the one who trains the
  good's track by doing the work the threshold guards. Before consuming a "you need XP in track T to do
  X" gate, check the sim actually grants track-T XP *to the agent X gates* — a gate whose input no agent
  can produce yet is a deadlock, not a faithful constraint; defer it to where the accrual loop closes.
  (sim/progression)
- [6264132] A new entity-assigning system stays deterministic AND self-balancing for free if it (a)
  iterates `canonicalEntities()` and takes the first match (a *pick*, so it must be canonical, unlike a
  boolean membership scan) and (b) re-derives the capacity count LIVE per candidate from world state
  rather than snapshotting it once: `jobSystem` assigns idle settlers in ascending-id order, and its
  `jobUnderstaffed` re-counts tribe-wide head-count each iteration, so assigning settler A bumps the
  count B sees — a 3-slot workplace fills with exactly 3, no shared mutable counter. A `query(Settler)`
  count is itself order-independent (addition commutes), so it needn't be canonical — only the *picking*
  loop does. The new system was provably inert in the golden (every golden/app settler spawns with an
  explicit non-null job, so no idle settler is ever assigned) — confirm a planner/assignment addition
  only fires on a state the goldens never construct before claiming the hash is untouched. (sim/determinism)
- [94e1b9c] A "walk TO target X" planner drive and the "stay put once ON X" pin must select the SAME
  set of entities, or a settler oscillates: `nearestUnstaffedWorkplaceFor` (the walk drive) first
  guarded only `Building`+`Position`+`recipe`, but `staffsWorkplaceHere` (the pin) queries
  `Building`+`Position`+`Stockpile` — so a producing-but-Stockpile-less workplace would be a walk
  target the pin then refuses to latch, looping walk→not-pinned→harvest→off-tile→walk forever. The
  bug was masked in practice (every `placeBuilding` adds a Stockpile unconditionally), so tests stayed
  green — the thrash only bites a hand-built fixture. When you add a drive that moves an entity to a
  predicate-matched target, make the target predicate IDENTICAL to the predicate that holds it there
  (copy the component query), don't approximate it. (sim/ai)
- [71f13ab] An explicit record component (`JobAssignment{workplace}`) needs a *lifecycle teardown*, not
  just creation: a settler bound to a building keeps a dangling binding to a DEAD entity when the
  building is destroyed — consumers only *defend* against the stale binding (treat-as-no-station), none
  *clear* it, so the worker is neither productive (workplace gone) nor re-employable (still looks
  bound). Put the teardown at the single destruction seam: `demolish` is the *only* `world.destroy`
  call site in the whole sim (no combat/decay path yet), so unbinding there covers every case today —
  and the cleanup belongs in the command handler, not in the generic `world.destroy` (which mustn't
  know about `JobAssignment`). When you add a component that *references another entity*, ask "what
  removes it when the referent dies?" the same iteration you add it. And: collect-then-mutate when a
  `query(A, B)` loop calls `world.remove(e, B)` — removing from the store the query may be iterating is
  a footgun; snapshot the matches first, then mutate. (sim/architecture)
- [3733380] Replacing a derived stand-in (tribe-wide head-count, on-tile presence) with an explicit
  record component (`JobAssignment{workplace}`) makes the new component the single source of truth — but
  the goldens spawn entities (the carpenter) *pre-employed onto their station* that never go through the
  assigning system, so they'd have NO binding and the binding-keyed pin would refuse to hold them →
  behavior change. Fix: have the assigning system *adopt* a pre-employed-but-unbound entity standing on
  a valid target (bind it to the building under its feet), so the record stays authoritative with the
  golden TRACE unchanged — only the hash moves (one new component on one entity), exactly the [20282ef]
  "new state, not a new action" split. And: a brand-new optional component must be added to EVERY test's
  store-clear list ([ac6a287]) — the leak shows up as a sibling test's *logic* failing (a stale binding
  inflates the per-building count), not as an obvious cross-contamination. (sim/architecture)
- [08b33ed] `parseContentSet` does NOT default `goods`/`jobs`/`buildings` — they're required (only the
  *other* tables like `vehicles`/`tribes`/`landscape` default to `[]`). A new sim test that builds a
  minimal content set inline (instead of spreading `testContent()`) fails zod validation with `Required`
  on exactly those three, not on the field you were exercising. Either spread the fixture or include the
  three required arrays (even as one-element stubs). (sim/test)
- [5676e8c] An `Invariant` whose check needs CONTENT (here a building type's `homeSize`) doesn't fit the
  `(world) => string[]` signature — but don't widen that signature across every call site / `checkInvariants`.
  Make a **content-bound factory** `populationWithinHousing(content): Invariant` that closes over content
  and returns the plain `Invariant`; a scenario opts in via `invariants: [factory(content)]`, and it stays
  OUT of `CORE_INVARIANTS` (those must run content-free against any world). Same trick a new self-balancing
  system uses to stay inert in the goldens: the births fire only on `home`-kind content the golden/slice
  fixture never builds, so the golden hash + trace are untouched ([6264132]) — verify by grepping the
  fixture for the triggering shape before claiming the hash is stable. (sim/invariants)
- [dc3ef54] A planner gate that keys on a `jobType`-ID predicate (`isNonWorkingAge`) silently snares an
  unrelated worker when a SYNTHETIC fixture's job id collides with a real data id: the golden slice's
  woodcutter is `jobType 1`, the same number as the real `baby_female` age class, so a new "skip
  non-working ages" check in the AI planner froze the whole golden trace to empty. The fixtures pick
  arbitrary small ids; the age-class ids 1–4 are a *real-data* meaning that doesn't hold in a fixture.
  Fix: gate on a COMPONENT whose presence carries the semantic (`Age` — only a born-young settler has
  one), not on the ambiguous id. When adding a sim rule keyed on a numeric content id that also has a
  reserved/structural meaning, prefer a component/flag the lifecycle maintains over the raw id — and run
  the goldens immediately, an emptied trace is the collision's tell. (sim/ai)
- [4874a0f] When folding a nullable field (`Settler.jobType`) onto a sentinel key, use `?? sentinel`
  (nullish), never `|| sentinel`: a `JobType` id of `0` (`none`) is a VALID id, and `||` would silently
  fold every id-0 settler into the idle bucket. Pick the sentinel OUTSIDE the field's value space — a
  negative (`IDLE_JOB = -1`) for an id space that starts at 0 — so the "unassigned" bucket can never
  collide with a real id. (sim/read-model)
- [c00bf18] **Mirror the real consumer's import surface, across BOTH barrels.** A `systems/*` export is
  NOT on `@vinland/sim`'s top level — `index.ts` re-exports it via `export * as systems from
  './systems/...'`, so the import is `systems.goodsGraph`, not a named top-level import; the unit test
  (importing `../src/systems/index.js`) passed while the hands-on `node -e` against `@vinland/sim` threw
  `does not provide an export named goodsGraph`. And a new read-view must land in TWO barrels
  ([de7f3fa]): `systems/readviews/index.ts` AND `systems/index.ts` (which re-imports and re-exports for
  the namespace); adding it to only the first leaves it `X is not a function` at the import site — NOT a
  build error (tsc happily compiles a barrel that doesn't re-export all its child does). Grep both
  `index.ts` for a sibling symbol and mirror it. (sim/barrel)
- [0708fb4] A read view that returns a `Map` keyed by a "canonical identity" silently DROPS records
  when that identity isn't actually unique — the combat view keyed weapons by the documented
  `(tribeType, typeId)` cross-ref key ([bfe2491]), but the real ANIMAL weapons reuse even that pair
  (tribe 5 = `chicken`+`claw` at typeId 1; tribe 8 = doubled `bearfist`), so the Map collapsed 105
  weapons to 103 last-wins. The unit fixtures (distinct keys) stayed green; only the hands-on real-IR
  `table.size` count (105 vs 103) exposed it. When a read view must lose no records, return an ARRAY
  (one per source entry, source order) and carry the non-unique key as a FIELD, not the Map key — and
  always assert the hands-on output COUNT equals the source count, a keyed-collection size is the tell.
  (sim/read-model)
- [9b41021] A "shared helper leaf" module (the one the cyclic systems import to break import cycles)
  silently becomes a dumping ground: terminal read views (HUD/render projections no per-tick system
  feeds back into a decision) keep getting added there because the barrel re-exports them either way,
  and it doubled in size unnoticed. The leaf's actual membership rule is "imported by ≥1 module in
  SYSTEM_ORDER to break a cycle" — anything only consumed by render/tests is a projection and belongs
  in its own module (`systems/readviews.ts`). Splitting it is a pure import-path move (barrel surface
  unchanged, goldens unchanged); the tell is `grep "from './shared'"` showing the system files never
  import the read views. (sim/structure)
- [4b91238] An `AtomicEffect` keeps the executor a pure state-mutation by carrying the **already-resolved**
  value, not a lookup key: the `attack` effect carries the net `combatDamage` (weapon×armor) the same way
  `pickup`/`eat` carry a resolved `amount`, so `atomicSystem` does the hit with no content/weapon lookup
  of its own (the join happens once, at planning time). A new combatant pool is a **separate optional
  component** (`Health`, like `JobAssignment`/`Age`) so non-combatants/the golden slice carry none and the
  hash is untouched; HP is **whole-integer** (animaltypes.ini scale 200..20000), not a 0..ONE fixed bar,
  so `hitpoints <= 0` death is exact. Clamp damage twice — floor the result at 0 AND floor the incoming
  `damage` at 0 — so a malformed (negative) effect can't silently *heal* the target. (sim/combat)
- [e2f3a83] The dangling-reference hazard a `world.destroy` creates depends on which DIRECTION the
  cross-reference points: destroying a *settler* (the new combat death path, the SECOND destroy site
  after `demolish`) is clean because the settler HOLDS its refs (`JobAssignment` points
  settler→building) — they vanish with it; the [71f13ab] hazard was the REVERSE (a *building*
  destroyed under a worker that still points AT it), handled at the `demolish` seam. So when you add a
  destroy site, audit only the refs that point *to* the destroyed entity, not the ones it holds; here
  no component points building→settler, so the new path needs no teardown. And a system that
  `world.destroy`s while scanning a store must collect-then-destroy (gather matches into a list first,
  mutate after) — and sort that list canonically when its side effects are observed (the emitted
  `settlerDied` events render reads), even though events aren't in `hashState`. (sim/combat)
- [8addb28] `sim.events` are cleared each tick, so a test that runs many `step()`s and then reads
  `sim.snapshot().events` only sees the LAST tick's events — a one-shot event (a kill's `settlerDied`)
  fired mid-loop is gone. Accumulate across the loop (`deaths += ...events.filter(...)` per step) to
  assert it, or the check silently degrades to a no-op (the `>= 0` trap). (sim/testing)
- [a4595ae] The "N data-defined tribes, never hardcode two" rule is satisfiable WITHOUT new code in the
  mechanics: the pipeline already extracts all 41 `[tribetype]`s and every sim rule resolves per-tribe
  off `settler.tribe → content.tribes.find(...)`, so the sim is tribe-agnostic by construction. The only
  thing missing was *classifying* which tribes are controllable — and the source distinguishes a
  civilization from an animal **by the data alone**: only a civilization carries `jobEnables` tech-graph
  edges (`jobEnables.length === 0` ⇔ animal, 0 mismatches against `jobRequirements` over the real IR).
  So the scaffolding is a pure read view filtering on that signature, not a hardcoded name/count. When a
  roadmap item says "data-defined X, never hardcode the count", first check whether the data already
  carries a *distinguishing field* — the classification is usually a read view, not a mechanic. And a
  read view that `.filter(...).sort(...)` is determinism-safe because `filter` allocates a fresh array,
  so the in-place `.sort()` never mutates the shared `content`. (sim/read-model)
- [fe7ac0e] A negative predicate over partial data has THREE truth states, not two: `isAnimalTribe`
  is NOT `!isPlayableTribe`. A tribe can be a known civilization (recorded, has tech graph), a known
  animal (recorded, empty tech graph), OR unknown (no record at all). `!isPlayableTribe` lumps the
  unknown case in with animals — wrong, because a no-record different-tribe combatant (a synthetic
  enemy) must stay a valid PvP enemy, not get silently reclassified as wildlife. When you split a set
  by a data signature, define each side as a POSITIVE membership test (`record exists && signature`),
  so the absent-record case falls through both rather than defaulting into one. (sim/data-classification)
- [4566b16] A "single source of truth" relation must gate BOTH sides itself, not lean on its one caller.
  `mayAttack(attacker,target)` first encoded only the target rules and let the combat loop skip a passive
  animal attacker — so `mayAttack(passiveAnimal, civ)` wrongly returned true; correct in-system (the loop
  guards), but a latent trap the moment a second caller uses the relation directly. Fix: fold the attacker
  gate into the relation; the loop's matching skip becomes a fast-path, not the authority. A relation
  documented as authoritative must be self-contained. (sim/combat)
- [9ce6413] A deterministic entity-scatter that CLAMPS each member's offset to a max radius silently
  re-uses tiles once the rings past that radius repeat (clamp(ring, range) collapses ring 3+ onto the
  range-2 ring) — two entities stack. It's only safe here because the sim has **no position-uniqueness
  invariant** (entities share tiles freely) and real `animaltypes` `maximumgroupsize` (3..6) stays under
  the 9-tile first-ring bound; assert the no-stacking property only for the sizes you actually spawn,
  and document the collision bound rather than implying a packing guarantee. (sim/spawn)
- [8617f44] A combat fixture gave its ANIMAL combatants a `jobType` so they'd resolve a weapon — but
  the real spawner (`spawnAnimalHerd`) places animals jobless (`jobType: null`), and the weapon lookup
  keyed on `(tribe, job)`, so every *actually-spawned* aggressive animal silently did **zero** damage
  while every unit test passed. When a producer (a spawn command) and a consumer (a weapon resolver)
  disagree on a key field's shape, a fixture that pre-fills the field hides the gap; test the consumer
  with the *exact* shape the producer emits (here: a jobless animal), and exercise the full `step()`
  schedule end-to-end, not the system in isolation. (sim/combat)
- [bec7cfc] A numeric tuning option threaded into a modulo/comparison loop (`chosen % stride`, `len >=
  maxHerds`) silently MIS-behaves on a non-finite value: `Math.max(1, Math.floor(NaN))` is `NaN`, and
  every comparison with `NaN` is false — so `% NaN === 0` never picks (empty result) and `>= NaN` never
  caps (uncapped result), both failing QUIETLY rather than throwing. The TS `number` type doesn't forbid
  `NaN`, so a public API that loops on an option should `Number.isFinite(opt) ? clamp : default` (fall
  back to the documented default), not just `?? default` (which only catches `undefined`). Guard the
  option where it enters the loop, not at the call site. (sim/api)
- [bec7cfc] A "map populator that seeds wildlife" is faithfully a PURE command-PRODUCER, not a system:
  `seedAnimalHerds(content, terrain)` returns the `spawnAnimalHerd` commands a caller enqueues through
  the one mutation seam — so it touches no entity store (trivially deterministic/replay-faithful, inert
  on goldens because nothing calls it there) and stays out of `SYSTEM_ORDER` (seeding is a one-shot at
  map load, not per-tick). When a roadmap step is "issue command X to populate the world", prefer a pure
  function returning `Command[]` over a new tick system; the command seam already gives you logging,
  replay, and determinism for free. (sim/architecture)
- [1f8f2c9] Adding one field (`leaderDistance`) to a derived-view struct (`HerdParams`) broke three
  `toEqual` assertions that snapshot the whole object — `toEqual` is exhaustive, so a grown read view
  ripples into every test that pins its full shape. That is the *intended* tripwire (a view's shape is
  part of its contract), but budget for it: when you widen a struct, grep its `toEqual(` call sites and
  give the new field a *meaningful* fixture value (not the schema default) so the assertion still proves
  something. (sim/readviews)
- [3f064cd] A "stamp a timer component, reap it on read" pattern (`Anger`, reaped by `hostileAnimalNow`)
  leaks stale state if the reaper SHORT-CIRCUITS before reading it: an aggressive+`getAngry` animal
  returns hostile on the `isAggressiveAnimal` check and never reaches the `Anger`-expiry branch, so a
  redundant stamp would never be reaped. Fix at the STAMP site (don't stamp when the entity is already
  unconditionally in the state the timer grants), not only the reaper. Inert components must still be
  hash-clean — a never-reaped optional component would drift the state hash. (sim/combat)
- [3f9b610] The synthetic fixture's tidy weapon ranges (`maxRange 2`, adjacent fighters) hide that REAL
  weapons carry a `minRange` (the real `hunter_bow` is `minRange 3, maxRange 17`) — and `attackerWeapon`
  enforces only `maxRange`, so a fixture-adjacent strike "passes" while a real bow can't hit a tile-1 prey
  in the original. A green unit test on the fixture didn't reveal this; only running the actual pipeline IR
  through `step()` did (the deer fixture struck fine at distance 1; the real cow only after seeing the
  `minRange`). When a mechanic reads a numeric range/threshold param, check the REAL data's spread, not the
  fixture's convenient value — and note any param the sim doesn't yet honor. (sim/combat)
- [469e2c8] Adding a `minRange` floor (`dist < minRange` rejects a candidate) silently changes the
  *same-cell* (Manhattan distance 0) case the old `maxRange`-only check let through: with `minRange`
  floored at 1, a co-located target is now "too close" and unhittable. It's the faithful reading of
  `minimumrange 1` ("at least one cell away"), but it's a real behavior shift reachable whenever entities
  stack (the herd scatter can — there's no position-uniqueness invariant, [9ce6413]). When you add a
  near-bound to a reach/threshold that was previously open at 0, name the dist-0 consequence in the doc
  and confirm no test/golden places two combatants on one tile — the change is invisible until they do.
  (sim/combat)
- [4d44dec] The `combatSystem` targeting drive silently does NOTHING unless TWO preconditions hold that
  the `atomicSystem` unit tests bypass: (a) `ctx.terrain` is defined — a **mapless** `Simulation` (no
  `opts.map`) returns immediately, so no target is ever picked; (b) the **attacker** carries a `Health`
  pool — the combatant scan is `world.query(Settler, Health, Position)`, so a `Health`-less hunter is
  never even scanned. The attack-effect unit tests `startAtomic` the `attack` directly and so prove the
  hit/yield without ever exercising targeting — a full-`step()` hands-on harness that omits a map or the
  attacker's `Health` sees the prey sit untouched forever (looks like a broken feature; it's a missing
  precondition). When hands-on-verifying a combat/targeting change end-to-end, build the sim WITH a
  walkable map (and a real-content map needs a real walkable landscape typeId — typeId 0 is absent from
  the real IR, use one that exists) and give every intended combatant a `Health` pool. (sim/combat)
- [bfa4a13] A hands-on number can COINCIDE across the old and new code path and silently fail to prove
  the new branch ran: armor mitigation resolved a leather-clad hit to `damage["1"] 60 − blockingValue
  10 = 50`, the *same* number as the old unarmored `damage["0"] 50`, so "first attack damage = 50" was
  identical with and without the armored path. What actually proved the new path executed was the
  **state hash differing** between the two runs (the `Armor` component live in the hash). When verifying
  a new code path, pick fixture values whose output DIFFERS — or lean on `hashState()`, not a scalar that
  can collide. (sim/combat)
- [8fb6543] A new entity that carries `Stockpile`+`Position` (the boat `Vehicle` hull) is ALREADY a
  deposit sink the instant it exists — `nearestStoreFor`/`pileup` scan `Stockpile`+`Position`, not
  `Building`, and `stockCapacity` returned `MAX_SAFE_INTEGER` for it (the "no Building ⇒ bare fixture,
  uncapped" branch). So `placeBoat` had silently made a hull an UNCAPPED catch-all store accepting any
  good; the cargo-load step is really *restricting* an over-permissive default (gate by `cargoGoods` +
  `stockSlots`), not adding a brand-new path. When you add an entity with a component that a generic
  scan keys on, check what the existing helpers already do with it BEFORE writing the "new" behavior —
  the default may already be wrong, not absent. (sim/ai)
- [e4d77a8] The sim's `EventBuffer` exposes `current()`/`clear()`, NOT a `drain()` — and it's only
  cleared at tick start by `step()`. When unit-testing a system by calling it DIRECTLY (not via
  `step()`), the buffer is never cleared, so read its emitted events with `current()`; reaching for
  `drain()` (a different bus's API) won't compile. (sim/testing)
- [3950dc3] An in-place mutation inside a `world.query` loop (a home upgrade flipping `Building.buildingType`)
  is safe to NOT re-process the same tick — but for the right reason: `world.query` is a **lazy generator**
  iterating `smallest.store.keys()` live, NOT a snapshot, so the "at most once" guarantee comes from each
  entity id being *yielded once* and the upgrade keeping the same store key (mutate the value, add/remove no
  entity), not from any snapshotting. Don't write "the matches are snapshotted" in a determinism rationale —
  it's wrong and a future maintainer who *adds* an entity mid-loop (which CAN perturb a live `Map`-keys
  iteration) would trust a false premise. State the real invariant: same key, yielded once. (sim/determinism)
- [0a6d0fc] A guard that holds only as an *incidental* side effect of one subsystem's data model is a
  latent bug the moment a second input dimension overlaps: `productionSystem` "didn't" run on an
  under-construction site only because a construction site's `stockCapacity` advertised its build
  materials, so a recipe OUTPUT not in the cost got room 0 → cycle never started. But the INPUT side
  of `canStartCycle` reads the raw stockpile, never `stockCapacity`, so a recipe whose input overlapped
  a delivered build material WOULD have been raided — and production runs before construction in
  `SYSTEM_ORDER`. A doc even *claimed* "production already gates on built" when it didn't. When a
  desired invariant ("unbuilt ⇒ no production") is true only by emergent coincidence of another
  system's capacity arithmetic, make it an explicit gate (`built < ONE → continue`); the coincidence
  breaks the instant the two goods sets intersect. Grep the other iterators of the same component pair
  for the same gap (housing/reproduction already gated; `tribeStocks` deliberately doesn't). (sim/production)
- [15cdcb6] `stockCapacity` is a SOFT carrier-scan advertising ceiling, not a hard cap any invariant
  enforces (`stockNonNegative` only bounds [0, 2^31)). So to make a store pull in EXTRA goods (a built
  home accumulating its next-tier upgrade cost), just RAISE its advertised capacity — `Math.max(slotCap,
  upgradeAmount)` — and the existing `nearestStoreFor`→`pileup` path delivers them; no new transport
  code, and transiently holding more than the nominal slot cap trips nothing (no "stock ≤ slotCap"
  invariant exists). Before raising a capacity to drive delivery, confirm no invariant treats it as a
  hard bound; here none does, so the seam composes for free. (sim/transport)
- [ba01ac0] `tribePopulation` counts EVERY settler of a tribe as a housed mouth — workers/carriers
  included, not just colonists — so a composed e2e test that seeds delivery-carriers as that tribe's
  settlers must give the home capacity ABOVE the seeded worker count, or `populationWithinHousing`
  fires the instant the seeded settlers exceed housing (my first cut seeded 2 carriers against a
  capacity-1 home → "population 2 exceeds capacity 1" on tick 1, before a single birth). And
  `GROWUP_TICKS` is 8192 (≫ a 200-tick test window), so babies never mature mid-run — each birth
  permanently occupies a slot, so the standing baby count equals exactly the spare capacity, not a
  churning generation. When wiring a multi-system loop test, size the fixture so the seeded support
  agents fit UNDER the ceiling the loop grows, and read the real growth/age constants before assuming
  settlers turn over within the run. (sim/test)
- [c7f2657] An extracted magnitude param can be directionally AMBIGUOUS with no oracle — `animaltypes`
  `movespeed` could mean "faster" or "slower" (a butterfly's 48 vs a dog's 10 fits neither intuition),
  and OpenVikings' sim is a stub so it carries no semantics. The disambiguator was the data's OWN
  internal consistency: every animal that sets both has `runspeed < movespeed`, and a "run" gait must be
  the *faster* one, so a smaller number = fewer ticks/tile = quicker → `movespeed` is a step-PERIOD
  (bigger = slower), wired as `perTick = ONE/movespeed`. When a param's scale direction isn't pinned,
  look for a sibling param whose meaning IS known to fix the direction, then record the inference as the
  explicit approximation (docs/FIDELITY.md) rather than guessing silently. (sim)
- [27aa306] When a roadmap step is "wire mechanic X" but the DRIVE that fires X is oracle-blocked
  (undocumented "soul" behaviour — e.g. *when* an animal flees/charges to use its `runspeed` gait),
  split it: the DATA half — stamping the extracted param onto the entity (`MoveSpeed.runPerTick`) — is a
  clean, faithful, self-verifiable step on its own, even with no consumer yet, exactly as `Armor`/
  `cargoGoods` landed before their consumers. The deferred drive then becomes a pure read-switch, not a
  re-extraction. Make it inert (the mover still reads only the walk pace → golden untouched) and record
  the drive as deferred (docs/FIDELITY.md). Don't reject the whole step as "speculative" just because the
  behaviour half is blocked — and don't invent the drive to avoid an "unused field". Validate the benign
  edge cases against the REAL IR (here: 0/35 animals set `runspeed` without `movespeed`, so the run pace
  is never silently dropped) so the gate you anchor on is provably right, not just plausible. (sim)
- [c05fa8b] **A read view's SHAPE follows the field's cardinality + optionality.** Cardinality: a field
  EVERY row carries (a class enum like `mainType`, all 105 weapons) → a lossless GROUPING
  `Map<class, T[]>` (`weaponsByClass`); a field MOST rows LACK (an optional marker like `munitionType`) →
  a binary FILTER (`rangedWeapons`). Optionality ([cc9c3d2]): a `.default(0)` QUANTITY is always a number
  post-parse — read it straight, `0` IS the value, no `?? 0` / undefined bucket; a `.optional()` enum is
  `number|undefined` — drop the undefined bucket. Grouping VALUES stay arrays even when the record id is
  unique, because you key on the many-to-one CLASS field, not the id ([c0dcbcb]). Keep it lossless: array
  values in SOURCE ORDER, never keyed on a non-unique pair (the [0708fb4] drop trap), and assert the
  hands-on output count == source count. Reading an optional field's PRESENCE as a boolean class needs a
  `grep '<key> 0'` first — `getInt` returns `0` (present) for a literal `key 0`, so distinguish absent
  from zero unless the source never writes it ([59dc5c8]). A Map-valued view may be built non-canonically
  ([dc1bb9b]) but a display consumer sorts the keys itself. (sim/read-model)
- [af3cd84] **Smallest faithful step when behavior is oracle-blocked: a lossless read view over an
  already-extracted-but-unread field.** Scan a record for the one field whose siblings all have accessors
  but it doesn't (`ArmorType.materialType` vs `mainType`/`blockingValue`/`goodType`) — the view is
  FIDELITY-n/a, golden-untouched, self-verifiable. Generalizes past type tables to the **animation IR**
  and past groupings to a **name-keyed resolver** when two systems inline the same
  `content.X.find(a => a.name === n)` ([101108e]: `atomicAnimationByName`). An oracle-blocked BINDING
  often already has its cross-ref field extracted, so the data-join read view is the testable half you
  can land now ([f9a83f0]: `weapon.jobType` → `weaponsForJob`). Enumerate the EXTRACTED fields (grep the
  extractor), not the views a module's header CLAIMS ([a82afa7]: a "triple" with 2 of 3), and not just at
  record level — an aggregate/sum HIDES still-unread PER-ELEMENT fields, enumerate the nested record too
  ([d49f9ea]: a channel-delta sum hid `AtomicEvent.extended`). A magnitude hardcoded in a doc COMMENT is a
  latent gap and the prose can be WRONG — derive it from the IR ([24bec38]). (sim/read-model)
- [d35b6d1] A replay/scrub primitive's "guard against dropping commands" can BAN its own core use case —
  my first `replay()` threw when `untilTick` was before the last logged command, reasoning "trailing
  commands would be dropped → divergence". But scrubbing BACKWARD past later commands is the whole point
  of a time-travel inspector: the state AT tick 50 (before the tick-400 command) is faithful, not a
  divergence. The unit tests passed (they only scrubbed within range); the 3b hands-on harness — a
  1000-tick run with a mid-run command + a `demolish` — threw on the very first scrub to tick 50. The
  honest invariant for a tick-target is only `>= 0`; "did every command apply?" is a property of a FULL
  replay (default untilTick = last logged tick), not of an explicit scrub. Don't let a guard encode "the
  only valid target is the end" when the feature is "jump to ANY tick". (sim/replay)
- [e44bc5b] A bounded ring-buffer recorder that "ages out" a heavy secondary payload (here `HashTrace`'s
  snapshot window inside its larger hash window) should strip only the ONE entry that just crossed the
  window boundary — not rescan the whole ring every `record()`. The first cut walked `length -
  snapshotCapacity` entries per tick (O(n²) over a run, and pointlessly when the payload is off entirely);
  because the loop ran on every prior record, everything older is already stripped, so the boundary entry
  is the only candidate. Tests passed either way (correct, just slow) — the cost only shows on a long live
  run, exactly the case the ring exists for. When you bound a buffer, bound its per-step WORK too. (sim/perf)
- [e21ebe4] When two read-views must AGREE by contract (here `traceEntity`'s per-tick delta == an entity's
  slice of `diffSnapshots`'s two-tick diff), don't copy the comparison helper into the second module — they
  silently drift the day one is "fixed". Export the one `diffComponents`/`valuesEqual` from the module that
  owns the equality contract and import it, so the agreement is structural, not a thing tests must re-prove.
  Same canonical-JSON equality also keeps both agreeing with `hashState`. (sim/read-model)
- [68e82cf] `hashState()` and `diffSnapshots()` do NOT cover the same state, so a hash divergence can be
  diff-EMPTY: `hashState` mixes `rng.getState()` + the tick, but a `WorldSnapshot` (and thus the diff)
  carries only entities/components — so two runs whose RNG streams have split but whose entities are
  byte-identical hash-differ yet diff-empty. When you compose "hashes diverged at tick N" with "show what
  changed", don't claim the diff is non-empty by construction — an empty diff alongside a real divergence
  is the useful signal "entities match; the split is in RNG/tick", and the composer must return the
  divergence anyway (not treat empty-diff as no-divergence). The two debugging oracles have different
  scopes; state which one you're keying on. (sim/replay)
- [6dfcddb] Identifying "the entity spawned at tick T" in a scrub-window test by "new since the window
  START" is wrong when the window contains MORE THAN ONE structural event: the `scrubWindow` trace test
  meant to follow the tick-6 carpenter but keyed on `!presentAtTick4`, which ALSO matched the sawmill
  PLACED at tick 5 — and `Array.find` returned that first new id, so the trace asserted "alive at 5"
  and failed. Key a spawned-entity identity on the EXACT life-edge (absent at T-1, present at T) AND the
  discriminating component (`'Settler' in components`), not on a coarse "new since the window opened" —
  buildings, settlers, and other entities all appear as `added` and a window-start baseline lumps them.
  The failure is loud (the trace's alive-flags shift), but the fix is to make the test's selector as
  specific as the entity it names. (sim/test)
- [8fbd673] A property a DOCSTRING claims but no test PINS is a latent regression — the snapshot's
  "transferable for free" (no class instances / live `Map`s) was asserted only in prose, so a future
  component holding a live `Map`/class on the snapshot would silently break the Web-Worker move with
  the docstring still saying "free". The exact oracle for the `postMessage` boundary is
  `structuredClone()` (the real structured-clone algorithm — it throws `DataCloneError` on a function /
  class instance / live `Map`), NOT a `JSON.stringify` round-trip, which would *silently* serialize a
  live `Map` to `{}` instead of throwing. Pin a claimed transferability/serializability invariant
  against the actual boundary's algorithm on a REAL `step()`-driven value (with the non-trivial shapes
  present — a building's `Stockpile` Map), not a hand-built fixture that may omit the very shape that
  would break it. (sim/test)
- [c0d1263] A "changed content changes the run" assertion silently no-ops if the tweaked param's
  mechanic never engages in the scenario — halving a sawmill recipe's `ticks` left the hash identical
  because no wood was ever delivered, so the recipe never ran. Pick a param reachable by the commands
  that actually fire (e.g. a placed building's `stock[].initial`, read at placeBuilding time) and
  PROBE the state to confirm the effect, don't assume a deep production chain engages. (sim/test)
- [d80eb0a] A replayed/rebased sim RE-LOGS the commands it consumes (CommandSystem `record`s each
  applied command), so `replay(...).commands.log` and `rebaseContent(...).sim.commands.log` reproduce
  the input log byte-for-byte (modulo commands past `untilTick`). That is what lets the hot-reload
  workflow CHAIN — a second `rebaseContent` can take the first rebase's log and carry the whole player
  history forward; the rebase isn't a dead-end snapshot. (sim)
- [felling] A bare `Stockpile` that is BOTH a collect SOURCE and a valid delivery SINK livelocks: a
  felled-trunk `GroundDrop` pile is picked up FROM, so if `nearestStoreFor` also treats it as a wood sink
  the collector deposits the wood straight back into the trunk it just lifted (the nearest sink is the
  trunk at its own feet). A drop/source pile must be EXCLUDED as a delivery target (`nearestStoreFor`
  skips `GroundDrop`); the same marker scopes its auto-reap-when-emptied (a collected trunk vanishes, a
  designated flag — a marker-less bare `Stockpile` — persists). When adding an entity kind that is both
  gathered-from and delivered-to, decide the source/sink role explicitly, don't let one bare shape be both. (sim)
- [lattice-metric] A SQUARE-GRID reading of the staggered raster is wrong in three compounding ways at
  once: it invents two phantom "long diagonal" edges per cell (the lattice has SIX neighbours, parity-
  dependent), prices the four real row-crossing edges √2 when their true world length is ¾ of a column
  (the measured 68×38 pitch gives √(34²+38²)/68 ≈ 0.7498 — near-exactly ¾), and measures speed in grid units so the on-screen
  pace varies ~2× by heading. Symptoms present as three separate bugs (zigzag routes, sideways drift,
  speed wobble) but share the one root: path costs, pace AND facing must all consume the lattice world
  metric (`nav/metric.ts`), never raw grid units. Also: cost-EQUAL lattice weaves are plentiful (straight
  down = any SE/SW interleaving), so the A* tie-break needs a line-deviation key — a pure function of
  (cell, start, goal), so it stays lockstep-safe — or the id tie-break picks a visibly drifting weave.
  (sim/movement)
- [9ae3294] Two systems that both write a unit's `MoveGoal` fight each other unless the yielding one
  clears movement ONLY on the transition. `combatSystem` runs AFTER `aiSystem` in `SYSTEM_ORDER`, so
  when the flee drive yields to a collapsing need it can't hand off this tick — it sets up next tick's
  AI. If it cleared the flee `MoveGoal` every tick it saw the collapse, it would ALSO cancel the eat/
  sleep `MoveGoal` the AI freshly set (indistinguishable — both are just a `MoveGoal`), and the unit
  oscillates forever, never reaching food. The fix: shed the drive's marker + route only while the
  marker is still present (the one transition tick); once yielded (no marker) leave the other system's
  goal untouched. General rule for any "soft override that hands control back". (sim)
