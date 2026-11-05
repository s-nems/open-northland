import { hexDistanceBetween, systems, TICKS_PER_SECOND } from '@open-northland/sim';
import { VIKING } from '../../../catalog/buildings.js';
import { FRANK } from '../../../catalog/civilizations.js';
import { BYZANTINE_SPEAR_VARIANTS } from '../../../catalog/unit-variants.js';
import {
  CLOSED_GATE_LOGIC_ID,
  POST_STRENGTH,
  playerWallRow,
  scaledWallRules,
  WALL_LOGIC_ID,
} from '../../../content/map/palisade-rows.js';
import { buildingHitpoints } from '../base.js';
import {
  CAP_HITS,
  type CombatTarget,
  combatTargets,
  HIT_DIRECTION,
  hitsToKill,
  landed,
  STRENGTH_PCT,
  type TargetId,
  takesStrengthAmulet,
} from '../combat.js';
import type { KnowledgeBase } from '../model.js';
import {
  buildingOf,
  DIAGONAL_STEP_COST,
  diagonal,
  duration,
  type Fact,
  type FactReader,
  type FactValue,
  oneDecimal,
  PERCENT,
  seconds,
  stockOf,
  twoDecimals,
  vehicleOf,
  weaponRow,
  whole,
} from './reader.js';

/** The hits the articles' sample rows stand on. */
const FIGHT_SAMPLE_HITS = [10, 25, 50, 75] as const;

const AIM_SAMPLE_HITS = 50;

const STONE_SAMPLE_HITS = [0, 25, 50] as const;

/** The value the fight-experience table shows a blow of. */
const SAMPLE_BLOW = 1000;

/** `read` times `pct` percent, rounded down as a blow's percent is. */
const scaledDown =
  (read: FactReader, pct: number) =>
  (base: KnowledgeBase): FactValue => {
    const value = read(base);
    return value === undefined ? undefined : Math.floor((value * pct) / PERCENT);
  };

function targetOf(base: KnowledgeBase, id: TargetId): CombatTarget | undefined {
  return combatTargets(base).find((target) => target.id === id);
}

function hitOf(base: KnowledgeBase, tribe: number, id: string, targetId: TargetId): FactValue {
  const weapon = weaponRow(base, tribe, id);
  const target = targetOf(base, targetId);
  return weapon === undefined || target === undefined ? undefined : landed(weapon, target);
}

const clipOfWeapon = (base: KnowledgeBase, tribe: number, id: string): FactValue => {
  const ticks = weaponRow(base, tribe, id)?.clipTicks;
  return ticks === undefined || ticks === null ? undefined : seconds(ticks);
};

/** A ranged weapon's standoff, the band's far edge a chaser closes to. */
function standoffOf(base: KnowledgeBase, tribe: number, id: string): FactValue {
  const weapon = weaponRow(base, tribe, id);
  return weapon === undefined ? undefined : systems.rangedStandoff(weapon.minRange, weapon.maxRange);
}

export const WEAPON_FACTS: Readonly<Record<string, Fact>> = Object.fromEntries(
  (
    [
      ['hunterBow', 'hunter_bow'],
      ['catapult', 'catapult'],
      ['shortBow', 'short_bow'],
      ['longBow', 'long_bow'],
      ['heroBow', 'hero_bow'],
    ] as const
  ).flatMap(([name, id]) => [
    [`${name}.min`, whole((base) => weaponRow(base, VIKING, id)?.minRange)],
    [`${name}.max`, whole((base) => weaponRow(base, VIKING, id)?.maxRange)],
  ]),
);

const towerMax = (id: string): Fact =>
  whole((base) => {
    const max = weaponRow(base, VIKING, id)?.maxRange;
    return max === undefined ? undefined : max + systems.TOWER_RANGE_BONUS_NODES;
  });

const standoff = (id: string): Fact => whole((base) => standoffOf(base, VIKING, id));

const hit = (tribe: number, id: string, target: TargetId): Fact =>
  whole((base) => hitOf(base, tribe, id, target));

const killedBy = (damage: FactReader, hitpoints: FactReader) =>
  whole((base) => {
    const blow = damage(base);
    const pool = hitpoints(base);
    return blow === undefined || pool === undefined ? undefined : (hitsToKill(blow, pool) ?? undefined);
  });

const catapultHp: FactReader = (base) => vehicleOf(base, 'catapult')?.hitpoints;

const catapultStone =
  (target: TargetId): FactReader =>
  (base) =>
    hitOf(base, VIKING, 'catapult', target);

