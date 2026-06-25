import type { AnimalType, ContentSet, ProductionInput, TribeType, WeaponType } from '@vinland/data';
import { Building, Settler, Stockpile, stockpileEntries } from '../components/index.js';
import type { World } from '../ecs/world.js';

// Pure, terminal **read views** — derived projections of world state or `content` that the HUD,
// the renderer, and tests consume but **no sim system mutates or feeds back into a decision**. They
// are deliberately kept out of `systems/shared.ts` (the cross-system helper leaf the system files
// import to break import cycles): a read view participates in no cycle — nothing in the per-tick
// `SYSTEM_ORDER` imports one — so grouping them here keeps `shared.ts` to the genuine helpers and
// makes "this is a projection, not a mechanic" legible at the module boundary. Each adds **no**
// behavior (nothing produced/consumed/moved), so they carry "FIDELITY n/a". See docs/TECH-DEBT.md.

/**
 * The **per-job-type head-count** of a `tribe`'s settlers — the HUD's *jobs* read view (the third
 * derived view after {@link tribeStocks} and `tribePopulation`). Counts each living
 * {@link Settler} keyed by its current `jobType`, so a consumer can show "3 farmers, 2 carpenters,
 * 5 babies, 4 idle". An **idle, job-seeking adult** (`jobType === null` — not yet assigned a trade,
 * not a born age class) is counted under the {@link IDLE_JOB} key so it is visible without colliding
 * with any real job id; every other entry's key is a real `JobType.typeId`.
 *
 * The **age-classes-vs-trades** split the HUD wants is a property of the *keys*, not of this view:
 * keys 1–4 are the non-working baby/child stages (`isNonWorkingAge` in `systems/ageclass.ts`), key 5
 * (`woman`) and up are adult roles, and `null`/{@link IDLE_JOB} is an unassigned adult — so a panel
 * partitions the returned map by classifying each key, exactly as the source models life-stage as a
 * `jobType`. This view does not pre-split, to stay a single faithful "settlers by job" tally that
 * any grouping can read.
 *
 * FIDELITY n/a: a pure derived **read view** of existing sim state, like {@link tribeStocks} — it
 * adds no mechanic (nothing is produced/consumed/moved), so there is no original behavior to pin; the
 * `jobType`s it tallies are set by the already-faithful birth/growth/job-assignment systems.
 *
 * Determinism: a `Map`-valued **read view**, not a game decision — the per-job *counts* are
 * order-independent (addition commutes, so the Settler-store traversal order can't change a tally), so
 * the values are identical run-to-run. The returned Map's *iteration* order is insertion order
 * (store-traversal-dependent); a consumer needing a stable display order sorts the keys itself (the
 * same rule {@link tribeStocks} follows). No RNG/wall-clock.
 */
