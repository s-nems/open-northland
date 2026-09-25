import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  Equipment,
  type EquipmentSlot,
  Felling,
  MISC_EQUIP_SLOTS,
  Position,
  Resource,
  SettlerProgress,
} from '../../../src/components/index.js';
import { ZERO } from '../../../src/core/fixed.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { BARE_HANDS_WORK_FACTOR_PCT } from '../../../src/systems/equipment/index.js';
import {
  anchorOnlyFootprint,
  atomicSystem,
  EXPERIENCE_MASTERY_POINTS,
  EXPERIENCE_XP_PER_POINT,
  experienceBonus,
  experiencePercent,
  experiencePoints,
  experienceRepeats,
  FIGHT_EXPERIENCE_DAMAGE_CAP_HITS,
  FIGHT_EXPERIENCE_MAX,
  FIGHT_EXPERIENCE_TYPE,
  jobExperiencePercent,
  SCOUT_VISION_BONUS_MAX_NODES,
  scoutVisionBonusNodes,
  stampResourceFootprintData,
  strokesPerUnit,
  WEAPON_MAIN_TYPE,
  weaponClassHits,
  withFightExperience,
} from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { settlerAt } from '../../fixtures/settler.js';
import { settleStrokeCadence } from '../../fixtures/strokes.js';
import { grassCellMap as grassMap } from '../../fixtures/terrain.js';
import {
  CARPENTER,
  CARPENTER_GENERAL_TRACK,
  CARRIER,
  CARRIER_TRACK,
  WOOD,
  WOOD_TRACK,
  WOODCUTTER,
} from './support.js';

describe('experiencePercent - the points → percent curve', () => {
  it('reproduces the bonus table observed on the original at points 1..11 exactly', () => {
    const reference = [17, 29, 38, 45, 51, 56, 60, 63, 66, 68, 70];
    for (const [i, expected] of reference.entries()) expect(experiencePercent(i + 1)).toBe(expected);
  });

  it('reads 0 below one point, 97 at a hundred and exactly 100 from mastery on', () => {
    expect(experiencePercent(0)).toBe(0);
    expect(experiencePercent(-3)).toBe(0);
    expect(experiencePercent(100)).toBe(97);
    expect(experiencePercent(EXPERIENCE_MASTERY_POINTS - 1)).toBe(98);
    expect(experiencePercent(EXPERIENCE_MASTERY_POINTS)).toBe(100);
    expect(experiencePercent(EXPERIENCE_MASTERY_POINTS + 500)).toBe(100);
    expect(experienceBonus(0)).toBe(ZERO);
    expect(experienceBonus(EXPERIENCE_MASTERY_POINTS)).toBe(ONE);
  });

  it('never falls as points grow', () => {
    for (let n = 1; n <= EXPERIENCE_MASTERY_POINTS; n++) {
      expect(experiencePercent(n)).toBeGreaterThanOrEqual(experiencePercent(n - 1));
    }
  });

  it('truncates fractional points (integer domain)', () => {
    expect(experiencePercent(5.9)).toBe(experiencePercent(5));
  });
});

describe('experiencePoints - raw XP in hundredths, whatever the track', () => {
  it('reads one point per hundred raw XP, truncating the rest', () => {
    expect(experiencePoints(0)).toBe(0);
    expect(experiencePoints(99)).toBe(0);
    expect(experiencePoints(100)).toBe(1);
    expect(experiencePoints(250)).toBe(2);
    expect(experiencePoints(-5)).toBe(0);
  });
});

describe('scoutVisionBonusNodes - signpost craft widens the scout eye a little', () => {
  it('scales the curve to whole extra nodes, capped well below a 2x eye', () => {
    expect(scoutVisionBonusNodes(0)).toBe(0);
    expect(scoutVisionBonusNodes(10)).toBe(4); // 68% of the 6-node cap, truncated
    expect(scoutVisionBonusNodes(100)).toBe(5); // 97%: still a node short
    expect(scoutVisionBonusNodes(EXPERIENCE_MASTERY_POINTS)).toBe(SCOUT_VISION_BONUS_MAX_NODES);
  });
});

