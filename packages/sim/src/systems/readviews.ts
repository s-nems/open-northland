import type { ContentSet, ProductionInput, WeaponType } from '@vinland/data';
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
