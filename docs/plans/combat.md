# Combat — faithful field-combat plan (agent prompts)

Goal: implement the original's combat end-to-end, faithful to the extracted data — the four
military behavior modes (attack / defend / ignore / flee — civilians flee by default, the scout
ignores, warriors engage on sight); melee with a real approach walk and per-weapon swing cadence;
ranged weapons that launch a visible projectile at the animation's ATTACK frame; the per-material
weapon-vs-armor damage tables (spears pierce plate, swords beat chain); combat experience in the
per-weapon fight buckets; hit/stagger/shoot animations on the decoded warrior body; blood, death
into a cadaver, hit-point bars, impact sounds; barracks recruitment + training; tower garrisons +
defence mode. Battles are verified by acceptance scenes in which two player-colored armies fight.

Research basis (2026-07-03), verified against the sources: **the combat data model is almost
entirely readable** (re-verify before coding — this doc is research output, not ground truth):

- `Data/GameSourceIncludes/logicdefines.inc` (shipped Funatics header — the enum Rosetta Stone):
  `MILITARY_MODE_{NONE 0, ATTACK 1, DEFEND 2, IGNORE 3, FLEE 4}` (~l.1107) — the player-selectable
  stances; `ARMOR_MATERIAL_TYPE` (~l.948): 0 NONE, 1 WOOL, 2 LEATHER, 3 CHAIN, 4 PLATE, 5 STONE,
  6 WOOD, **7 HOUSE** — the index space of a weapon's `damagevalue` lines; atomic actions
  `ATTACK 81, ATTACKED 82, SHOOT 83` (~l.702), `EXERCISE 89, TRAIN 90`; animation-event types
  (~l.719): **25 = ATTACK (the frame the hit lands / the projectile launches)**, 28
  GET_EXPERIENCE, 29 GET_TRAINING, 34 PLAY_SOUND_FX; fight-XP buckets (~l.598):
  `JOB_EXPERIENCE_TYPE_FIGHT_{FIST 71, SPEAR 72, SWORD 73, AXE 74, BOW 75, CATAPULT 76}`,
  `TRAINING 77`; munition `{ARROW 1, ROCK 2}`; `DAMAGE_TYPE_RADIAL 2` (catapult splash); particle
  effects `HIT 1`, `DEATHBREATH 4` (~l.1080); cadaver landscape types `CADAVER_LEATHER 79,
  CADAVER_MEAT 80, CADAVER_SKELETON 81, SKELETON_FALLING 87` (~l.119); weapon-impact sound ids
  67–96 + `MAN/WOMAN_GET_HIT 97/98` + per-beast 101–119 (~l.831).
- `DataCnmd/types/weapons.ini` (3274 lines, 105 records — the decrypted `weapontypes.cif` twin;
  already extracted as `WeaponType`): per weapon `mainType` (1 fist…6 bow, 7 catapult),
  `minimumrange`/`maximumrange` (long sword 1–2, short bow 3–15, long bow 4–23, hunter bow 3–17,
  house bow 0–29, catapult 8–24 — a close-in dead zone), `munitiontype` + `speed` (arrow 8 /
  house 7 / rock 3 — projectile travel speed), `jobtype` (the weapon→soldier-class binding:
  short bow → job 40), `goodtype`, and the **full per-material `damagevalue` table** — damage
  values are identical across the 5 human tribes. The asymmetry is deliberate rock-paper-scissors:
  iron spear 950 vs CHAIN / **2090 vs PLATE** (armor-piercing), long sword **2090 vs CHAIN** /
  950 vs PLATE. Columns 6/7 are damage **vs trees/walls and vs buildings** — NOT "unarmored"
  fallbacks. Also readable: `soundtype_Hit <material> <sfxId>` / `soundtype_NoHit` per weapon
  (not yet extracted), catapult `damagetype 2` + `hitself 1` + `createsmoke`.
- `Data/logic/armortypes.ini` (4 records): armor's `materialType` (wool 1 / leather 2 / chain 3 /
  plate 4) **selects the attacker's damage column — the per-material value IS the resolved
  damage**; `blockingValue 5` (uniform on all four) has an unknown engine-side role (block
  chance?). Our current `combatDamage` (`packages/sim/src/systems/readviews/combat.ts`) instead
  computes `damage[class] − blockingValue` and treats columns 6/7 as unarmored — **both diverge
  from the data and need re-pinning**.