describe('withFightExperience - hits with a weapon class raise its damage', () => {
  it('scales a column by 200 / (200 - min(hits, 100)) in integer division', () => {
    expect(withFightExperience(3800, 0)).toBe(3800);
    expect(withFightExperience(3800, 50)).toBe(5066); // 760000 / 150, truncated
    expect(withFightExperience(3800, FIGHT_EXPERIENCE_DAMAGE_CAP_HITS)).toBe(7600);
    expect(withFightExperience(3800, FIGHT_EXPERIENCE_MAX)).toBe(7600); // raw points past 100 buy nothing
    expect(withFightExperience(0, FIGHT_EXPERIENCE_DAMAGE_CAP_HITS)).toBe(0); // a missing column stays 0
  });

  it('weaponClassHits reads the bucket of the swinging weapon class', () => {
    const sword = new Map([[FIGHT_EXPERIENCE_TYPE.SWORD, 40]]);
    expect(weaponClassHits(sword, WEAPON_MAIN_TYPE.SWORD)).toBe(40);
    expect(weaponClassHits(sword, WEAPON_MAIN_TYPE.SPEAR)).toBe(0); // untrained class
    expect(weaponClassHits(sword, null)).toBe(0); // a class-less weapon
  });
});

describe('jobExperiencePercent - product-specific track with a general fallback', () => {
  it('uses general trade experience for a product without its own specialization', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const carpenter = settlerAt(sim, { jobType: CARPENTER });
    sim.world.mut(carpenter, SettlerProgress).experience.set(CARPENTER_GENERAL_TRACK, 500);
    expect(jobExperiencePercent(sim.world, ctxOf(sim), carpenter, WOOD)).toBe(experiencePercent(5));
  });

  it('reads the general track for a good-less work', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const carpenter = settlerAt(sim, { jobType: CARPENTER });
    sim.world.mut(carpenter, SettlerProgress).experience.set(CARPENTER_GENERAL_TRACK, 500);
    expect(jobExperiencePercent(sim.world, ctxOf(sim), carpenter, null)).toBe(experiencePercent(5));
  });

  it('uses one specialization for every product variant listed on its track', () => {
    const base = testContent();
    const sharedTrack = base.jobExperience.find((track) => track.typeId === 4);
    if (sharedTrack === undefined) throw new Error('fixture lacks its carpenter product track');
    const content = {
      ...base,
      jobExperience: base.jobExperience.map((track) =>
        track.typeId === sharedTrack.typeId ? { ...track, goodTypes: [...track.goodTypes, WOOD] } : track,
      ),
    };
    const sim = new Simulation({ seed: 1, content });
    const carpenter = settlerAt(sim, { jobType: CARPENTER });
    // The curve reads raw XP in hundredths whatever the track's factor: 500 raw XP is 5 points here too.
    sim.world.mut(carpenter, SettlerProgress).experience.set(sharedTrack.typeId, 500);
    expect(jobExperiencePercent(sim.world, ctxOf(sim), carpenter, WOOD)).toBe(experiencePercent(5));
  });

  it('a carrier with heavy delivery XP still reads 0 (its XP is display-only)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const carrier = settlerAt(sim, { jobType: CARRIER });
    sim.world.mut(carrier, SettlerProgress).experience.set(CARRIER_TRACK, 100_000);
    expect(jobExperiencePercent(sim.world, ctxOf(sim), carrier, WOOD)).toBe(0);
  });
});

describe('experienceRepeats - raw XP back to completed-work repeats', () => {
  const track = {
    typeId: 1,
    id: 't',
    jobType: 1,
    goodTypes: [],
    experienceFactor: 100,
    baseRepeatCounter: 10,
  };

  it('divides the accrual rate back out, truncating partial credit', () => {
    expect(experienceRepeats(0, track)).toBe(0);
    expect(experienceRepeats(500, track)).toBe(5);
    expect(experienceRepeats(599, track)).toBe(5);
  });

  it('a rate-0 track represents no repeats', () => {
    expect(experienceRepeats(500, { ...track, experienceFactor: 0 })).toBe(0);
  });
});

