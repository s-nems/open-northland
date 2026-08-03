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
 * A named approximation. The real bill (`[GfxHouse] LogicConstructionGoods`) and `logichitpoints` are
 * extracted but keyed by the original good ids, which are not yet unified into the sandbox good space,
 * so the cost is approximated as a wood and stone parcel scaled by building class. Every building needs
 * a real deliverable bill: no cost pops the building up instantly, and a `GOOD_NONE` cost stalls it.
 */
function buildParcel(wood: number, stone: number): readonly { goodType: number; amount: number }[] {
  return [
    { goodType: GOOD_WOOD, amount: wood },
    { goodType: GOOD_STONE, amount: stone },
  ];
}
/** Indexed by home tier, `home_level_00..04`. */
const HOME_BUILD_COST_BY_LEVEL: readonly (readonly { goodType: number; amount: number }[])[] = [
  buildParcel(4, 2),
  buildParcel(4, 3),
  buildParcel(5, 3),
  buildParcel(5, 4),
  buildParcel(6, 4),
];
const BUILD_COST_BY_KIND: Readonly<Record<string, readonly { goodType: number; amount: number }[]>> = {
  storage: buildParcel(6, 4),
  training: buildParcel(5, 4),
  tower: buildParcel(3, 5), // stone-heavy
  workplace: buildParcel(3, 2),
};
const DEFAULT_BUILD_COST = buildParcel(3, 2);
/** The pool the ConstructionSystem ramps from 0 as the site rises. */
const BUILD_HITPOINTS_BY_KIND: Readonly<Record<string, number>> = {
  storage: 100000,
  home: 30000,
  training: 60000,
  tower: 60000,
  workplace: 40000,
};
const DEFAULT_BUILD_HITPOINTS = 40000;

export function buildingConstructionCost(b: VikingBuilding): readonly { goodType: number; amount: number }[] {
  if (b.kind === BUILDING_KIND.home) {
    const level = b.typeId - BUILDING_HOME_00;
    const clamped = Math.min(Math.max(level, 0), HOME_BUILD_COST_BY_LEVEL.length - 1);
    return HOME_BUILD_COST_BY_LEVEL[clamped] ?? DEFAULT_BUILD_COST;
  }
  return BUILD_COST_BY_KIND[b.kind] ?? DEFAULT_BUILD_COST;
}
export function buildingHitpoints(kind: string): number {
  return BUILD_HITPOINTS_BY_KIND[kind] ?? DEFAULT_BUILD_HITPOINTS;
}

/**
 * The upgrade target is always the next typeId, because every chained record's `LogicType` table is
 * consecutive. Source basis: the extracted `[GfxHouse]` `upgrade === 1` rows name exactly these
 * typeIds. A hand table rather than a name-suffix derivation, because `work_pottery_02` is really the
 * defence wall and would otherwise chain the pottery into a wall.
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

export function buildingUpgradeTarget(typeId: number): number | undefined {
  return UPGRADABLE_TYPES.has(typeId) ? typeId + 1 : undefined;
}
