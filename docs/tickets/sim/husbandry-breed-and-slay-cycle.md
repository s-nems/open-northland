# Rebuild husbandry on the original breed-and-slay cycle

**Area:** sim, data, pipeline, app · **Priority:** P2 · **Focus:** `packages/sim/src/systems/livestock`

The animal farm currently feeds a penned animal through a grain+water recipe that mints a `sheep` /
`cattle` token good and drains the visitor's hitpoints (`processing/life-cost.ts`), then converts the
token into wool, leather, or meat with separate recipes. The original has no token and no visit: the
breeder either breeds (a new baby animal joins the herd and grows up) or slays one adult at the farm
door, and the slay animation itself deposits the goods. Consequence: herds never grow, animals shuttle
in and out with a visible health drain, and the panel offers wool/meat/leather as productions the
original never lets the breeder pick.

## Source basis

Readable data in the owned copy (`docs/SOURCES.md` class 1):

- `Data/logic/goodtypes.ini`: `sheep` 57 and `cattle` 58 are in-house goods from 2 grain + 1 water
  with atomics 85/86 and `isInputGoodFlag 0`; `wool` lists input 57, `leather` input 58, `meat` no
  inputs and atomic 49.
- `DataCnmd/types/houses.ini` animal farm (logictype 17): 2 breeders + 1 carrier;
  `logicproduction 21 10 9 57 58`; stock 57/58 capacity 20 each = herd cap ("20 oxen and sheep",
  manual p. 53); meat/wool/leather 30; water/grain 10.
- `DataCnmd/tribetypes12/tribetypes.ini`: `jobEnablesGood 16 57`, `jobEnablesGood 16 58`,
  `jobDefaultGood 16 58`; meat 21 and leather 9 are enabled by the hunter (job 15). So the breeder's
  selectable productions are the house's production list restricted to the goods its job enables.
  Atomics 85..88 are breed sheep/cattle, slay sheep/cattle (`setatomic 16 ...`).
- `DataCnmd/atomicanimations12/atomicanimations.ini`: `*_breeder_slay_sheep` deposits 1 wool + 2 meat
  and `*_breeder_slay_cattle` 2 leather + 2 meat through `event <frame> 27 <good>`; `produce_sheep` /
  `produce_cattle` fire the produce event at frame 80 of 100.
- `Data/logic/animaltypes.ini`: keys `catchable`, `movespeed`, `hitpoints_baby`, `hitpoints_adult`,
  `maximumleaderdistance`, `maximumdistancetostaypoint`, `maximumdistancetobirthpoint`,
  `maximumgroupsize`; `Data/logic/jobtypes.ini` gives animals `baby_animal` 48 / `adult_animal` 49.
- Map script defines: diplomacy state 3 is `DIPLOMACY_STATE_ENEMY`
  (`tools/asset-pipeline/src/decoders/ini/map-script.ts`).

Byte-level evidence from the owned copy's unencrypted `GameMp.exe` (decompiled in the
`Cultures2Engine` Ghidra project, VAs below), cross-checked against the symbol-rich macOS build:

- Breeder job cycle (0x46b97b). Each cycle zeroes the 57/58 stock rows and re-adds one per animal
  attached to the farm, so the rows equal the attached herd. Candidates are the player's sheep 19 or
  cows 10 not attached to a vehicle. An unattached one of either species, or one of the production
  species attached to a warehouse-type house, is the adoption candidate (nearest to the farm) and is
  attached while the production species' row is not full. Only while that row holds fewer than 2 does
  the breeder take an animal from another farm: the nearest of the species, any age, from up to 5
  farms holding more than 2 of it (0x46bf29). Full meat 21, then wool 10 (sheep) / leather 9
  (cattle), is flushed first. Adults are job 0x31; the slay target is the adult of the species nearest
  the door, and one already in house-interaction mode (animal task 10) keeps priority.
- With more than 2 adults the breeder slays: it walks to the animal, within 2 nodes puts it into
  house-interaction mode (0x46054f), waits while adjacent, and once the animal stands on the door
  tile walks there itself; with both on the door tile it frees the animal (0x41ba71), clears a cadaver
  landscape 79/80 on that tile, and plays atomic 87 (sheep) or 88 (cattle). With exactly 2 adults and
  room in the row it produces (0x474bb2); with fewer it fails.
- Produce event (0x46807f, 0x46819c): inputs are consumed at the produce event, and for goods 57/58
  the baby is spawned with job 0x30 at the position of the second adult of the species attached to
  this farm within 40 nodes, then attached to the farm.
- Animal lifetime: created with `hitpoints_baby` / `_adult` and a random hunger 0..399 (0x42d43e);
  every game tick hunger -1, age +1, and a job 0x30 animal becomes 0x31 at age 3600 (0x42d68a); hp
  at or below 0 marks it dead. Farm animals never reproduce by themselves: reproduction (0x460375) is
  wild player 20 only, for a leader with 2+ followers below `maximumgroupsize`, checked when
  `(tick / 12) % 600 == 0` and `(leaderId + tick) % 60 == 0` (0x42d713), and spawns an adult.