export function tribePopulationByJob(world: World, tribe: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const e of world.query(Settler)) {
    const settler = world.get(e, Settler);
    if (settler.tribe !== tribe) continue;
    const key = settler.jobType ?? IDLE_JOB;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The {@link tribePopulationByJob} map key for an **idle, job-seeking adult** (`Settler.jobType ===
 * null`). It is `-1`, outside the valid `JobType.typeId` space (real ids are positive — the first
 * record, `baby_female`, is id 1; see `systems/ageclass.ts`), so it can never collide with a real
 * job's count. A negative sentinel rather than `0`, because `0` is a legitimate `JobType` id (`none`).
 */
export const IDLE_JOB = -1;

/**
 * The **total stock of each good** a `tribe` holds across all its stores — the goods half of the HUD's
 * read model (`tribePopulation` is the population half). A "store" here is any {@link Building} (which
 * carries the owning `tribe`) bearing a {@link Stockpile}; every placed building gets one (seeded from
 * its type's `stock` slots), so this spans warehouses, workplaces, and residences alike — the whole
 * settlement's larder, exactly what a stocks panel shows.
 *
 * Returned as a `Map<goodType, total>` built by walking each store's canonical {@link stockpileEntries}
 * (ascending goodType) and summing per good. A good with no stock anywhere is simply absent from the
 * map (the HUD shows 0 / omits it); a zero entry that a store happens to carry is kept (it is real
 * capacity holding nothing) — callers that want only non-empty goods filter on the value.
 *
 * FIDELITY n/a: a pure derived **read view** of existing sim state, like `tribePopulation` — it
 * adds no mechanic (nothing is produced/consumed/moved), so there is no original behavior to pin; the
 * stocks it reads are produced by the already-faithful production/carry loops.
 *
 * Determinism: a `Map`-valued **read view**, not a game decision — the per-good *sums* are
 * order-independent (addition commutes, so the store-traversal order can't change a total), and each
 * store is summed via `stockpileEntries` (canonical), so the values are identical run-to-run. The
 * returned Map's *iteration* order is insertion order (store-traversal-dependent); a consumer that
 * needs a stable display order must sort by goodType itself (the same rule {@link Stockpile} follows).
 * No RNG/wall-clock.
 */
export function tribeStocks(world: World, tribe: number): Map<number, number> {
  const totals = new Map<number, number>();
  for (const e of world.query(Building, Stockpile)) {
    if (world.get(e, Building).tribe !== tribe) continue;
    for (const [goodType, amount] of stockpileEntries(world.get(e, Stockpile))) {
      totals.set(goodType, (totals.get(goodType) ?? 0) + amount);
    }
  }
  return totals;
}

/**
 * A single node of the {@link goodsGraph} — one good's place in the recipe-DAG: its node *layer*
 * (raw vs produced, from the good's classification flags), the inputs **one production cycle**
 * consumes to make it (the input side, from `GoodType.productionInputs`), and which building **types**
 * make it (the output side, joined from each building type's `produces`/`recipe.outputs`).
 */
export interface GoodsGraphNode {
  /**
   * The good's tier in the graph: `'raw'` = harvested from the map (`classification.producedOnMap`,
   * e.g. wood/stone/wheat — no recipe), `'produced'` = made in a workplace
   * (`classification.producedInHouse`, e.g. plank/flour/bread). `'unclassified'` covers a good the
   * source marks as neither (the `none`/sentinel good, or a good whose flags default off) — it is
   * still a node so an edge can point at it. A good flagged *both* (none are in the real data) is
   * reported as `'produced'` (the in-house tier wins, since it has a recipe).
   */
  layer: 'raw' | 'produced' | 'unclassified';
  /** Whether this good can be **consumed** as a recipe input somewhere (`classification.inputGood`). */
  inputGood: boolean;
  /** The goods (+ per-cycle amounts) one cycle consumes to make this good — empty for a raw good. */
  inputs: readonly ProductionInput[];
  /**
   * The building **type ids** that produce this good, ascending — the output side of the join. A good
   * with no producer (a raw good, or one nothing makes) has an empty list. Type ids, not entities:
   * this is a static read over `content`, independent of what is placed in any world.
   */
  producedBy: readonly number[];
}

/**
 * The **goods graph** as a derived **read view** over `content` — the HUD's *goods-graph* panel
 * (the fourth derived view after {@link tribeStocks}, `tribePopulation`, and
 * {@link tribePopulationByJob}, and the only one over content rather than world state). It surfaces
 * the recipe-DAG the pipeline already extracted as IR — `GoodType.productionInputs` (the input-side
 * edges) + `GoodType.classification` (the raw/produced/input node layers) — joined with the
 * **output side**: which building types make each good (`BuildingType.produces`, falling back to a
 * `recipe`'s `outputs` when `produces` is empty). The result is one {@link GoodsGraphNode} per good,
 * so a panel can draw "wood (raw) → sawmill → plank (produced) → …" without re-walking content.
 *
 * Returned as a `Map<goodType, GoodsGraphNode>` keyed by `GoodType.typeId`, one entry per good in
 * `content.goods`. The `producedBy` list is sorted ascending so the view is stable regardless of
 * building declaration order; the input edges keep their `productionInputs` order (already the
 * source's). Every good gets a node even if nothing produces or consumes it, so an edge always has
 * both endpoints present.
 *
 * FIDELITY n/a: a pure derived **read view** of the already-extracted goods-graph IR, like
 * {@link tribeStocks} — it adds no mechanic (nothing is produced/consumed/moved) and invents no
 * data; the layers/edges it surfaces are the faithful `classification`/`productionInputs` params the
 * pipeline pinned (see ROADMAP Phase 3 "Goods graph").
 *
 * Determinism: a pure function of `content` (no world, no RNG, no wall-clock) — but `content.goods`
 * is a plain array and the `producedBy` list is explicitly **sorted**, so the same content yields a
 * byte-identical map every call. The returned Map's iteration order is `content.goods` order (a
 * stable array), so even iteration is reproducible here (unlike the world-state read views, whose Map
 * order is store-traversal-dependent).
 */
export function goodsGraph(content: ContentSet): Map<number, GoodsGraphNode> {
  // Output side: for each good, the building type ids that make it. Prefer `produces` (the
  // output-good list the original house table names directly); fall back to a recipe's `outputs`
  // for a building that carries a materialized recipe but no `produces` (e.g. a test fixture).
  const producers = new Map<number, number[]>();
  for (const building of content.buildings) {
    const outputs =
      building.produces.length > 0
        ? building.produces
        : (building.recipe?.outputs.map((o) => o.goodType) ?? []);
    for (const goodType of outputs) {
      const list = producers.get(goodType);
      if (list === undefined) producers.set(goodType, [building.typeId]);
      else if (!list.includes(building.typeId)) list.push(building.typeId);
    }
  }

  const graph = new Map<number, GoodsGraphNode>();
  for (const good of content.goods) {
    const c = good.classification;
    const layer = c.producedInHouse ? 'produced' : c.producedOnMap ? 'raw' : 'unclassified';
    graph.set(good.typeId, {
      layer,
      inputGood: c.inputGood,
      inputs: good.productionInputs,
      producedBy: (producers.get(good.typeId) ?? []).sort((a, b) => a - b),
    });
  }
  return graph;
}

/**
 * One row of the {@link combatDamage} view — a single weapon resolved against **one** armor class:
 * how much damage it lands on a target wearing that armor.
 */
export interface CombatDamageRow {
  /** The target's armor class — the key the original's `damagevalue <armorClass> <value>` uses.
   *  Class `0` = **unarmored** (a bare target, no `[armortype]` record). */
  armorClass: number;
  /** The weapon's listed damage against this armor class (`WeaponType.damage["<armorClass>"]`), i.e.
   *  the raw per-class value the original `weapontypes` table pre-tabulates. `0` if the weapon lists
   *  no value for this class (it does the target no harm). */
  rawDamage: number;
  /** The mitigation the target's armor subtracts (`ArmorType.blockingValue` for `armorClass`). `0`
   *  for an unarmored class (`0`) and for a class with **no `[armortype]` record** (the higher tiers
   *  `6`/`7` the real `weapontypes` references but `armortypes.ini` doesn't define) — those are treated
   *  as unarmored rather than crashing, the KNOWN GAP the roadmap names. */
  blockingValue: number;
  /** The **net** damage actually dealt: `max(0, rawDamage - blockingValue)`. Clamped at `0` so a
   *  target's armor can fully absorb a weak hit but never *heals* the target (no negative damage). */
  netDamage: number;
  /** Whether `armorClass` has a real `[armortype]` record (`1..4` in the base data). `false` for the
   *  unarmored class `0` and for an out-of-table class (`6`/`7`) — both resolve as unarmored
   *  (`blockingValue 0`); the flag lets a consumer tell "bare target" from "undefined armor tier". */
  hasArmorRecord: boolean;
}

/**
 * One weapon's combat profile in the {@link combatDamage} view — its identity (the composite
 * `(tribeType, typeId)`, exactly as the cross-ref system keys `weapontypes`, plus the `id` slug for
 * display) and its resolved {@link CombatDamageRow}s, one per armor class it can target.
 */
export interface CombatProfile {
  /** Owning tribe (`WeaponType.tribeType`) — part of the canonical `(tribeType, typeId)` identity. */
  tribeType: number | undefined;
  /** The weapon's `typeId` — NOT globally unique on its own (recurs per tribe); paired with
   *  `tribeType` for identity, and even that pair is reused for a few animal weapons (see the fn doc). */
  typeId: number;
  /** The weapon's `id` slug (`"fist"`, `"wooden_spear"`, …) — also not globally unique. */
  id: string;
  /** The composite key `"<tribeType>:<typeId>"` ({@link weaponKey}) — the cross-ref identity, surfaced
   *  so a consumer can index by it (mind that animal weapons reuse a pair; see the fn doc). */
  key: string;
  /** Net damage vs. every armor class this weapon can target, ascending by `armorClass`. */
  rows: readonly CombatDamageRow[];
}

/**
 * The **combat damage table** as a derived **read view** over `content` — the read half of the
 * CombatSystem, exactly analogous to the HUD's content-only {@link goodsGraph}: it joins each
 * {@link WeaponType} against every armor class (plus the unarmored class `0`), resolving
 * the **net** damage a weapon lands on a target — `max(0, weapon.damage[armorClass] -
 * armor.blockingValue)`. No mechanic is added (nothing is hit, no entity loses hitpoints); this is the
 * static damage *lookup* the later combat atomics will read, surfaced once so a hit doesn't re-walk
 * the two tables.
 *
 * The armor classes covered are the **union** of `content.armor`'s `typeId`s (the real 1..4) and the
 * unarmored class `0`, plus any extra class a weapon's `damage` references — the real `weapontypes`
 * lists classes **6 and 7** with *no* `[armortype]` record (higher tiers outside the 4-record table).
 * Those out-of-table classes are treated as **unarmored** (`blockingValue 0`, `hasArmorRecord false`)
 * rather than dropped or thrown on — the KNOWN GAP the roadmap calls out. So every armor class a
 * weapon can target gets a row, and an absent armor record never crashes the join.
 *
 * Returned as an **array of {@link CombatProfile}**, one per `content.weapons` entry, in source array
 * order — **not** a Map keyed by weapon identity, deliberately: no weapon key is globally unique. A
 * `WeaponType.typeId` recurs per tribe (`2 = "fist"` for every tribe), so we carry the composite
 * `(tribeType, typeId)` `key`; but the real **animal** weapons reuse even that pair (tribe 5 has both
 * `chicken` and `claw` at typeId 1; tribe 8 lists `bearfist` twice), so a Map keyed on the composite
 * would silently drop those records (last-wins). An array loses nothing — every weapon gets a profile —
 * which a read view must guarantee. Each profile's `rows` are sorted ascending by `armorClass`.
 *
 * FIDELITY n/a: a pure derived **read view** of the already-extracted `weapontypes`/`armortypes` IR,
 * like {@link goodsGraph} — it adds no behavior (no hit resolution, no hitpoints, no targeting) and
 * invents no data; the `damage`/`blockingValue` params it joins are the faithful values the pipeline
 * pinned (see docs/FIDELITY.md "Armor type table"). The *combat behavior* (who hits whom, when, the
 * hitpoint loop) is a separate, still-unbuilt mechanic with no oracle — this is only its lookup table.
 *
 * Determinism: a pure function of `content` (no world, no RNG, no wall-clock); the class union is
 * built by walking the armor `typeId`s + the weapon's `damage` keys into a Set then **sorting**, and
 * the profiles keep `content.weapons` array order, so the same content yields a byte-identical array
 * every call.
 */
export function combatDamage(content: ContentSet): CombatProfile[] {
  // Armor class -> its record's blockingValue. Class 0 (unarmored) and any out-of-table class a
  // weapon references resolve to "no record" (mitigation 0) below.
  const blockingByClass = new Map<number, number>();
  for (const armor of content.armor) blockingByClass.set(armor.typeId, armor.blockingValue);

  const profiles: CombatProfile[] = [];
  for (const weapon of content.weapons) {
    // The armor classes THIS weapon can target: the unarmored class 0, every defined armor record,
    // and any extra class its own `damage` lists (the out-of-table 6/7). A Set de-dupes; sorting
    // makes the row order stable regardless of how the classes were discovered.
    const classes = new Set<number>([0, ...blockingByClass.keys()]);
    for (const key of Object.keys(weapon.damage)) {
      const c = Number(key);
      if (Number.isInteger(c)) classes.add(c);
    }

    const rows: CombatDamageRow[] = [];
    for (const armorClass of [...classes].sort((a, b) => a - b)) {
      const rawDamage = weapon.damage[String(armorClass)] ?? 0;
      const hasArmorRecord = blockingByClass.has(armorClass);
      const blockingValue = hasArmorRecord ? (blockingByClass.get(armorClass) ?? 0) : 0;
      rows.push({
        armorClass,
        rawDamage,
        blockingValue,
        netDamage: Math.max(0, rawDamage - blockingValue),
        hasArmorRecord,
      });
    }
    profiles.push({
      tribeType: weapon.tribeType,
      typeId: weapon.typeId,
      id: weapon.id,
      key: weaponKey(weapon),
      rows,
    });
  }
  return profiles;
}

/**
 * The composite key naming a weapon's cross-ref identity — `"<tribeType>:<typeId>"`. A
 * `WeaponType.typeId` is NOT globally unique (the same id recurs once per tribe — `2 = "fist"` for
 * every tribe), so a weapon is keyed by **both** ids; a weapon with no `tribeType` keys under the
 * empty-tribe slot (`":<typeId>"`). Mirrors how the extractor keys `weapontypes` by `(tribeType,
 * typeId)` (see docs/LESSONS.md `[bfe2491]`). NOTE even this pair is reused by a few animal weapons,
 * so it identifies a weapon's *class* but is not a unique key — see {@link combatDamage}.
 */
export function weaponKey(weapon: Pick<WeaponType, 'tribeType' | 'typeId'>): string {
  return `${weapon.tribeType ?? ''}:${weapon.typeId}`;
}

/**
 * The **playable (controllable) tribes** as a derived **read view** over `content` — the N civilizations
 * a player can command, distinguished from the animal/monster tribes *by the data alone*, never by a
 * hardcoded name or count ("two"). `content.tribes` is a flat list of every `[tribetype]` the pipeline
 * extracted — the 5 civilizations (viking/frank/saracen/byzantine/egypt) **and** the 36 animal/monster
 * tribes (`bears`, `wolves`, `weresnake`, …). The distinguishing signature is the **tech graph**: only a
 * civilization carries `jobEnables` edges (and, equivalently, `{need,train}for*` `jobRequirements`) — an
 * animal tribe is purely an atomic-binding vocabulary with `jobEnables.length === 0`. So a playable
 * tribe is exactly one with a non-empty `jobEnables` graph; this is the data-defined "N tribes" the
 * combat targeting and the upcoming non-controllable-animals item both build on, with nothing hardcoded.
 *
 * Returned as a {@link TribeType} **array** sorted ascending by `typeId` (not a Map keyed by id) so the
 * enumeration order is stable regardless of `content.tribes` declaration order — the canonical order a
 * "for each playable tribe" loop (births, AI, scoring) wants. {@link isPlayableTribe} is the matching
 * membership predicate for a single `tribeType` without materializing the list.
 *
 * FIDELITY n/a: a pure derived **read view** over the already-extracted tribe IR, like {@link goodsGraph}
 * — it adds no mechanic (nothing produced/consumed/moved) and invents no classification: the
 * playable-vs-animal split is read straight off whether the source `[tribetype]` block declared a
 * `jobEnables*` tech graph, the faithful param the pipeline pinned (ROADMAP Phase 4 "N data-defined
 * tribes": asymmetry through each tribe's bindings + `allow*`/`needfor*` graph, never hardcode "two").
 *
 * Determinism: a pure function of `content` (no world, no RNG, no wall-clock) over the plain
 * `content.tribes` array, explicitly **sorted** by `typeId`, so the same content yields a byte-identical
 * array (and iteration order) every call.
 */
export function playableTribes(content: ContentSet): TribeType[] {
  return content.tribes.filter((t) => t.jobEnables.length > 0).sort((a, b) => a.typeId - b.typeId);
}

/**
 * Whether `tribeType` is a **playable (controllable) civilization** — the single-tribe membership half
 * of {@link playableTribes}, for a caller (combat enemy-vs-animal targeting, a per-tribe AI gate) that
 * has a `tribe` id and only needs the yes/no, without materializing the sorted list. A tribe is playable
 * iff its `[tribetype]` carries a non-empty `jobEnables` tech graph (see {@link playableTribes}); an
 * unknown `tribeType` (no matching record) is **not** playable. Pure over `content`, no RNG/wall-clock.
 */
export function isPlayableTribe(content: ContentSet, tribeType: number): boolean {
  const tribe = content.tribes.find((t) => t.typeId === tribeType);
  return tribe !== undefined && tribe.jobEnables.length > 0;
}

/**
 * Whether `tribeType` is a **known animal/monster tribe** — a `[tribetype]` the pipeline DID extract
 * (so it has a record) but that carries **no tech graph** (`jobEnables.length === 0`). This is the
 * complement of {@link isPlayableTribe} *restricted to recorded tribes*: of the 41 extracted tribes
 * the 5 civilizations are playable and the other 36 are animals, distinguished by the same data
 * signature ({@link playableTribes} — only a civilization carries `jobEnables` edges), never by a
 * hardcoded name or count.
 *
 * The distinction from `!isPlayableTribe` matters at the boundary: an **unknown** `tribeType` (no
 * matching record at all — e.g. a synthetic test fixture's enemy, or a not-yet-loaded tribe) is
 * `!isPlayableTribe` but is **not** an animal — we know nothing about it, so it must not be silently
 * reclassified as wildlife. So this returns `true` only for a tribe we have a record for AND that
 * record proves animal (empty tech graph); an absent record is `false` here just as it is in
 * {@link isPlayableTribe}. The combat targeting drive (`systems/combat.ts`) uses this to keep an
 * animal tribe out of the **player-vs-player** enemy predicate — civ-vs-animal aggression is a
 * separate, data-driven (`animaltypes.ini`) model, not the same-different-tribe rule.
 *
 * FIDELITY n/a: a pure derived **read view** over the already-extracted tribe IR, like
 * {@link isPlayableTribe} — it adds no mechanic and invents no classification; the animal-vs-civ split
 * is read straight off whether the source `[tribetype]` declared a `jobEnables*` tech graph. Pure over
 * `content`, no RNG/wall-clock.
 */
export function isAnimalTribe(content: ContentSet, tribeType: number): boolean {
  const tribe = content.tribes.find((t) => t.typeId === tribeType);
  return tribe !== undefined && tribe.jobEnables.length === 0;
}

/**
 * The {@link AnimalType} behaviour record for `tribeType`, or null — a pure read over `content.animals`,
 * keyed by `tribeType` (an animal's identity IS its owning tribe — see docs/FIDELITY.md "Animal type
 * table"). Returns the **first** match in source-array order: the real `animaltypes.ini` reuses a
 * `tribetype` for a couple of records (tribe 23 appears twice), so the table is an array, not a Map —
 * keying by `tribeType` would silently drop a record (the same array-not-Map decision the weapon/combat
 * read views make). null when the tribe has no animal record (a civilization, or an unknown tribe).
 *
 * FIDELITY n/a: a pure derived **read view** over the already-extracted `animaltypes` IR — it adds no
 * mechanic and invents no data; the behaviour flags it surfaces are the faithful params the pipeline
 * pinned. Pure over `content`, no RNG/wall-clock.
 */
export function animalRecord(content: ContentSet, tribeType: number): AnimalType | null {
  return content.animals.find((a) => a.tribeType === tribeType) ?? null;
}

/**
 * Whether `tribeType` is an **aggressive** animal — a `[tribetype]` whose `animaltypes.ini` record sets
 * `aggressive` (it attacks civilizations **unprovoked**, the civ-vs-animal aggression driver). The sim's
 * combat targeting (`systems/combat.ts`) reads this so an aggressive animal (a bear, a wolf pack) runs
 * an attack drive against a nearby civilization, while a passive animal (a cow, a decorative bird) does
 * not. A tribe with no animal record (a civilization, an unknown tribe) is not aggressive.
 *
 * NOTE this is the **unprovoked** driver only (`aggressive`). The `getAngry`/`angryGameTime` half — an
 * otherwise-passive animal **provoked** into temporary hostility (it was attacked, then stays hostile
 * for `angryGameTime` ticks) — needs a per-entity provocation/anger-timer state the combat slice does
 * not yet model; it is a deferred follow-up (docs/FIDELITY.md "Civ-vs-animal aggression").
 *
 * FIDELITY n/a here (a read view); the *behaviour* it drives is tracked in docs/FIDELITY.md. Pure over
 * `content`, no RNG/wall-clock.
 */
export function isAggressiveAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.aggressive ?? false;
}