- `DataCnmd/atomicanimations12/atomicanimations.ini`: each `<tribe>_<class>_attack_<weapon>`
  carries the swing cadence (`length`: unarmed 12, spears 27, sword_short 12, sword_long 29,
  bow_short 12, bow_long 28, hunter 25, catapult 48) and an `event <frame> 25` mid-animation
  (sword_short @9, spear @17, bow_short @10, bow_long @22) — damage/launch happens THERE, not at
  completion. Every soldier swing also drains `event 2 1 -20` + `event 2 2 -20` (the need
  channels the extracted `atomicEventChannelDelta` read view already decodes); woman/civilist
  attacks drain −100. `<class>_attacked` (stagger, e.g. `viking_woman_attacked` length 50)
  carries **zero events** — purely visual. `viking_soldier_train` length 28 → `event 2 30 -1`
  (spend a coin) + `event 22 29 +25` (training XP); `_exercise` → `event 22 29 +1`.
- `Data/logic/humanjobexperiencetypes.ini`: `soldier general` (type 69, job 31) has
  `experiencefactor 1` — field combat levels glacially; the fast path is barracks training
  (+25/rep). The `needforjob` records in `DataCnmd/tribetypes12/tribetypes.ini` reference
  fight-bucket expTypes (72/73/75 observed) — the existing JobSystem `needforjob` gate is
  already the mechanism that locks better soldier classes behind fight/training XP.
- `Data/logic/jobtypes.ini`: the combat roster — soldiers 31–41 (unarmed / wooden+iron spear /
  short+long sword / short+long saber / small+big axe / short+long bow), heroes 42–47, hunter 15
  (`allowatomic 81` + 33 harvest-cadaver — the civilian/military hybrid), scout 27 (no combat),
  woman 5 / civilist 6 (fist weapons). `Data/logic/animaltypes.ini`: animal HP (bear 15000,
  wolf 1000…), `aggressive`/`getangry`+`angryGameTime`, `runspeed` — already extracted/consumed.
- **NOT in readable data** (engine-hardcoded or encrypted): human base HP / stamina pool / sight
  radius / run speed, the XP→level curve and per-level bonuses, the exact role of
  `blockingValue`/hit-vs-miss, heal/potion/amulet magnitudes, building hit-points, projectile
  and blood sprites. These become named calibration constants (step 10 observes the original).
- **No death animation exists**: grep over all decoded `[bobseq]` names finds no `_die`/`_death`
  — the original transforms a killed unit into a cadaver landscape object (skeleton_falling →
  skeleton); `extractLandscapeGfx` already emits the cadaver records among its 866.
- Current code seams (research-time refs; **main moves under parallel sessions — re-check**):
  sim combat loop EXISTS (`packages/sim/src/systems/conflict/combat.ts` — in-place targeting →
  attack atomic 81 → `atomic.ts` `resolveHit` → `lifecycle/cleanup.ts` reap + `settlerDied`);
  components `Health/Armor/Weapon/Anger` (`components/combat.ts`), `Owner{player}`
  (`ownership.ts`), `MoveSpeed.runPerTick` extracted but unconsumed; `nearestEnemyTarget` is a
  **full-scan O(combatants × entities)** — `packages/sim/AGENTS.md` flags it and the plan
  "ring-search nearest-X" (tier 3) is the named fix; no `attack`/`stance` command exists;
  render binds NO attack animation (atomic 81 falls back to idle), the decoded warrior body
  `cr_hum_body_05` (57 seqs: per-weapon `human_man_Warrior_*_Attack`, `Walk/Wait_agressive`,
  `spear_throw`, unarmed punches) is entirely unused; `PalettedSprite` has the 256×16
  player-colour LUT but `DrawItem` carries no owner; no HP bar anywhere (the original renders
  one — OpenVikings `CGuiBaseDataManager.cs` loads `gui/palettes/bar_hitpoints.pcx`); audio's
  only combat feedback is the death jingle.

**How to use:** run each prompt below, in order, in a fresh session (`/worktree`). Merge before
starting the next — later prompts consume earlier outputs. Prompts are self-contained; they also
tell the agent to re-verify facts against the sources (parallel sessions move main — always
re-read the current seams first). When a step merges, tick its box and delete its prompt block
(the checkbox line and progress note carry the state; git history keeps the prompt). Delete this
file when all steps land. Steps 8–9 are severable if the scope must shrink; step 10 can run any time after 7.

