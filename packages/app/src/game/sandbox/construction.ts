import { HOME_KIND, type VikingBuilding } from '../../catalog/buildings.js';
import { BUILDING_HOME_00, GOOD_STONE, GOOD_WOOD } from './ids/index.js';

/**
 * GLOBAL construction data — every building is raised the original way: the player places a foundation
 * (the tool panel enqueues `placeBuilding` `underConstruction`), carriers/builders deliver its materials,
 * and a builder hammers it up (the ConstructionSystem). This is not a per-scene demo: the SAME cost + life
 * pool apply in EVERY scene and on every map. A building with no cost would instead pop up instantly and a
 * `GOOD_NONE` cost would stall (good 0 is undeliverable), so each carries a real, deliverable bill.
 *
 * Named approximation (source basis: our design — the engine's build loop has no oracle, AGENTS.md). The
 * real per-type material bill (`[GfxHouse] LogicConstructionGoods`) and `logichitpoints` ARE extracted, but
 * the bill is keyed by the ORIGINAL game's good ids, not yet unified into the sandbox good space (the
 * deferred global-content id unification). So the COST is approximated in sandbox goods — a wood+stone
 * parcel scaled by building class (a warehouse/hall costs more units → more builder strikes than a hut) —
 * and HITPOINTS is a per-class default. Homes keep their level chain, each tier a parcel up (the cost
 * doubles as the next tier's upgrade bill — {@link import('@open-northland/sim').homeNextTier}).
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
  if (b.kind === HOME_KIND) {
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