- Grazing: when hunger drops below 1 the animal eats (0x4601a9): on a grass cell it gains
  100..499 hunger and a tenth of that as hp, capped at the type's hitpoints; otherwise it searches
  grass within its leader distance. For a house-attached animal the type ranges are replaced by
  leader distance 15 (0x42e968), birth-point distance 10 (0x42e98e) and stay-point distance 5
  (0x42e9b4); the birth point is the farm door, so the herd wanders within 15 nodes of it
  (0x45ff71). A claimed animal held by no farm attaches to the headquarters and wanders around its
  door the same way.
- Animal type defaults before parsing (0x411c08..0x411c16): movespeed 8, hitpoints adult 1000,
  baby 500; the base cow block has no `hitpoints_baby`, so a calf gets 500.
- Scout claim (0x461e32..0x461e4e): every new map position of a scout runs the claim with ring
  parameter 3, which covers the centre plus rings 1 and 2 (0x44ce79), i.e. hex distance 2; the
  per-point function (0x44ced2) takes only `catchable` types owned by the wild player 20 or by a
  player toward whom the claiming player holds diplomacy state 3.

macOS build only (treat as approximation): atomic event 27 deposits the event's good into the work
house stock with the amount scaled by the breeder's job efficiency.

## Scope

1. **Content and pipeline.** A producing building's `recipes` come from its `produces` list
   restricted to the goods its worker jobs enable (`tribes[].jobEnables` of kind `good`). That
   leaves the farm with the 57/58 recipes (2 grain + 1 water, `DEFAULT_RECIPE_TICKS`) and drops
   wool/leather/meat there; confirm through `npm run test:content` that no other building loses a
   recipe, and report it if one does. A 57/58 recipe's output is a baby animal, never a stock good.
   The 57/58 stock rows hold the attached herd per species, capacity 20 each. Absent
   `hitpoints_baby` / `_adult` default to 500 / 1000.
2. **Herd state.** The herd is the set of animals attached to the farm: a component on the animal
   naming its farm replaces `LivestockVisit`. The 57/58 rows are recomputed from it every breeder
   cycle. Each of the two breeders runs the cycle independently for the farm's currently selected
   production good (the existing production choice; default cattle per `jobDefaultGood`).
3. **Breeder cycle**, in this order, one branch per cycle:
   1. Adopt: while the production species' row is below 20, attach the player's nearest (to the
      farm) sheep or cow of either species that no farm holds.
   2. Take: only when the production species' row is below 2 and nothing was adopted, attach the
      nearest animal of that species, any age, from another own farm holding more than 2 of it.
   3. Flush: when meat 21 is full, or wool 10 (sheep) / leather 9 (cattle) is full, carry it out as
      the existing flush-stock behaviour and do nothing else.
   4. Slay when adults (job 49) of the species exceed 2. Target the adult nearest the door; one
      already summoned keeps priority. The breeder walks toward it; within 2 nodes it summons it and
      waits while adjacent; the summoned animal walks to the door tile and waits there. Once the
      animal stands on the door tile the breeder walks to the door; with both on the door tile the
      animal is removed, the slay atomic plays, and at its end 1 wool + 2 meat (sheep) or 2 leather +
      2 meat (cattle) enter the farm stock. Slay duration is the slay atomic's frame count when the
      sim has it, else a named constant.
   5. Breed when adults equal 2 and the row is below 20: the ordinary production of the species good
      (inputs collected, consumed, produce atomic at the door). On completion a baby (job 48) spawns
      beside an adult of the species attached to the farm and joins the herd; it becomes an adult
      3600 ticks after birth.
   6. Otherwise the breeder idles this cycle.
4. **Remove** `LivestockVisit`, the visit life cost (`processing/life-cost.ts`) and livestock regen.
   Hunger and grazing-based hp recovery are out of scope: hp stays as created until hunting or
   combat. Touch points beyond `systems/livestock`: `economy/production.ts`, `production/cycles.ts`,
   `movement/herding.ts`, `movement/animal-wander.ts`, `settlers/planner/replan.ts`,
   `readviews/tribes/livestock.ts`, `app/src/scenes/livestock.ts`.
5. **Claim and grazing.** Every step of a scout claims catchable animals within hex distance 2 that
   are wild or owned by a player toward whom the scout's player holds the `enemy` stance
   (`diplomacyStance`). Farm animals wander within 15 nodes of the farm door; claimed animals no
   farm holds keep the current headquarters-door anchoring.
6. **Panel.** Herd count per species from the rows and the species choice through the existing
   production toggle; reconcile `../features/husbandry-player-feedback.md`, whose stall reasons name
   the token model.

Name these as approximations in code: slay duration, inputs consumed at completion instead of at
frame 80, deposit amounts unscaled by job efficiency, a single 15-node leash instead of the
work-centre and stay-point structure, no hunger.

## Verify

- Unit tests for adopt, take-from-neighbour, flush precedence, slay, breed, and grow in
  `packages/sim/test/livestock`.
- `npm run test:pipeline` and `npm run test:content` with the owned copy present; the recipe diff is
  limited to the animal farm.
- Golden hashes move once, intentionally.
- Browser `?scene=livestock`: a claimed pair breeds, the calf grows, and one slaughter follows each
  grown calf with goods appearing in the farm stock.