/**
 * Whether `tribeType` is an animal that **cannot be attacked** by a civilization — a `[tribetype]` whose
 * `animaltypes.ini` record sets `cannotbeattacked` (decorative/non-combat fauna: bees, butterflies). The
 * combat targeting drive uses this to **exempt** such an animal from a civilization's attacks (it is
 * never a valid target), even if it is somehow flagged aggressive. A tribe with no animal record is not
 * exempt (it is not a decorative animal). Pure over `content`, no RNG/wall-clock; FIDELITY n/a (read view).
 */
export function animalCannotBeAttacked(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.cannotBeAttacked ?? false;
}

/**
 * The **adult hitpoint pool** an animal of `tribeType` is born with — its `animaltypes.ini`
 * `hitpoints_adult` (200..50000 in the real data; e.g. a bear's 15000), or null when the tribe has no
 * animal record (a civilization — humans' HP is below the `.ini`, so it is content-stamped elsewhere).
 * This is the {@link Health}-component stamp source for an animal combatant: a spawned animal gets a
 * `Health{hitpoints: max, max}` from this, exactly as the combat hit-resolution mechanic already reads
 * `Health` (docs/FIDELITY.md "Combat hit resolution"). The animal-spawn/herding slice that actually
 * places animals on the map will call this; the value is the faithful extracted param.
 *
 * FIDELITY: the **hitpoint magnitude** is the verbatim extracted `hitpoints_adult` (a faithful param);
 * the *spawning* of animals (where/when/how many) is a later slice with no oracle. Pure over `content`,
 * no RNG/wall-clock.
 */