- [x] 1. Sim: true damage model — **landed:** material-column damage (readviews/combat.ts — no
      `blockingValue` subtraction, `damageVsWood`/`damageVsBuilding` read views), ATTACK-event-frame
      hit resolution, swing cadence = animation length.
- [x] 2. Sim: engagement — **landed:** owner-keyed hostility, `NodeBuckets.nearest` ring search
      (systems/shared.ts), walk-into-melee advance, `attackUnit` command (core/commands.ts).
- [x] 3. Sim: stances — attack / defend / ignore / flee
- [x] 4. Sim: ranged combat — **landed:** `Projectile` entities launched at the release frame,
      travel + on-contact damage (systems/conflict/projectile.ts).
- [x] 5. Render: warrior bodies + combat animations — **landed:** attack swings drawn from the extracted
      `[gfxanimatomic]` per-direction frame lists (new `gfxAtomics` IR lane + render `FrameListAnim`), the
      readied `_agressive` walk/wait while engaged, an attacker faces its target's live tile; civilist/woman
      fist brawl; `?scene=combat` + `?anim` are the sign-off surfaces.
- [ ] 6. Render: combat feedback — player colours, HP bars, blood, cadavers, impact sounds
- [ ] 7. App: battle acceptance scenes + battle golden + scale proof
- [ ] 8. Sim+app: barracks — recruitment (equip) + training
- [ ] 9. Sim+app: towers, defence mode, building damage
- [ ] 10. Calibration against the original (interactive — the user is the oracle)

Out of scope for this plan: the **catapult/siege vehicle** (blocked on vehicle graphics and vehicle-entity sim; its data facts are recorded above for
when it lands), **heroes + potions/amulets** (jobs 42–47, goods 44–55 — every magnitude is
unreadable, pure calibration; defer until step 10's machinery exists), **walls/gates as
damageable landscape** (needs the landscape-transition machinery the gathering-economy plan
builds), **diplomacy/alliances** (hostility stays binary per player), and **other-tribe render
sets** (plan defers them behind the viking set — battles are viking vs viking, told apart by
player colour).


## Progress notes (steps 1–4 — the calibration/approximation state step 10 consumes)

The full state is greppable in the code (`calibration` / `APPROXIMATED` / `SIGHT_RADIUS` in
`packages/sim/src`); the compact index:

- Damage model faithful to data: the victim's armor-material column IS the damage; `blockingValue`'s
  engine role UNKNOWN — deliberately not applied (`systems/readviews/combat.ts`).
- Hit resolves at the ATTACK event frame (completion fallback when an animation lacks the event);
  swing cadence = animation length (`systems/conflict/atomic.ts`).
- `SIGHT_RADIUS_TILES = 8` — calibration-by-observation pending, step 10 (`systems/conflict/combat.ts`).
- Stance semantics (DEFEND radius/leash, FLEE run gait + cool-down) approximated,
  calibration-pending (`systems/conflict/combat.ts`, `conflict/ai.ts`).
- Projectiles: `speed` VALUE faithful; its unit + homing + always-hit approximated
  (`systems/conflict/projectile.ts`).
- Hostility is binary per player — no diplomacy/alliances (`systems/conflict/combat.ts`);
  fight-bucket XP accrual trigger approximated (`systems/conflict/atomic.ts`).

## Progress note — step 5 (render: warrior bodies + combat animations)

2026-07-08, branch `feat/warrior-combat-anims`. Landed the combat animation render, faithful to the
extracted `[gfxanimatomic]` join. Verification: `npm test` (1607) + `npm run check` + `npm run build`
green; the pipeline re-run regenerated `content/` with the new `gfxAtomics` lane; author-eyeballed a
`?scene=combat` screenshot (soldiers draw with weapon + head, no console errors) and the `?anim` warrior
gallery. **Human pixel sign-off still pending** — the swing/facing/feel is the user's call.

- **New IR lane `gfxAtomics`** (`packages/data` schema `GfxAnimAtomic`, pipeline
  `extractGfxAnimAtomics`): the `(tribe, job, action)` → body bobseq + **per-direction frame-index lists**
  the directional action layout needs. A melee swing pool is NOT a `length/8` strip and authors per-facing
  holds/reuse, so the bare `bobSequences` range can't drive it. Faithful, complete extraction (all tribes).
- **Render `FrameListAnim`** (`packages/render` `bindings.ts` + `settler.ts`): a third `SpriteFrameRef`
  kind that replays an explicit per-facing frame list verbatim on the atomic clock. The attack swing binds
  to it; heads follow for free (the head atlas covers every body frame id, empty-frame guard handles
  baked-in heads).
- **Attack seqs are the VIKING (`logictribe 1` = `TRIBE_TYPE_HUMAN_VIKING`) source join**, transcribed not
  guessed — short sword `Sword_Attack_2`, long sword `Broadsword_attack`, short/long bow
  `Shortbow/Longbow_attack`, spear `spear_attack`, unarmed `empty_punch`, civilist/woman fist brawl. The
  per-direction counts match the viking atomic-animation lengths (spear 27, sword_long 29, bows 12/28).
  **Scoped-id gotcha recorded:** the `[gfxanimatomic]` `logictribe` numbering is `logicdefines.inc`
  `TRIBE_TYPE_*` (viking 1), and the SAME body seq recurs across human tribes with DIFFERENT frame lists —
  filtering by the wrong tribe yields a plausible-but-wrong swing (`sprite-sheet.ts VIKING_ANIM_TRIBE`).
- **Facing:** an attacker (atomic 81) faces its target's LIVE tile (`readAtomicTargetEntity` + a per-frame
  id→tile map in `sprite-scene.ts`), overriding a stale path — a stationary swing has no walk heading. The
  `gfxanimframelistdir <dir>` space is NOT the strip-block order (the first cut assumed it was — swings drew
  rotated, human-caught): it is the engine's movement ring (0 E, 1 SE, 2 SW, 3 W, 4 NW, 5 NE, 6 N, 7 S),
  DATA-PINNED by cross-checking every uniform-×8 HUMAN character-body `[gfxanimatomic]` record against its
  strip blocks (`GFX_DIR_TO_BLOCK = [4,5,0,1,2,3,7,6]` in `settler-gfx.ts`; ZERO dissent among the human
  bodies these bindings draw). The animal/vehicle libs carry their own block orders (bear, bull, bullcart
  differ) — unbound here, so irrelevant.