function stoneSeconds(base: KnowledgeBase, hitpoints: FactValue): FactValue {
  const blow = catapultStone('building')(base);
  const clip = clipOfWeapon(base, VIKING, 'catapult');
  if (blow === undefined || clip === undefined || hitpoints === undefined) return undefined;
  const hits = hitsToKill(blow, hitpoints);
  return hits === null ? undefined : hits * clip;
}

const buildingHp = (base: KnowledgeBase, id: string, tribe: number = VIKING): FactValue => {
  const row = buildingOf(base, id);
  return row === undefined ? undefined : (buildingHitpoints(row, tribe) ?? undefined);
};

export const FIGHT_FACTS: Readonly<Record<string, Fact>> = Object.fromEntries(
  FIGHT_SAMPLE_HITS.flatMap((hits) => {
    const blow = systems.withFightExperience(SAMPLE_BLOW, hits);
    return [
      [`fight.factor.${hits}`, twoDecimals(blow / SAMPLE_BLOW)],
      [`fight.blow.${hits}`, whole(blow)],
    ];
  }),
);

const shotsPerSeat = TICKS_PER_SECOND / systems.SHELTER_SHOT_PERIOD_TICKS;

const shelterShots = (base: KnowledgeBase, id: string): FactValue => {
  const seats = buildingOf(base, id)?.shelterCapacity;
  return seats === undefined ? undefined : seats * shotsPerSeat;
};

/** The farthest a stray shot of `hits` strikes from its mark over `range` nodes: the highest roll's spread
 *  on both axes at once, in hexes. */
function strayReach(range: number, hits: number): number {
  const side = systems.widestScatterOffset(systems.widestMarksmanSpread(range, hits));
  return hexDistanceBetween(0, 0, side, side);
}

const longestBowShot = (base: KnowledgeBase): FactValue => {
  const max = weaponRow(base, VIKING, 'long_bow')?.maxRange;
  return max === undefined ? undefined : max + systems.TOWER_RANGE_BONUS_NODES;
};

const strayFact = (range: FactReader, hits: number): Fact =>
  whole((base) => {
    const reach = range(base);
    return reach === undefined ? undefined : strayReach(reach, hits);
  });

const weaponMax =
  (id: string): FactReader =>
  (base) =>
    weaponRow(base, VIKING, id)?.maxRange;

/** The fewest bow hits past which no shot strays, whatever a bow's range. */
const steadyHits: FactReader = (base) => {
  const range = longestBowShot(base);
  if (range === undefined) return undefined;
  let hits = 0;
  while (strayReach(range, hits) > 0) hits++;
  return hits;
};

export const AIM_FACTS: Readonly<Record<string, Fact>> = {
  'aim.spreadShort': strayFact(weaponMax('short_bow'), 0),
  'aim.spreadLong': strayFact(weaponMax('long_bow'), 0),
  'aim.spreadTower': strayFact(longestBowShot, 0),
  'aim.noSpreadHits': whole(steadyHits),
  ...Object.fromEntries(
    STONE_SAMPLE_HITS.map((hits) => [`stone.spread.${hits}`, strayFact(weaponMax('catapult'), hits)]),
  ),
};

const wallRules = (base: KnowledgeBase, id: string, scale: number) => {
  const row = base.content.landscape.find((type) => type.id === id);
  const wall = row === undefined ? undefined : playerWallRow(row);
  return wall === undefined ? undefined : scaledWallRules(wall, scale);
};

const segmentRules = (base: KnowledgeBase) => wallRules(base, WALL_LOGIC_ID, POST_STRENGTH);

const gateRules = (base: KnowledgeBase) =>
  wallRules(base, CLOSED_GATE_LOGIC_ID, systems.GATE_SPAN_OFFSETS.length);

/** What one blow of a weapon takes off a wall, by the name the walls' table reads it under. */
const WALL_WEAPONS = [
  ['catapult', VIKING, 'catapult'],
  ['hero', VIKING, 'hero_sword'],
  ['ironSpear', VIKING, 'iron_spear'],
  ['longSword', VIKING, 'long_sword'],
  ['shortSword', VIKING, 'short_sword'],
  ['woodenSpear', VIKING, 'wooden_spear'],
  ['shortBow', VIKING, 'short_bow'],
  ['longBow', VIKING, 'long_bow'],
] as const;

const wallBlow = (base: KnowledgeBase, tribe: number, id: string): FactValue => {
  const blow = hitOf(base, tribe, id, 'building');
  return blow === undefined ? undefined : Math.floor(blow / systems.HOUSE_DAMAGE_PER_WALL_VALENCY);
};

/** A blow under the Amulet of Strength; a shot no amulet raises keeps its plain blow. */
const strongWallBlow = (tribe: number, id: string): Fact => {
  const blow: FactReader = (base) => wallBlow(base, tribe, id);
  return whole(takesStrengthAmulet({ id }) ? scaledDown(blow, STRENGTH_PCT) : blow);
};