describe("strokes rule wiring - experience and a tool cut a gatherer's strokes per unit", () => {
  const MASTERY_XP = EXPERIENCE_MASTERY_POINTS * EXPERIENCE_XP_PER_POINT;
  const MASTERY_PCT = 100;
  const TOOL_IRON = 12; // fixture `tool_iron`
  const IRON_WORK_FACTOR_PCT = 175; // its `workFactorPct`
  const HARVEST_WOOD = 24; // the woodcutter's stroke-counted chop clip
  const STROKE_GUARD = 100;
  const trackStrokes = () =>
    testContent().jobExperience.find((t) => t.typeId === WOOD_TRACK)?.baseRepeatCounter ?? 0;

  /** Counted strokes a woodcutter with `xp` on its wood track (and an optional tool) lands before the
   *  fixture tree falls. */
  const fell = (xp: number, tool?: number) => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = settlerAt(sim, { jobType: WOODCUTTER, position: { x: fx.fromInt(1), y: fx.fromInt(0) } });
    if (xp > 0) sim.world.mut(e, SettlerProgress).experience.set(WOOD_TRACK, xp);
    if (tool !== undefined) {
      sim.world.add(e, Equipment, {
        boots: null,
        tool: { goodType: tool, degreeOfUse: fx.fromInt(0) },
        weapon: null,
        armor: null,
        misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
      });
    }
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 4, harvestAtomic: HARVEST_WOOD });
    stampResourceFootprintData(sim.world, tree, anchorOnlyFootprint());
    sim.world.add(tree, Felling, { chops: 0 });
    // Each counted stroke starts its own atomic; the executor's cadence (follow-through, rest) runs out
    // between them and counts nothing.
    let strokes = 0;
    while (sim.world.has(tree, Felling) && strokes < STROKE_GUARD) {
      addCurrentAtomic(sim.world, e, {
        atomicId: HARVEST_WOOD,
        duration: 1,
        effect: { kind: 'harvest', resource: tree, goodType: WOOD },
        targetEntity: tree,
        targetTile: null,
      });
      atomicSystem(sim.world, ctxOf(sim));
      strokes += 1;
      settleStrokeCadence(sim, e);
    }
    const wear = sim.world.tryGet(e, Equipment)?.tool?.degreeOfUse ?? 0;
    return { strokes, wear };
  };

  it('a novice needs the track count, a master fewer, a master with an iron tool one', () => {
    const base = trackStrokes();
    expect(strokesPerUnit(base, 0, BARE_HANDS_WORK_FACTOR_PCT)).toBe(base);
    expect(strokesPerUnit(base, MASTERY_PCT, BARE_HANDS_WORK_FACTOR_PCT)).toBeLessThan(base);
    expect(strokesPerUnit(base, MASTERY_PCT, IRON_WORK_FACTOR_PCT)).toBe(1);
  });

  it('the executor fells in exactly those counts', () => {
    const base = trackStrokes();
    expect(fell(0).strokes).toBe(base);
    expect(fell(MASTERY_XP).strokes).toBe(strokesPerUnit(base, MASTERY_PCT, BARE_HANDS_WORK_FACTOR_PCT));
    expect(fell(0, TOOL_IRON).strokes).toBe(strokesPerUnit(base, 0, IRON_WORK_FACTOR_PCT));
    expect(fell(MASTERY_XP, TOOL_IRON).strokes).toBe(1);
  });

  it('every counted stroke wears the tool, the ones that fell nothing included; the cadence wears none', () => {
    const single = fell(MASTERY_XP, TOOL_IRON);
    const novice = fell(0, TOOL_IRON);
    expect(single.wear).toBeGreaterThan(0);
    expect(novice.wear).toBe(single.wear * novice.strokes);
  });
});