- **Aggressive gait:** `SettlerStateBinding.engaged` swaps the `_agressive` walk/wait while the sim
  `Engagement` marker is set (`readEngaged`). The unarmed body authors no aggressive variant → falls back
  to its relaxed gait (named).
- **Approximations (calibration/sign-off pending):** (a) a few UNARMED/civilian gfx frame-list lengths
  differ slightly from the sim atomic duration (unarmed 17 vs 12, civilist 17 vs 16, woman 15 vs 16) → the
  swing loops tick-locked like the chop; **impact-frame alignment to the sim hit-frame is montage-verify**.
  (The armed soldier swings match by construction: spear 27, short sword 12, long sword 29, bows 12/28.) (b) **No `_attacked` stagger bobseq exists for vikings** (only a logic-timing record) —
  a struck unit has NO dr, it just loses HP; honest data gap, recorded in the scene checklist. (c) Saber/axe
  jobs 36–39 have no viking gfx binding → they borrow their spec's sword/broadsword swing (named). (d) The
  unarmed body picks the `empty_punch` variant of four; the original randomises.
- **`?scene=combat`** (`packages/app/src/scenes/combat.ts`): FIVE red-vs-blue duels — spear / short sword /
  long sword / short bow / long bow — on deliberately different axes (E–W, N–S, diagonals) so every swing is
  judged in many facings. Headless checks assert the deterministic outcome only. The scene entry now frames
  the camera on the FIRST-tick snapshot (spawns run on tick 1; the empty tick-0 centroid used to drop the
  frame to the tile origin).