export const WALL_FACTS: Readonly<Record<string, Fact>> = {
  'wall.segmentHp': whole((base) => segmentRules(base)?.maxHitpoints),
  'wall.gateHp': whole((base) => gateRules(base)?.maxHitpoints),
  'wall.segmentRepair': whole((base) => segmentRules(base)?.repairPerStrike),
  'wall.gateRepair': whole((base) => gateRules(base)?.repairPerStrike),
  'wall.gateSegments': whole(systems.GATE_SPAN_OFFSETS.length),
  'wall.gateMinHealthPct': whole(systems.GATE_MIN_HEALTH_PCT),
  'wall.heroBow.blow': whole((base) => wallBlow(base, VIKING, 'hero_bow')),
  'wall.frankHeroBow.blow': whole((base) => wallBlow(base, FRANK, 'hero_bow')),
  ...Object.fromEntries(
    WALL_WEAPONS.flatMap(([name, tribe, id]) => {
      const blow: FactReader = (base) => wallBlow(base, tribe, id);
      const pool =
        (rules: typeof segmentRules): FactReader =>
        (base) =>
          rules(base)?.maxHitpoints;
      return [
        [`wall.${name}.blow`, whole(blow)],
        // A Catapult cannot take an Amulet of Strength, so its stones have no strong blow.
        ...(name === 'catapult' ? [] : [[`wall.${name}.strongBlow`, strongWallBlow(tribe, id)] as const]),
        [`wall.${name}.segmentHits`, killedBy(blow, pool(segmentRules))],
        [`wall.${name}.gateHits`, killedBy(blow, pool(gateRules))],
        [
          `wall.${name}.segmentSeconds`,
          duration((base) => {
            const blows = blow(base);
            const hitpoints = pool(segmentRules)(base);
            const clip = clipOfWeapon(base, tribe, id);
            if (blows === undefined || hitpoints === undefined || clip === undefined) return undefined;
            const hits = hitsToKill(blows, hitpoints);
            return hits === null ? undefined : hits * clip;
          }),
        ],
      ];
    }),
  ),
};

