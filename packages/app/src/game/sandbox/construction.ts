import { BUILDING_KIND } from '@open-northland/data';
import type { VikingBuilding } from '../../catalog/buildings.js';
import {
  BUILDING_ARMORY,
  BUILDING_BAKERY,
  BUILDING_DRUID_HUT,
  BUILDING_HOME_00,
  BUILDING_HOME_01,
  BUILDING_HOME_02,
  BUILDING_HOME_03,
  BUILDING_JOINERY,
  BUILDING_JOINERY_01,
  BUILDING_JOINERY_02,
  BUILDING_MASON_HUT,
  BUILDING_POTTERY,
  BUILDING_SMITHY,
  BUILDING_TAILOR,
  BUILDING_WAREHOUSE_00,
  BUILDING_WAREHOUSE_01,
  BUILDING_WATCHTOWER,
  GOOD_STONE,
  GOOD_WOOD,
} from './ids/index.js';

/**
 * Global construction data — every building is raised the original way: the player places a foundation
 * (the tool panel enqueues `placeBuilding` `underConstruction`), carriers/builders deliver its materials,
 * and a builder hammers it up (the ConstructionSystem). This is not a per-scene demo: the same cost + life
 * pool apply in every scene and on every map. A building with no cost would instead pop up instantly and a
 * `GOOD_NONE` cost would stall (good 0 is undeliverable), so each carries a real, deliverable bill.
 *
 * Named approximation (source basis: our design — the engine's build loop has no oracle, AGENTS.md). The
 * real per-type material bill (`[GfxHouse] LogicConstructionGoods`) and `logichitpoints` are extracted, but
 * the bill is keyed by the original game's good ids, not yet unified into the sandbox good space (the
 * deferred global-content id unification). So the cost is approximated in sandbox goods — a wood+stone
 * parcel scaled by building class (a warehouse/hall costs more units → more builder strikes than a hut) —
 * and hitpoints is a per-class default. Leveled types keep their chains ({@link buildingUpgradeTarget}),
 * each tier a parcel up (the tier's own cost doubles as its upgrade-difference bill).
 */
function buildParcel(wood: number, stone: number): readonly { goodType: number; amount: number }[] {
  return [
    { goodType: GOOD_WOOD, amount: wood },
    { goodType: GOOD_STONE, amount: stone },
  ];
}
/** Per home tier (`home_level_00..04` = typeIds {@link BUILDING_HOME_00}+0..4): a rising wood+stone bill. */
const HOME_BUILD_COST_BY_LEVEL: readonly (readonly { goodType: number; amount: number }[])[] = [
  buildParcel(4, 2),
  buildParcel(4, 3),
  buildParcel(5, 3),
  buildParcel(5, 4),
  buildParcel(6, 4),
];
/** Non-home build cost by building `kind`; unmapped kinds fall back to {@link DEFAULT_BUILD_COST}. */
const BUILD_COST_BY_KIND: Readonly<Record<string, readonly { goodType: number; amount: number }[]>> = {
  storage: buildParcel(6, 4), // warehouses + the HQ — the largest common bodies
  training: buildParcel(5, 4), // barracks / school halls
  tower: buildParcel(3, 5), // walls / watchtowers — stone-heavy
  workplace: buildParcel(3, 2), // a workshop
};
const DEFAULT_BUILD_COST = buildParcel(3, 2);
/** Per-class max HP (the Health pool the ConstructionSystem ramps 0→max as the site rises). */
const BUILD_HITPOINTS_BY_KIND: Readonly<Record<string, number>> = {
  storage: 100000,
  home: 30000,
  training: 60000,
  tower: 60000,
  workplace: 40000,
};
const DEFAULT_BUILD_HITPOINTS = 40000;

/** The build-material cost for a catalog building: its home-tier parcel for a home, else its class cost. */
export function buildingConstructionCost(b: VikingBuilding): readonly { goodType: number; amount: number }[] {
  if (b.kind === BUILDING_KIND.home) {
    const level = b.typeId - BUILDING_HOME_00;
    const clamped = Math.min(Math.max(level, 0), HOME_BUILD_COST_BY_LEVEL.length - 1);
    return HOME_BUILD_COST_BY_LEVEL[clamped] ?? DEFAULT_BUILD_COST;
  }
  return BUILD_COST_BY_KIND[b.kind] ?? DEFAULT_BUILD_COST;
}
/** The max-HP pool for a catalog building's `kind`. */
export function buildingHitpoints(kind: string): number {
  return BUILD_HITPOINTS_BY_KIND[kind] ?? DEFAULT_BUILD_HITPOINTS;
}

/**
 * The catalog's upgrade chains: which typeIds carry an `upgradeTarget` (always the next typeId — every
 * chained record's `LogicType` table is consecutive). Source basis: the extracted `[GfxHouse]`
 * `upgrade === 1` construction-layer rows in real `ir.json` name exactly these viking typeIds as
 * upgradable. A hand table, NOT a name-suffix derivation: `work_pottery_02` (typeId 22) is really the
 * defence wall, so "same stem, next suffix" would chain the pottery into a wall.
 */
const UPGRADABLE_TYPES: ReadonlySet<number> = new Set([
  BUILDING_HOME_00,
  BUILDING_HOME_01,
  BUILDING_HOME_02,
  BUILDING_HOME_03,
  BUILDING_WAREHOUSE_00,
  BUILDING_WAREHOUSE_01,
  BUILDING_BAKERY,
  BUILDING_TAILOR,
  BUILDING_POTTERY,
  BUILDING_JOINERY,
  BUILDING_JOINERY_01,
  BUILDING_JOINERY_02,
  BUILDING_ARMORY,
  BUILDING_MASON_HUT,
  BUILDING_SMITHY,
  BUILDING_DRUID_HUT,
  BUILDING_WATCHTOWER,
]);

/** The next level a catalog building upgrades into, or undefined for a top level / unchained type. */
export function buildingUpgradeTarget(typeId: number): number | undefined {
  return UPGRADABLE_TYPES.has(typeId) ? typeId + 1 : undefined;
}