- **First human review (2026-07-08) caught + fixed:** (a) the direction remap above; (b) the sandbox
  content's MADE-UP attack cadences (a 4-tick sword swing vs the 12-frame decoded swing → the drawn attack
  truncated at its wind-up and repeated frantically) — sandbox `atomicAnimations` now carry the REAL viking
  lengths + ATTACK-event frames (sword 12@9, spear 27@17, broadsword 29@16, bows 12@10 / 28@22) and the
  long bow is its own job 41 (the real split — one archer job couldn't carry two draw lengths); (c) instant
  kills — scene HP raised to ~7–10 swings per kill (`BLUE_HP 400 / RED_HP 280`, sandbox-scale approximation,
  step-10 calibration pending); (d) an in-flight arrow now DRAWS (pulled forward from step 6): DrawKind
  `projectile` + a minimal oriented-arrow marker rotated toward the homing target
  (`gpu/sprite-pool/placeholder.ts`) — NO decoded arrow bob exists in the extracted `[bobseq]` lanes; step 6
  still owes the effects-bmd hunt and can replace the marker.
- **Second human review (2026-07-09) caught + fixed:** (a) melee "hits air" — first answered with a drawn
  LUNGE toward the target, later **retired on user verdict** (2026-07-10, unit-collision branch): the
  positional advance doubled the forward motion the attack frames already carry in their authored per-frame
  foot offsets and read as the body sliding over the ground, so the swing now plays ENTIRELY IN PLACE (the
  drawn anchor never leaves the sim position; the art alone covers the reach) and the attacker only FACES
  its live target. The melee-vs-ranged band heuristic and its named misclassifications are gone with it —
  no lunge, no split needed;
  (b) the arrow flew a straight line — `Projectile` now freezes its launch cell (`originX/originY`, never
  read by sim systems; goldens inert) and the render lobs the drawn shot on a parabola over the
  origin→target chord (peak 12% of the chord, capped 56 px; rotation follows the arc tangent — nose up
  climbing, down falling; height rides the lift channel so the depth key never moves). The arc tunables are
  named approximations (observed original behaviour), exported so tests pin the formulas.

---

## Step 6 — render: combat feedback — colours, HP bars, blood, cadavers, sounds

```text
Make a battle READABLE: player-coloured armies, hit-point bars, blood on hits, the dead
becoming cadavers, and per-material impact sounds.

Context (2026-07-03 — re-verify; re-read current seams):
- Player colours: the 256×16 player LUT + clothing-band remap already exist
  (packages/render/src/gpu/paletted-sprite.ts, plan progress note "Player (team) colours" row) but
  `DrawItem` carries no owner. Thread `Owner.player` through the snapshot → scene collect →
  DrawItem → PalettedSprite.player so each army renders its player colour. Unowned = the
  default row.
- HP bar: the original draws one (OpenVikings CGuiBaseDataManager.cs loads
  gui/palettes/bar_hitpoints.pcx). If plans/original-ui.md step 1 (GUI atlas) has landed, use
  the extracted bar sprites + bar_hitpoints palette; otherwise draw a minimal two-tone quad and
  leave a tracked swap note (docs/plans) — geometry approximated either way. WHEN the bar shows
  (always? damaged-only? selected?) is unreadable — damaged-only as the approximation,
  calibration-pending. Bars are per-visible-entity overlays — pool them (selection-layer
  pattern), cost scales with the screen.
- Blood: the original's HIT particle (logicdefines.inc PARTICEL_EFFECT HIT 1) has no readable
  asset — approximate a small red burst at the victim on the hit event; any visual randomness
  must be seeded from (tick, entity) so screenshots reproduce. Plan note: approximated.
- Death → cadaver: NO death [bobseq] exists — the original turns the dead into cadaver
  landscape objects (skeleton_falling 87 → cadaver_skeleton 81; leather/meat 79/80 for
  animals). The landscapeGfx IR (866 records) already carries these records + frames — on
  `settlerDied`, spawn a render-side cadaver object at the death position playing
  skeleton_falling once, then holding the skeleton frame, then fading after a named decay time
  (render-only, like map objects; the sim-side harvestable animal cadaver already yields meat
  directly — reconcile visually, don't duplicate sim state). Verify which cadaver record fits
  humans vs animals from the record names/frames; montage + user if ambiguous.
- Sounds: weapons.ini carries `soundtype_Hit <material> <sfxId>` / `soundtype_NoHit` per weapon
  (sfx ids are the logicdefines 67–96 weapon-impact set; victims scream MAN/WOMAN_GET_HIT
  97/98, beasts 101–119) and the extracted SoundBank's staticGroups carry `LogicSoundType` —
  the id join exists end-to-end. Extract the weapon sound fields (if step 4 didn't), then bind:
  projectileHit/melee-hit events → impact sfx by (weapon, victim material), death → the
  GET_HIT/death sfx + the existing jingle. Follow packages/audio's event-binding pattern.
- Projectile sprite: a MINIMAL oriented-arrow marker already ships (pulled forward into step 5's
  fix round — DrawKind `projectile`, `gpu/sprite-pool/placeholder.ts`, rotated toward the homing
  target). Still owed here: hunt the decoded effects/temp bmds ONCE for a real arrow/rock frame
  and replace the marker if one exists; keep the marker (tracked gap) if not.

Deliverables:
1. Owner → player-colour rendering end-to-end (two armies visibly red vs blue).
2. Pooled HP bars (damaged-only), blood burst on hits, cadaver spawn/decay on deaths,
   projectile visible in flight.
3. Weapon impact/miss/death sounds wired from the extracted ids through the audio bindings.
4. Scene checklists extended (colours distinct, bar tracks damage, blood at the hit moment,
   corpse appears and decays, arrow visible and lands with a thunk); plan progress notes for every
   approximation above.

Verification: npm test + npm run check green; headless halves assert the EVENTS (died,
projectileHit) and binding tables, pixels are the human's; END with dev-server URLs + the
checklist and ask for sign-off. Audio: assert bindings headlessly (the audio-verification
lesson — a fetched wav is not an audible wav; the human confirms by ear).

Guardrails: packages/render/AGENTS.md (pooling, culling, batch discipline — bars/particles are
per-screen, never per-map); render may use floats but visual randomness must be
tick-seeded-deterministic; no sim reach-in (events only).
```

## Step 7 — app: battle capstone scenes + battle golden + scale proof

```text
The capstone: full army-vs-army acceptance scenes that lock combat behavior with a golden and
prove the scale budget, then reconcile the docs.

Context (2026-07-03 — re-verify; re-read current seams):
- Everything from steps 1–6 is merged: engagement, stances, ranged, warrior animations,
  feedback. This step composes them and pins them down.
- Scene registry/pattern: packages/app/src/scenes/ (SceneDefinition: synthetic zod-valid
  content, seed, build, runTicks, headless checks[] + human checklist[]), auto-tested by
  packages/app/test/scenes.test.ts (invariants + checks + same-seed hash determinism).
- Scenes to add:
  1. `battle` — two mixed viking armies (~20 v 20: wooden/iron spears, short/long swords,
     short/long bows, a few armored in wool/leather/chain/plate), players red vs blue, spawned
     at opposite ends; they engage autonomously. Headless checks: deterministic winner, the AP
     asymmetry visible in the casualty pattern (plate falls to spears faster than to swords),
     archers open fire before melee contact, every death produced a settlerDied. Human
     checklist: colours, formations closing, swings/shots/staggers, blood, corpses, bars,
     sounds.
  2. `battle-stress` — hundreds per side on a 256×256 map (the stress-crowd pattern): the FPS
     overlay + a measured ms/tick budget in the scene notes; this is the ring-search scale
     proof (golden rule 7). Record sim-vs-render ms split (the profiling lesson — headless FPS
     is software-GL; judge FPS on the real GPU, ms/tick headlessly).
  3. Keep/extend `stances` + `archers` from earlier steps if they didn't already cover raids
     and kiting.
- Battle golden: add a sim-level golden (packages/sim/test pattern — state hash + a short
  atomic trace over N ticks of a small scripted battle) so future combat changes are
  intentional (the golden-update discipline: only update with the mechanic named).
- Docs reconciliation: restate what remains (steps 8–10 + out-of-scope items); sweep this plan's
  progress notes honest (every calibration/approximation row); README index still points here.

Deliverables:
1. The `battle` + `battle-stress` scenes with headless checks + human checklists.
2. The battle golden test (hash + trace) in packages/sim/test.
3. Measured perf numbers in the commit message (ms/tick at battle scale, before/after where
   relevant).
4. plan + plan progress note reconciled.

Verification: npm test + npm run check green; END with npm run dev →
http://localhost:5173/?scene=battle (and battle-stress) + the full checklist, and ask for the
human battle sign-off — this is the plan's "armies visibly fight and it looks like Cultures"
moment.

Guardrails: golden rule 7 with numbers, not vibes; scene content stays synthetic
(zod-validated), no copyrighted bytes.
```

## Step 8 — sim+app: barracks — recruitment (equip) + training

```text
Close "where armies come from": a civilian becomes a soldier by collecting a weapon (and
armor) at the barracks, and soldiers train there for XP at a coin cost.

Context (2026-07-03 — re-verify; re-read current seams):
- Data: the barracks is logictype 39 (DataCnmd/types/houses.ini — maintype 4 LEARN,
  logicSchoolSize 25, stocks every weapon good 37–42, all four armors 33–36, coins 8, food) —
  already in the extracted buildings. The weapon→soldier-class binding is weapons.ini
  `jobtype`+`goodtype` (short bow good → job 40 …) — data, not a hand map. Training:
  atomicanimations viking_soldier_train length 28 → event 2 30 −1 (spend a coin) + event 22 29
  +25 (TRAINING XP, bucket 77); _exercise → +1 free; atomics EXERCISE 89 / TRAIN 90
  (logicdefines). The `needforjob`/`trainforjob` gates (extracted, JobSystem-consumed) already
  key soldier classes on fight/training expTypes — training feeds an EXISTING gate.
- Recruitment (the equip drive — the plan's named oracle-blocked item; the flow below is
  observed-approximation, log it): the player sets a civilian's job to a soldier class (the
  existing setJob command + the barracks UI panel or scene script). The recruit walks to the
  barracks door (interactionNode), consumes ONE matching weapon good from the barracks stock →
  Weapon component + the job flips to the weapon's jobtype; if an armor good is in stock,
  consume the best available → Armor (which armor a class gets is unreadable —
  best-available, plan progress note). No weapon in stock ⇒ the order fails visibly (the typed-result
  boundary-failure pattern, not a throw).
- Training drive: an idle soldier assigned to the barracks runs `train` while the barracks
  holds coins (spend via the event, +25 into bucket 77), else `exercise` (+1). Level EFFECTS
  stay deferred (step 10) — XP accrues into the same experience map the needforjob gates read,
  so higher soldier classes unlock faithfully already.
- Economy tie-in: weapons/armor/coins are produced by the existing economy (smith/armorer/coin
  maker recipes are extracted) — the scene may seed the barracks stock directly, but verify a
  produced weapon ALSO routes to the barracks via the existing carrier/store logistics (the
  barracks stocks-list makes it a valid delivery target — verify, don't assume).
- App: the barracks selected-building panel gets the minimal recruit/train affordances
  (existing unit-panel pattern; original art belongs to the original-ui plan).

Deliverables:
1. The equip drive (walk → consume → transform) + failure path, data-driven off
   weapons.ini/goods, no per-class code.
2. The train/exercise drive with the coin spend from the animation events.
3. Scene `barracks`: civilians + a stocked barracks → they collect arms (the body/weapon
   visibly changes — step 5's bindings), train while coins last (XP rises, coins drain),
   exercise after; a needforjob-gated class unlocks once the XP threshold is met. Headless
   checks on all of it; human checklist for the visible transformation.
4. plan progress notes: recruit flow + armor pick (observed-approximation), train/exercise
   (faithful params: costs, XP, lengths), the unlock gate (already-pinned needforjob).

Verification: npm test + npm run check green; goldens untouched; scene URL + checklist +
sign-off request.

Guardrails: sim AGENTS.md; content-is-data (no hardcoded class tables); track any UI
placeholder in docs/plans.
```

## Step 9 — sim+app: towers, defence mode, building damage

```text
Static defence: buildings can be damaged and destroyed, tower garrisons shoot back, and
defence mode turns key buildings into archers.

Context (2026-07-03 — re-verify; re-read current seams):
- Data: towers are logictype 40/41 (houses.ini, maintype 5 FIGHT) with garrison worker slots
  (logicworker: 3–4 each of short-bow job 40 + long-bow job 41, + carriers) and
  logicCanEnableDefenceMode 1 (also on HQ logictype 1 and the barracks 39). The "house bow"
  (weapons.ini type 20, jobtype 6 civilist!, range 0–29, dmg 375, munition arrow speed 7) is
  the defence-mode weapon. Weapon damage vs buildings is the material-7 column (step 1's
  damageVsBuilding read view); catapult aside, house columns are small — sieging with
  field troops is slow BY DATA, keep it that way.
- Building HP: NOT readable (encrypted housetypes.cif). Give Building an optional Health with
  a named approximated constant (single value or size-scaled — pick one, justify, plan progress note
  calibration-pending). Destruction: at 0 HP remove the building (+ its footprint overlay,
  jobs unbind — the demolish seam already handles teardown; reuse it), emit an event; rubble
  visual = reuse the construction-layer machinery inverted or a decal — keep minimal, track
  the polish gap.
- Targeting buildings: auto-acquire stays unit-vs-unit; buildings are attacked via the
  explicit attackUnit order on a building target (and later by siege). Whether the original
  auto-attacks buildings is unreadable — log the choice.
- Tower garrison: soldiers assigned to tower worker slots (the existing JobSystem
  worker-slot machinery) fire their OWN bows from the tower's tile with their extracted
  ranges; whether garrisoned units are hidden/protected is unreadable — hide them (enter the
  building, the door-cell pattern) and make them untargetable while garrisoned,
  recorded in the plan progress note.
- Defence mode: a toggleable per-building flag (command + panel toggle on
  defence-mode-capable types) — while ON, the building fires house-bow projectiles (step 4
  machinery) at the nearest hostile in range at the house-bow animation cadence (verify which
  atomicanimation the house bow binds; else a named cadence constant, calibration-pending).
- Scene `tower-defence`: an attacker wave vs a garrisoned tower + defence-mode HQ — checks:
  tower/HQ projectiles fire, attackers die approaching, an ordered building attack grinds the
  tower down via the material-7 column, destruction removes footprint + garrison survives/
  exits (decide + log), deterministic outcome.

Deliverables:
1. Building Health + ordered building damage via the house column + destruction/teardown.
2. Garrison fire from towers + hidden-garrison semantics.
3. Defence mode (command, panel toggle, house-bow fire).
4. Scene + tests + plan progress notes (building HP, auto-target policy, garrison shelter, cadence
   — all calibration-pending; the damage COLUMN is faithful data).

Verification: npm test + npm run check green; goldens untouched; scene URL + checklist +
sign-off.

Guardrails: sim AGENTS.md; golden rule 7 (building targeting joins the ring-search index, no
new scans); reuse demolish/footprint seams — no parallel teardown path.
```

## Step 10 — calibration against the original (interactive — the user is the oracle)

```text
Convert the combat approximations into observed facts: a structured observation session against
the running original, turning plan progress note "calibration-pending" rows into pinned constants.

Context (2026-07-03): the unreadable set (human base HP, sight/aggro radius, the XP→level curve
and its stat effects, DEFEND/FLEE exact behavior, archer-under-minRange behavior, HP-bar
visibility rule, stagger rules, projectile feel, building HP, defence-mode cadence, hit-vs-miss
and blockingValue's role) can only be pinned by watching the original game. The user owns it
("../Cultures 8th Wonder"); this session is INTERACTIVE — prepare, ask, record. Vinland's side:
the battle/stances/archers scenes mirror each probe so original and rebuild are compared like
for like.

Process:
1. Read the "Progress notes" section above and grep `calibration` / `APPROXIMATED` in
   packages/sim/src, collecting every combat item into a numbered probe list. For each, design the cheapest observation that pins it, e.g.:
   - Human HP: count hits-to-kill with a known weapon vs a known armor (iron spear = 3800 vs
     unarmored → HP ≈ n×3800; cross-check with a second weapon).
   - Sight radius: walk an enemy toward an idle ATTACK-stance soldier; count tiles at reaction.
   - DEFEND: does it chase? how far? does it return?
   - FLEE: trigger distance, run speed vs walk (time a fixed distance), where they run to.
   - Level curve: train a soldier N reps (N×25 XP), measure hits-to-kill and damage changes.
   - HP bar: when does it appear? Stagger: who staggers, how often? Misses: do attacks whiff?
   - Building HP: catapult/soldier hits to destroy a tower.
2. Present the probe list to the user BEFORE the session (they run the original — coordinate
   how; screen-share/screenshots/their notes all work). Walk it interactively; record answers
   verbatim.
3. Apply: observed values replace the named constants (data swaps, not code changes — that was
   the point of naming them); each plan progress note flips to "faithful (observed <date>)" or gets
   the honest refined approximation; behavioral surprises that contradict our model become
   either fixes (small) or new docs/plans items (large) — never silent.
4. Re-run the scenes side by side (original footage vs ?scene=battle) and note remaining gaps.

Deliverables: the updated constants + plan progress sweep + a short observation log (AGENTS.md or
the git history per current convention); goldens updated ONLY where a constant change moves
them, named mechanic by mechanic.

Verification: npm test + npm run check green; the user confirms the battle scene now "feels"
like the original — that judgment is theirs, record it.

Guardrails: never guess a visual/behavioral fact the user can observe — ask; keep every change
a data/constant swap; determinism intact.
```