export const COMBAT_FACTS: Readonly<Record<string, Fact>> = {
  'shortBow.towerMax': towerMax('short_bow'),
  'longBow.towerMax': towerMax('long_bow'),
  'shortBow.standoff': standoff('short_bow'),
  'longBow.standoff': standoff('long_bow'),
  'heroBow.standoff': standoff('hero_bow'),
  'combat.fightCapHits': whole(CAP_HITS),
  'combat.fightCapFactor': whole(systems.withFightExperience(SAMPLE_BLOW, CAP_HITS) / SAMPLE_BLOW),
  'combat.fightCapBlow': whole(systems.withFightExperience(SAMPLE_BLOW, CAP_HITS)),
  'combat.sampleBlow': whole(SAMPLE_BLOW),
  'combat.backSideFactor': twoDecimals(HIT_DIRECTION.backSide / PERCENT),
  'combat.behindFactor': twoDecimals(HIT_DIRECTION.behind / PERCENT),
  'aim.basePct': whole(systems.trueShotPct(0)),
  'aim.samplePct': whole(systems.trueShotPct(AIM_SAMPLE_HITS)),
  'stance.search': whole(systems.DEFEND_RADIUS_NODES),
  'stance.defendLeash': whole(systems.DEFEND_LEASH_NODES),
  'stance.ignoreLeash': whole(systems.IGNORE_LEASH_NODES),
  'stance.attackReturn': whole(systems.ATTACK_RETURN_SLACK_NODES),
  'stance.soldierAlarm': whole(systems.ALARM_SOLDIER_RADIUS_NODES),
  'stance.peopleAlarm': whole(systems.ALARM_PEOPLE_RADIUS_NODES),
  'stance.fleeMin': whole(systems.FLEE_STEP_NODES),
  'stance.fleeMax': whole(systems.FLEE_STEP_NODES * DIAGONAL_STEP_COST),
  'contest.radius': whole(systems.CONTESTED_GROUND_RADIUS_NODES),
  'contest.diagonal': whole(diagonal(systems.CONTESTED_GROUND_RADIUS_NODES)),
  'peace.keepOut': whole(systems.PEACE_KEEP_OUT_RADIUS_NODES),
  'peace.noticeFirstMinutes': whole(systems.PEACE_NOTICE_MINUTES[0]),
  'peace.noticeLastMinutes': whole(systems.PEACE_NOTICE_MINUTES[1]),
  'wall.gateEnemyNear': whole(systems.GATE_ENEMY_NEAR_POINTS),
  'wall.damagePerPoint': whole(systems.HOUSE_DAMAGE_PER_WALL_VALENCY),
  'shelter.hq': whole((base) => buildingOf(base, 'headquarters')?.shelterCapacity),
  'shelter.tower2': whole((base) => buildingOf(base, 'tower_01')?.shelterCapacity),
  'shelter.tower1': whole((base) => buildingOf(base, 'tower_00')?.shelterCapacity),
  'shelter.barracks': whole((base) => buildingOf(base, 'barracks')?.shelterCapacity),
  'shelter.shotsPerSeat': oneDecimal(shotsPerSeat),
  'shelter.hqShots': whole((base) => shelterShots(base, 'headquarters')),
  'shelter.tower2Shots': whole((base) => shelterShots(base, 'tower_01')),
  'shelter.tower1Shots': whole((base) => shelterShots(base, 'tower_00')),
  'shelter.barracksShots': whole((base) => shelterShots(base, 'barracks')),
  'shelter.range': whole((base) => weaponRow(base, VIKING, 'house_bow')?.maxRange),
  'arrow.vehicle': hit(VIKING, 'house_bow', 'vehicle'),
  'tower1.mead': whole((base) => stockOf(base, 'tower_00', 'mead')),
  'tower1.food': whole((base) => stockOf(base, 'tower_00', 'food_simple')),
  'tower1.weapon': whole((base) => stockOf(base, 'tower_00', 'bow_short')),
  'tower2.mead': whole((base) => stockOf(base, 'tower_01', 'mead')),
  'tower2.food': whole((base) => stockOf(base, 'tower_01', 'food_simple')),
  'tower2.weapon': whole((base) => stockOf(base, 'tower_01', 'bow_short')),
  'dragon.hitpoints': whole(BYZANTINE_SPEAR_VARIANTS.find((row) => row.form === 'native')?.hitpoints ?? 0),
  'catapult.searchRadius': whole(systems.VEHICLE_SCAN_RADIUS_POINTS),
  'catapult.leash': whole(systems.VEHICLE_DEFENCE_LEASH_POINTS),
  'catapult.bandMin': whole((base) => {
    const max = weaponRow(base, VIKING, 'catapult')?.maxRange;
    return max === undefined ? undefined : max - systems.APPROACH_BAND_DEPTH;
  }),
  'stone.vehicle': whole(catapultStone('vehicle')),
  'stone.vehicleKills': killedBy(catapultStone('vehicle'), catapultHp),
  'stone.tower1': killedBy(catapultStone('building'), (base) => buildingHp(base, 'tower_00')),
  'stone.tower2': killedBy(catapultStone('building'), (base) => buildingHp(base, 'tower_01')),
  'stone.hq': killedBy(catapultStone('building'), (base) => buildingHp(base, 'headquarters')),
  'stone.frankHq': killedBy(catapultStone('building'), (base) => buildingHp(base, 'headquarters', FRANK)),
  'stone.tower1Seconds': duration((base) => stoneSeconds(base, buildingHp(base, 'tower_00'))),
  'stone.tower2Seconds': duration((base) => stoneSeconds(base, buildingHp(base, 'tower_01'))),
  'stone.hqSeconds': duration((base) => stoneSeconds(base, buildingHp(base, 'headquarters'))),
  'stone.frankHqSeconds': duration((base) => stoneSeconds(base, buildingHp(base, 'headquarters', FRANK))),
  'hp.tower1': whole((base) => buildingHp(base, 'tower_00')),
  'hp.tower2': whole((base) => buildingHp(base, 'tower_01')),
  'hp.hq': whole((base) => buildingHp(base, 'headquarters')),
  'hp.frankHq': whole((base) => buildingHp(base, 'headquarters', FRANK)),
  'vs.catapult.spear': hit(VIKING, 'iron_spear', 'vehicle'),
  'vs.catapult.spearHits': killedBy((base) => hitOf(base, VIKING, 'iron_spear', 'vehicle'), catapultHp),
  'vs.catapult.shortSword': hit(VIKING, 'short_sword', 'vehicle'),
  'vs.catapult.shortSwordHits': killedBy((base) => hitOf(base, VIKING, 'short_sword', 'vehicle'), catapultHp),
  'vs.catapult.fist': hit(VIKING, 'fist', 'vehicle'),
  'vs.catapult.fistHits': killedBy((base) => hitOf(base, VIKING, 'fist', 'vehicle'), catapultHp),
  'vs.catapult.arrowHits': killedBy((base) => hitOf(base, VIKING, 'house_bow', 'vehicle'), catapultHp),
};