export function animalHitpoints(content: ContentSet, tribeType: number): number | null {
  const animal = animalRecord(content, tribeType);
  return animal === null ? null : animal.hitpointsAdult;
}

/**
 * The **herd/spawn parameters** a future animal-spawn/herding slice needs to place a group of animals
 * of `tribeType` on the map — read straight off the `animaltypes.ini` record, or null when the tribe
 * has no animal record (a civilization, or an unknown tribe). The fields are the faithful extracted
 * params, surfaced as one struct so the spawner reads a single view (the same one-call shape
 * {@link combatDamage}/{@link goodsGraph} give their consumers):
 *
 *  - `maxGroupSize` (`maximumgroupsize`) — how many of this animal form a herd/pack (the count a spawn
 *    point seeds; 0 = the source omitted it, a solitary animal).
 *  - `searchForLeader` (`searchforleader`) — whether a member follows a herd leader (wolves/deer) vs
 *    roams solo, which decides whether the spawned group needs a designated leader entity.
 *  - `birthPointRange` (`maximumdistancetobirthpoint`) — how far the herd ranges from its birth/spawn
 *    point (the radius around the spawn tile the group scatters into).
 *  - `stayPointRange` (`maximumdistancetostaypoint`) — the territory radius around the animal's stay
 *    point (how far it wanders before turning back).
 *
 * FIDELITY n/a: a pure derived **read view** over the already-extracted `animaltypes` IR — it adds no
 * mechanic and invents no data; the *spawning/herding behaviour* these params will drive (where/when a
 * group appears, how it follows a leader) is a later slice with no oracle, tracked separately in
 * docs/FIDELITY.md. Pure over `content`, no RNG/wall-clock.
 */
