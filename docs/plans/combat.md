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
  **full-scan O(combatants × entities)** — `packages/sim/AGENTS.md` flags it and the ROADMAP
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
re-read the current seams first). Check a box when the step is merged; delete this file when all
steps land. Steps 8–9 are severable if the scope must shrink; step 10 can run any time after 7.

- [ ] 1. Sim: true damage model — material columns, hit at the ATTACK frame, swing cadence
- [ ] 2. Sim: engagement — owner hostility, ring-search targeting, walk-into-melee, attack order
- [x] 3. Sim: stances — attack / defend / ignore / flee
- [ ] 4. Sim: ranged combat — projectiles in flight
- [ ] 5. Render: warrior bodies + combat animations
- [ ] 6. Render: combat feedback — player colours, HP bars, blood, cadavers, impact sounds
- [ ] 7. App: battle acceptance scenes + battle golden + scale proof
- [ ] 8. Sim+app: barracks — recruitment (equip) + training
- [ ] 9. Sim+app: towers, defence mode, building damage
- [ ] 10. Calibration against the original (interactive — the user is the oracle)

Out of scope for this plan: the **catapult/siege vehicle** (blocked on vehicle graphics —
ROADMAP render-breadth rung 4 — and vehicle-entity sim; its data facts are recorded above for
when it lands), **heroes + potions/amulets** (jobs 42–47, goods 44–55 — every magnitude is
unreadable, pure calibration; defer until step 10's machinery exists), **walls/gates as
damageable landscape** (needs the landscape-transition machinery the gathering-economy plan
builds), **diplomacy/alliances** (hostility stays binary per player), and **other-tribe render
sets** (roadmap defers them behind the viking set — battles are viking vs viking, told apart by
player colour).

---

## Step 1 — sim: true damage model, ATTACK-frame hit, swing cadence
[DONE]
```text
Re-pin Vinland's combat damage resolution to the original's data model and make a melee exchange
run at the data's cadence: damage selected by the victim's armor MATERIAL column, applied at the
animation's ATTACK event frame (not at completion), swings repeating at the animation length,
the victim staggering, the attacker paying the swing's need drain, and combat XP accruing into
the per-weapon fight buckets.

Context (research findings, 2026-07-03 — re-verify against the sources before coding; game root
= "../Cultures 8th Wonder" relative to the repo root, read-only; main moves under parallel
sessions, so re-read the current combat seams first):
- Damage model (logicdefines.inc ~l.948 ARMOR_MATERIAL_TYPE + DataCnmd/types/weapons.ini +
  Data/logic/armortypes.ini): a weapon's `damagevalue <index> <value>` lines are a table indexed
  by the VICTIM's armor materialType (0 none, 1 wool, 2 leather, 3 chain, 4 plate, 6 wood,
  7 house). The per-material value IS the resolved damage — armor works by column selection, not
  subtraction. `blockingValue` (uniform 5) has an UNKNOWN engine role — stop subtracting it;
  record the unknown in docs/FIDELITY.md. Columns 6/7 are damage vs trees/walls and vs BUILDINGS
  — expose them as read views (damageVsWood/damageVsBuilding, consumed by the towers step) and
  stop treating them as unarmored fallbacks. Current code: `combatDamage` in
  packages/sim/src/systems/readviews/combat.ts computes max(0, damage[class] − blockingValue).
  For the 4 real armors materialType == typeId, so the numbers only shift by the −5; the
  semantic fix matters for 6/7 and for faithfulness. Update the FIDELITY rows that mention the
  net-damage join.
- Hit timing (DataCnmd/atomicanimations12/atomicanimations.ini): each attack animation carries
  `event <frame> 25` (ATTACK) mid-animation — viking_soldier_attack_sword_short length 12,
  ATTACK @9; spear_iron 27 @17; sword_long 29 @16; bow_short 12 @10. The extracted
  `AtomicAnimation.events` (packages/data schema) already carries {at, type, value} — resolve
  the hit when `CurrentAtomic.elapsed` crosses the ATTACK event's frame, not on completion
  (today `resolveHit` runs at completion in packages/sim/src/systems/conflict/atomic.ts). Name
  the event-type constant (25) — no magic numbers.
- Swing cadence: the attack atomic's duration already resolves via the (jobType, atomicId 81) →
  `setatomic` → animation `length` join (verify). A combatant whose target survives re-attacks:
  after a completed swing it re-acquires (canonically) and starts the next swing — the cadence
  IS the animation length. No cooldown constant exists in the data; don't invent one.
- Stagger: on a landed hit, if the victim carries a `setatomic <job> 82` binding (ATTACKED — the
  mod's tribetypes.ini shows it for civilian classes, e.g. viking_woman_attacked length 50, zero
  events) and is interruptible (not mid-swing), give it the 82 atomic — purely visual state the
  render consumes later. Verify which jobs actually carry an 82 binding; bind data-driven, no
  per-job code.
- Need drain: soldier swings carry `event 2 1 -20` + `event 2 2 -20`; woman/civilist −100. The
  `atomicEventChannelDelta` read view (systems/readviews/animations.ts) already decodes these
  channels (1 = rest, 2 = hunger — the FIDELITY "Atomic durations" row documents the channel
  map). Apply the attack animation's channel deltas to the attacker on swing completion — first
  combat consumer of the extracted event deltas. Keep it scoped to combat atomics; note in
  FIDELITY that the general event-driven needs drive stays deferred.
- Combat XP: on a swing that dealt damage, accrue `experiencefactor` (Data/logic/
  humanjobexperiencetypes.ini — `soldier general` type 69 = 1/swing) into
  `Settler.experience` under the fight bucket keyed by the weapon's mainType
  (logicdefines.inc ~l.598: FIST 71, SPEAR 72, SWORD 73, AXE 74, BOW 75) — the SAME expType id
  space the existing `needforjob` gates read, so better soldier classes lock behind fight XP
  with no new mechanism. The accrual TRIGGER (per swing vs per kill) is unreadable — pick
  per-damaging-swing, log as approximated. Level→stat effects are unreadable: accrue raw XP
  only; bonuses wait for step 10 calibration.
- Determinism: goldens must stay byte-identical (combat is inert on the golden content — verify
  after; if a golden moves, the change leaked outside combat). No Math.random/Date; canonical
  iteration; fixed-point only in sim.

Deliverables:
1. `combatDamage` re-pinned to the material-column model (column = victim materialType, 0 when
   unarmored, no blockingValue subtraction) + `damageVsWood`/`damageVsBuilding` read views +
   updated unit tests.
2. ATTACK-event-frame hit resolution in the atomic executor (fall back to completion-time only
   when an animation lacks the event — log that fallback in FIDELITY).
3. Repeating swings (cadence = animation length), data-driven stagger (82), attacker need
   drain from the animation events, fight-bucket XP accrual.
4. Tests in packages/sim/test/conflict/ at the lowest level per mechanic + an extended headless
   scenario: two spawned squads exchange blows at the data's cadence; a plate-armored target
   takes 2090 from an iron spear and 950 from a long sword (the AP asymmetry as a test).
5. docs/FIDELITY.md rows updated/added (damage model faithful (params); blockingValue unknown →
   recorded; hit-frame faithful; XP trigger + stagger interruptibility approximated).

Verification: npm test green (goldens untouched or the move explained mechanic-by-mechanic),
npm run check green. This step is sim-only — no scene sign-off yet (step 7 is the visible
capstone); extend packages/app/test/scenes.test.ts only if an existing scene's checks break.

Guardrails: read-only outside this repo; packages/sim/AGENTS.md determinism contract; golden
rule 7 (this step must NOT add new full-world scans — targeting stays as-is until step 2).
```
[DONE]
## Step 2 — sim: engagement — hostility, ring search, walk-into-melee, attack order

```text
Give combat its engagement half: an owner-based hostility axis, a scalable enemy-in-radius
query, warriors that WALK to a spotted enemy and fight when they arrive, and an explicit
player attack order.

Context (2026-07-03 — re-verify; re-read the current seams, main moves):
- Hostility axis: today `nearestEnemyTarget` (packages/sim/src/systems/conflict/combat.ts) keys
  enemies by "different, non-animal tribe". Battle scenes are viking vs viking told apart by
  player, so hostility must key on `Owner.player` (components/ownership.ts): two OWNED settlers
  with different players are hostile; owned-vs-unowned same-tribe is neutral; the animal
  relations (`mayAttack`/`mayHunt`/`Anger` in readviews/tribes.ts) stay as they are. Alliances/
  diplomacy are out of scope — binary hostility, log the simplification in FIDELITY.
- Spatial query (golden rule 7 — the O(n²) full scan is flagged in packages/sim/AGENTS.md and
  ROADMAP tier 3): build the grid ring search over TileBuckets (systems/shared.ts) — expand
  Manhattan bands from the seeker, finish the WHOLE minimum-distance band, pick canonically
  (distance, then entity id), short-circuit when a band exceeds the query radius. Bucket hostile
  combatants per tick (by player) so each seeker queries only real candidates; add a dormancy
  gate — no hostile pair on the map ⇒ zero combat work (the established pattern). Perf-test it:
  the step's scenario must not regress ms/tick at a few hundred units (measure, don't guess).
- Sight radius: humans have NO readable sight/aggro radius (animals have leash fields only).
  Name a constant (e.g. SIGHT_RADIUS_TILES) — an approximated calibration constant, FIDELITY
  entry "calibration-by-observation pending (step 10)". Weapon reach stays the extracted
  [minRange, maxRange] band.
- Walk-into-melee: an ATTACK-stance combatant (stances land in step 3 — until then treat every
  Health-bearing owned soldier as aggressive) whose nearest enemy is inside sight but beyond
  maxRange gets a MoveGoal toward it, re-planned at a bounded cadence (the pathfinding budget
  exists — reuse it; a per-tick full repath of every chaser is a perf regression); inside
  [minRange, maxRange] it stops and swings (step 1's loop). Chasing must interact sanely with
  the existing aiSystem economy drives: a combat-engaged settler skips economy planning (the
  PlayerOrder-skip pattern in conflict/ai.ts).
- Attack order: add an `attackUnit` command (core/commands.ts discriminated union +
  assertNever) — selected owned units get a focused target they chase/attack regardless of
  sight radius until it dies or becomes unreachable; reuse the PlayerOrder soft-override
  semantics (orders.ts — soldiers hold longer, MOVE_ORDER_HOLD_SOLDIER). App side: right-click
  on an enemy issues attackUnit instead of moveUnit (view/picking.ts hit-tests units already;
  view/unit-controls.ts enqueues). Move-order-onto-enemy = attack is the original's RTS idiom —
  log as observed-approximation.
- Determinism: goldens stay green; ring search must be provably order-independent (canonical
  band completion) — add a determinism test that battles hash-identically across two runs.

Deliverables:
1. Owner-based hostility + the ring-search enemy query (TileBuckets extension, unit-tested on
   crafted grids: nearest at band edges, ties broken canonically, radius short-circuit).
2. Walk-into-melee advance + engaged-skips-economy + bounded repath cadence.
3. `attackUnit` command + app right-click wiring + scene: extend the unit-orders scene (or add
   `melee-engagement`) — two owned squads with different players advance across a gap, meet,
   fight to a deterministic outcome; checks: both sides advance, swings land at range, deaths
   occur, winner deterministic.
4. Perf evidence in the PR/commit: ms/tick before/after at ~400 combatants (headless), ring
   search vs full scan.
5. FIDELITY rows: hostility axis (approximated — no diplomacy), sight radius (calibration
   pending), chase/repath cadence (our design), attack order (observed-approximation).
   ROADMAP tier-3 ring-search line updated (combat consumer landed).

Verification: npm test + npm run check green; the new scene's headless checks green in
packages/app/test/scenes.test.ts; goldens byte-identical. Scene sign-off note for the human:
mechanics visible but attack ANIMATION still missing until step 5 — say so explicitly when
surfacing the scene URL.

Guardrails: packages/sim/AGENTS.md (determinism + "Scaling to thousands"); golden rule 7 is the
point of this step — no per-seeker full scans may survive it.
```
[DONE]
## Step 3 — sim: stances — attack / defend / ignore / flee 

```text
Add the original's four military behavior modes as a per-unit stance driving auto-engagement,
and make civilians actually RUN from danger.

Context (2026-07-03 — re-verify; re-read current seams):
- The enum is data-pinned: logicdefines.inc ~l.1107 MILITARY_MODE_{NONE 0, ATTACK 1, DEFEND 2,
  IGNORE 3, FLEE 4}. Model it as a `Stance` component + named constants (no magic numbers), a
  `setStance` command (owned units only, discriminated union + assertNever), and stance-gated
  behavior in the combat/AI systems from step 2.
- Per-mode semantics (the enum is readable, the BEHAVIOR is not — approximate, log each in
  FIDELITY as calibration-pending, revisit in step 10):
  - ATTACK: step 2's behavior — auto-acquire within sight, chase, fight.
  - DEFEND: engage only enemies inside a small defend radius around an anchor (the tile where
    the stance was set); never chase beyond a leash; return to the anchor when clear. Named
    constants for radius/leash.
  - IGNORE: never auto-engage (the scout's mode); an explicit attackUnit order still works.
  - FLEE: when a hostile enters sight, run AWAY (direction opposite the nearest threat,
    re-evaluated at a bounded cadence; unreachable flee target ⇒ pick the best walkable
    alternative deterministically). First consumer of `MoveSpeed.runPerTick` — humans have no
    readable run speed, so mint a named run multiplier over walk speed (calibration constant).
    Flee preempts economy drives but NOT the eat/sleep collapse thresholds (a starving settler
    still eats once safe); resume normal work when no threat in sight for a named cool-down.
- Defaults per job (NOT in readable data — the user's observation of the original, log as
  observed-approximation): soldiers 31–41 + heroes 42–47 → ATTACK; scout 27 → IGNORE; hunter 15
  → IGNORE toward humans (its animal hunting drive is separate and stays); every other civilian
  job + children → FLEE. Keep the default table data-shaped (a lookup, not branches).
- Animals do NOT get Stance — their aggressive/getangry/Anger model (animaltypes.ini) already
  landed and stays separate.
- App: a minimal stance control on the selected-unit panel (view/unit-panel.ts /
  unit-controls.ts — plain buttons; the original's military-mode UI art belongs to the
  original-ui plan, don't build it here), issuing setStance through the command seam.

Deliverables:
1. `Stance` component + `setStance` command + stance-gated engagement (ATTACK/DEFEND/IGNORE) +
   the flee drive with the run gait.
2. Job-based stance defaults (data-shaped lookup) stamped at spawn/job-change.
3. Scene `stances`: a hostile squad walks into a working settlement — civilians flee at run
   speed, the scout stands, soldiers engage; checks: civilian distance-to-threat increases and
   their gait is the run speed, scout position unchanged, soldiers converge and win; plus a
   DEFEND check (defender holds its anchor, doesn't chase past the leash).
4. FIDELITY rows per mode + the defaults table; sim tests for each stance transition edge
   (stance change mid-chase, flee↔need collapse, order-over-stance precedence).

Verification: npm test + npm run check green; goldens untouched; scene headless checks green;
surface the scene URL + checklist (note animations still pending step 5).

Guardrails: packages/sim/AGENTS.md; the flee threat query MUST reuse step 2's ring search (no
new scans); all new thresholds are named constants with FIDELITY entries.
```
[IN PROGRESS]
## Step 4 — sim: ranged combat — projectiles in flight

```text
Make bows real: a shot launches a projectile entity at the animation's ATTACK frame that
travels at the weapon's extracted speed and damages on arrival — no instant hits.

Context (2026-07-03 — re-verify; re-read current seams):
- Data (DataCnmd/types/weapons.ini, extracted WeaponType): ranged weapons carry `munitiontype`
  (1 arrow, 2 rock) + `speed` (short/long bow 8, house bow 7, catapult 3) + the [minRange,
  maxRange] band (short bow 3–15, long bow 4–23, hunter bow 3–17). VERIFY the extractor emits
  `speed` (schema packages/data/src/schema.ts — the field may not be extracted yet; if missing,
  extend the weapons extractor + schema first, cross-ref-tested like the other fields).
  The speed UNIT (tiles per tick?) is unreadable — pick a mapping as a named constant,
  calibration-pending.
- Sim model: a `Projectile` component (payload: resolved per-material damage table reference or
  attacker weapon key, source entity, target entity, munition type) + Position/velocity in
  fixed-point. Launch at the ATTACK event frame of the shooter's swing (step 1's machinery —
  for bows that frame is the release: bow_short @10 of 12, bow_long @22 of 28). Travel straight
  toward the target's CURRENT position each tick (homing) and resolve the hit with step 1's
  material-column damage on contact; a dead/vanished target ⇒ the projectile expires at the
  last position (no re-target). Homing-vs-ballistic and hit-guarantee are unreadable — log the
  choice (`soundtype_NoHit` implies misses exist in the original; approximate always-hit,
  FIDELITY).
- Behavior: the shooter obeys the dead zone (an enemy inside minRange cannot be shot — already
  enforced in targeting; keep it) — what an archer DOES then (kite? stand?) is unreadable:
  stand idle and log, revisit in step 10. Emit SimEvents (`projectileLaunched`,
  `projectileHit`) for render/audio (events, not reach-in).
- Perf: projectiles are entities — per-tick cost scales with ACTIVE projectiles (fine); make
  sure expired ones are destroyed promptly (canonical collection, the cleanupSystem pattern).
- Atomic id note: logicdefines.inc lists SHOOT 83 beside ATTACK 81, but weapons.ini binds every
  weapon (bows included) to `atomicactiontype 81` — verify which atomic the bow jobs actually
  bind in tribetypes.ini `setatomic`, and use what the data says; record the finding.

Deliverables:
1. (If needed) weapons-extractor + schema extension for `speed` (and `soundtype_*` if cheap —
   step 6 needs it; keep extraction one PR ahead of consumption).
2. Projectile entity + launch-at-release-frame + travel + on-contact damage + expiry, wired
   through step 1's damage model and step 2/3's targeting/stances.
3. Scene `archers`: an archer line (mixed short/long bows) vs an advancing melee squad —
   checks: projectiles exist in flight for the expected tick count (distance/speed), first
   damage lands AFTER the release frame + travel time (no instant hit), melee that closes
   inside minRange stops being shot, deterministic outcome.
4. Sim tests: release frame, travel arithmetic in fixed-point, dead-target expiry, min-range
   dead zone; determinism hash test with projectiles active.
5. FIDELITY rows: projectile model (speed param faithful; unit mapping + homing + always-hit
   approximated), archer-under-minRange behavior (calibration pending).

Verification: npm test + npm run check green; goldens untouched; scene headless checks green;
surface the scene URL (projectile is INVISIBLE until step 6 — say so).

Guardrails: packages/sim/AGENTS.md; fixed-point only; events not callbacks.
```

## Step 5 — render: warrior bodies + combat animations

```text
Put the decoded warrior body on screen: soldiers draw cr_hum_body_05 with per-weapon attack,
aggressive walk/wait, and shoot sequences; civilians stagger and brawl with their fight sets.
This is the fight/shoot slice of ROADMAP render rung 3.

Context (2026-07-03 — re-verify; re-read current seams, and check whether rung 3's multi-body
support landed on main first):
- Bodies: the roster binds jobs to bodies/atlases. Soldier jobs 31–41 (+ heroes) draw
  `cr_hum_body_05` (57 seqs), civilians stay on the current man/woman bodies. If the roadmap's
  "multi-body render support" prerequisite has NOT landed yet, implement the minimal version
  here: per-body atlas load + a (job → body) selector in the bindings table
  (packages/app/src/content/settler-gfx.ts ADULT_CHARACTER_BY_JOB already routes 31–41 to
  warrior specs — the atlas/binding half is what's missing).
- Sequence ground truth: DO NOT guess seq names from patterns. The binding table is
  DataCnmd/animation/mapmoveableanimations/animations.ini — records join (logictribe, logicjob,
  logicatomicaction 81/82/83) → `gfxbobseqbody` (+frame lists); transcribe the joins for the
  viking soldier jobs + civilist/woman into the bindings (the extracted `bobSequences` IR
  already carries every [bobseq] range). Known seq families on cr_hum_body_05:
  human_man_Warrior_{Sword,Broadsword,spear}_Attack(+_2), _{Longbow,Shortbow}_attack,
  spear_throw, Walk/Wait_agressive + per-weapon walk/wait; unarmed
  human_man_warrior_empty_{punch,double_punch,dragon_punch,high_kick,walk,wait}; civilians
  Civilian_Fight_* (man body) and the woman body's fight seqs; staggers per class (
  `<class>_attacked` atomic 82).
- Bind the sim: atomic 81 → the weapon-correct attack seq (the settler's Weapon component /
  job's weapon decides — the (jobType→weapon) join is weapons.ini `jobtype`); atomic 82 → the
  stagger; ranged release should READ as a shot (the seq's release frame should coincide with
  step 1's ATTACK event frame — verify visually, the frame data is extracted). Stance/combat
  state → Walk/Wait_agressive vs civilian gait where the seqs exist.
- Facing: non-locomotion seq direction order is the known open gap (docs/lessons — the ?anim
  gallery is the validation tool). An attacker must FACE its target: derive facing from the
  attacker→target vector; validate per-seq direction order with a labeled montage and ask the
  user (the montage lesson) — never silently guess a visual fact.
- Cadence: playback stays 1 frame/sim-tick (the pinned render rule); attack anims are length
  12–29, matching their atomic durations by construction — verify no stretch/cutoff.

Deliverables:
1. Warrior-body atlas load + (job → body) selection + the per-weapon 81/82(/83) sequence
   bindings for viking soldiers, civilist, woman — transcribed from animations.ini, no
   invented names.
2. Aggressive walk/wait wiring for engaged/ATTACK-stance units where sequences exist.
3. ?anim gallery covers the new bodies/seqs (the existing validation entry); extend the
   melee/archers/stances scenes' checklists with animation items (swing reads as a swing, the
   bow release matches the projectile launch, the stagger is visible, facing tracks the
   target).
4. FIDELITY rows: binding joins faithful (animations.ini), facing order + any montage-resolved
   facts recorded as human-verified; renders stay screen-scaled (render AGENTS.md).

Verification: npm test + npm run check green (headless scene checks can only assert state, not
pixels); END with the human sign-off — npm run dev URLs for the scenes + ?anim and the montage
questions. An agent cannot self-judge pixels: ask plainly whether each animation looks right.

Guardrails: packages/render/AGENTS.md (retained, batched, screen-scaled); no copyrighted bytes
committed (content/ stays gitignored); the labeled-montage lesson for every visual fact.
```

## Step 6 — render: combat feedback — colours, HP bars, blood, cadavers, sounds

```text
Make a battle READABLE: player-coloured armies, hit-point bars, blood on hits, the dead
becoming cadavers, and per-material impact sounds.

Context (2026-07-03 — re-verify; re-read current seams):
- Player colours: the 256×16 player LUT + clothing-band remap already exist
  (packages/render/src/gpu/paletted-sprite.ts, FIDELITY "Player (team) colours" row) but
  `DrawItem` carries no owner. Thread `Owner.player` through the snapshot → scene collect →
  DrawItem → PalettedSprite.player so each army renders its player colour. Unowned = the
  default row.
- HP bar: the original draws one (OpenVikings CGuiBaseDataManager.cs loads
  gui/palettes/bar_hitpoints.pcx). If plans/original-ui.md step 1 (GUI atlas) has landed, use
  the extracted bar sprites + bar_hitpoints palette; otherwise draw a minimal two-tone quad and
  leave a tracked swap note (TECH-DEBT) — geometry approximated either way. WHEN the bar shows
  (always? damaged-only? selected?) is unreadable — damaged-only as the approximation,
  calibration-pending. Bars are per-visible-entity overlays — pool them (selection-layer
  pattern), cost scales with the screen.
- Blood: the original's HIT particle (logicdefines.inc PARTICEL_EFFECT HIT 1) has no readable
  asset — approximate a small red burst at the victim on the hit event; any visual randomness
  must be seeded from (tick, entity) so screenshots reproduce. FIDELITY: approximated.
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
- Projectile sprite: no readable arrow/rock asset was found in the research pass. Hunt the
  decoded bobs once (arrow-like frames in the effects/temp bmds); if none, draw a minimal
  oriented sprite/line and track the gap (TECH-DEBT) — do NOT silently ship nothing: the
  projectile must be visible.

Deliverables:
1. Owner → player-colour rendering end-to-end (two armies visibly red vs blue).
2. Pooled HP bars (damaged-only), blood burst on hits, cadaver spawn/decay on deaths,
   projectile visible in flight.
3. Weapon impact/miss/death sounds wired from the extracted ids through the audio bindings.
4. Scene checklists extended (colours distinct, bar tracks damage, blood at the hit moment,
   corpse appears and decays, arrow visible and lands with a thunk); FIDELITY rows for every
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
- Docs reconciliation: ROADMAP Phase-4 CombatSystem line — check off what landed, restate what
  remains (steps 8–10 + out-of-scope items); FIDELITY gets a combat summary sweep (every row
  this plan touched, statuses honest); README index still points here.

Deliverables:
1. The `battle` + `battle-stress` scenes with headless checks + human checklists.
2. The battle golden test (hash + trace) in packages/sim/test.
3. Measured perf numbers in the commit message (ms/tick at battle scale, before/after where
   relevant).
4. ROADMAP + FIDELITY reconciled.

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
- Recruitment (the equip drive — the ROADMAP's named oracle-blocked item; the flow below is
  observed-approximation, log it): the player sets a civilian's job to a soldier class (the
  existing setJob command + the barracks UI panel or scene script). The recruit walks to the
  barracks door (interactionTile), consumes ONE matching weapon good from the barracks stock →
  Weapon component + the job flips to the weapon's jobtype; if an armor good is in stock,
  consume the best available → Armor (which armor a class gets is unreadable —
  best-available, FIDELITY). No weapon in stock ⇒ the order fails visibly (the typed-result
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
4. FIDELITY rows: recruit flow + armor pick (observed-approximation), train/exercise
   (faithful params: costs, XP, lengths), the unlock gate (already-pinned needforjob).

Verification: npm test + npm run check green; goldens untouched; scene URL + checklist +
sign-off request.

Guardrails: sim AGENTS.md; content-is-data (no hardcoded class tables); track any UI
placeholder in TECH-DEBT.
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
  a named approximated constant (single value or size-scaled — pick one, justify, FIDELITY
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
  FIDELITY-logged.
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
4. Scene + tests + FIDELITY rows (building HP, auto-target policy, garrison shelter, cadence
   — all calibration-pending; the damage COLUMN is faithful data).

Verification: npm test + npm run check green; goldens untouched; scene URL + checklist +
sign-off.

Guardrails: sim AGENTS.md; golden rule 7 (building targeting joins the ring-search index, no
new scans); reuse demolish/footprint seams — no parallel teardown path.
```

## Step 10 — calibration against the original (interactive — the user is the oracle)

```text
Convert the combat approximations into observed facts: a structured observation session against
the running original, turning FIDELITY "calibration-pending" rows into pinned constants.

Context (2026-07-03): the unreadable set (human base HP, sight/aggro radius, the XP→level curve
and its stat effects, DEFEND/FLEE exact behavior, archer-under-minRange behavior, HP-bar
visibility rule, stagger rules, projectile feel, building HP, defence-mode cadence, hit-vs-miss
and blockingValue's role) can only be pinned by watching the original game. The user owns it
("../Cultures 8th Wonder"); this session is INTERACTIVE — prepare, ask, record. Vinland's side:
the battle/stances/archers scenes mirror each probe so original and rebuild are compared like
for like.

Process:
1. Read docs/FIDELITY.md and collect every combat row marked approximated/calibration-pending
   into a numbered probe list. For each, design the cheapest observation that pins it, e.g.:
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
   the point of naming them); each FIDELITY row flips to "faithful (observed <date>)" or gets
   the honest refined approximation; behavioral surprises that contradict our model become
   either fixes (small) or new ROADMAP/TECH-DEBT items (large) — never silent.
4. Re-run the scenes side by side (original footage vs ?scene=battle) and note remaining gaps.

Deliverables: the updated constants + FIDELITY sweep + a short observation log (docs/lessons or
the ROADMAP archive per current convention); goldens updated ONLY where a constant change moves
them, named mechanic by mechanic.

Verification: npm test + npm run check green; the user confirms the battle scene now "feels"
like the original — that judgment is theirs, record it.

Guardrails: never guess a visual/behavioral fact the user can observe — ask; keep every change
a data/constant swap; determinism intact.
```