export interface HerdParams {
  /** `maximumgroupsize` — herd/pack size (0 = solitary / source-omitted). */
  readonly maxGroupSize: number;
  /** `searchforleader` — a member follows a herd leader vs roams solo. */
  readonly searchForLeader: boolean;
  /** `maximumdistancetobirthpoint` — how far the herd ranges from its spawn point. */
  readonly birthPointRange: number;
  /** `maximumdistancetostaypoint` — territory radius around the animal's stay point. */
  readonly stayPointRange: number;
}

export function herdParams(content: ContentSet, tribeType: number): HerdParams | null {
  const animal = animalRecord(content, tribeType);
  if (animal === null) return null;
  return {
    maxGroupSize: animal.maximumGroupSize,
    searchForLeader: animal.searchForLeader,
    birthPointRange: animal.maximumDistanceToBirthPoint,
    stayPointRange: animal.maximumDistanceToStayPoint,
  };
}

/**
 * The **combat hostility relation** — may a combatant of `attackerTribe` swing at a combatant of
 * `targetTribe`? The single source of truth the CombatSystem's targeting drive (`systems/combat.ts`)
 * consults for *both* the attacker-eligibility check and the per-candidate target check, so the two
 * directions of a fight stay consistent. The rules, in order:
 *
 *  - **Same tribe → no** (friendly fire is off; a tribe never wars on itself).
 *  - **Both animals → no.** Animals don't fight each other in this slice (no oracle for inter-species
 *    wildlife aggression); an animal's only combat is with civilizations.
 *  - **Civilization vs civilization (different tribes) → yes** — the player-vs-player drive. A
 *    different-tribe combatant with **no** record at all (an unknown tribe — a synthetic test enemy) is
 *    NOT an animal, so this branch treats it as a civilization and a valid enemy (the three-truth-states
 *    rule — see docs/LESSONS.md `[fe2470f]`: `!isPlayableTribe` ≠ `isAnimalTribe`).
 *  - **Civilization → animal → yes only if the animal is {@link isAggressiveAnimal} AND not
 *    {@link animalCannotBeAttacked}.** A civ engages a *hostile* (aggressive) animal but not passive
 *    prey (a cow/deer — hunting is the separate `catchable`/hunter mechanic, not combat); and a
 *    decorative `cannotbeattacked` animal (bees) is exempt from a civ's attacks entirely.
 *  - **Animal attacker must be aggressive.** A passive animal (a cow/deer, or a known animal tribe with
 *    no `animaltypes` record) attacks **nothing** — so an **aggressive** animal → civilization is the
 *    unprovoked aggression driver (a bear/wolf attacks a nearby settler), while a passive animal →
 *    anything is `false`. This makes `mayAttack` self-contained (it gates the attacker side itself, not
 *    only the combat loop); `cannotbeattacked` gates only being a *target*, not attacking, so an
 *    aggressive but `cannotbeattacked` animal (a bee) can still attack a civ.
 *
 * FIDELITY: the hostility gate reads the faithful extracted params — the civ-vs-animal split off
 * `isAnimalTribe`'s tech-graph signature, and `aggressive`/`cannotbeattacked` off `animaltypes.ini`.
 * The cross-civilization "all different tribes are enemies" rule (no alliances/neutrality yet) and the
 * "civ engages only aggressive animals, animals don't fight each other" simplifications are our
 * deterministic design pending an oracle (docs/FIDELITY.md "Civ-vs-animal aggression"). Pure over
 * `content`, no RNG/wall-clock.
 */
export function mayAttack(content: ContentSet, attackerTribe: number, targetTribe: number): boolean {
  if (attackerTribe === targetTribe) return false; // same tribe — friendly
  const attackerIsAnimal = isAnimalTribe(content, attackerTribe);
  const targetIsAnimal = isAnimalTribe(content, targetTribe);
  // An animal attacker must be AGGRESSIVE to attack anything — a passive animal (a cow/deer, or a
  // known animal tribe with no animaltypes record) picks no fight. This is the authoritative gate, so
  // `mayAttack` is fully self-contained (a caller need not pre-filter the attacker); the combat loop's
  // matching skip is only a fast-path that avoids the target scan.
  if (attackerIsAnimal && !isAggressiveAnimal(content, attackerTribe)) return false;
  if (attackerIsAnimal && targetIsAnimal) return false; // animals don't war on each other (no oracle)
  if (targetIsAnimal) {
    // attacker is a civilization (or unknown — not an animal) hitting an animal: only a hostile,
    // non-exempt animal is a valid target. Passive prey and decorative fauna are left alone.
    return isAggressiveAnimal(content, targetTribe) && !animalCannotBeAttacked(content, targetTribe);
  }
  // target is a civilization (or unknown); the attacker is a civilization or an aggressive animal — enemy.
  return true;
}
