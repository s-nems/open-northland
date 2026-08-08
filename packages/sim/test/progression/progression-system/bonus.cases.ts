import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Felling, Position, Resource, Settler } from '../../../src/components/index.js';
import { ZERO } from '../../../src/core/fixed.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import {
  atomicSystem,
  EXPERIENCE_MASTERY_REPEATS,
  experienceBonus,
  experienceRepeats,
  FIGHT_DAMAGE_BONUS_MAX,
  FIGHT_EXPERIENCE_TYPE,
  FIGHT_MASTERY_HITS,
  fightDamageBonus,
  operatorProductionBonus,
  SCOUT_VISION_BONUS_MAX_NODES,
  scaledWorkRepeats,
  scoutVisionBonusNodes,
  WEAPON_MAIN_TYPE,
  withFightDamageBonus,
} from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { settlerAt } from '../../fixtures/settler.js';
import { grassCellMap as grassMap } from '../../fixtures/terrain.js';
import { CARRIER, CARRIER_TRACK, WOOD, WOOD_TRACK, WOODCUTTER } from './support.js';

describe('experienceBonus - the repeats → bonus curve', () => {
  it('matches the reference table within 2 points at repeats 1..11', () => {
    // The user-specified reference bonus percentages the K = 4.9 fit targets.
    const reference = [17, 29, 38, 45, 51, 56, 60, 63, 66, 68, 70];
    for (const [i, expected] of reference.entries()) {
      const got = fx.toFloat(experienceBonus(i + 1)) * 100;
      expect(Math.abs(got - expected)).toBeLessThanOrEqual(2);
    }
  });

  it('clamps to 0% below one repeat and to exactly 100% at mastery and beyond', () => {
    expect(experienceBonus(0)).toBe(ZERO);
    expect(experienceBonus(-3)).toBe(ZERO);
    expect(experienceBonus(EXPERIENCE_MASTERY_REPEATS)).toBe(ONE);
    expect(experienceBonus(EXPERIENCE_MASTERY_REPEATS + 500)).toBe(ONE);
  });

  it('is monotonically increasing from 0 to mastery', () => {
    for (let n = 1; n <= EXPERIENCE_MASTERY_REPEATS; n++) {
      expect(experienceBonus(n)).toBeGreaterThan(experienceBonus(n - 1));
    }
  });

  it('truncates fractional repeats (integer domain)', () => {
    expect(experienceBonus(5.9)).toBe(experienceBonus(5));
  });
});

describe('scoutVisionBonusNodes - signpost craft widens the scout eye a little', () => {
  it('scales the curve to whole extra nodes, capped well below a 2x eye', () => {
    expect(scoutVisionBonusNodes(0)).toBe(0);
    expect(scoutVisionBonusNodes(10)).toBe(4); // ~69% of the 6-node cap, truncated
    expect(scoutVisionBonusNodes(100)).toBe(SCOUT_VISION_BONUS_MAX_NODES); // mastery: the full cap
  });
});

describe('scaledWorkRepeats - experience buys fewer repetitions, never faster ones', () => {
  it('leaves the count whole at no bonus and halves it at mastery', () => {
    expect(scaledWorkRepeats(15, ZERO)).toBe(15);
    expect(scaledWorkRepeats(15, ONE)).toBe(8); // 15/2 rounded
    expect(scaledWorkRepeats(4, ONE)).toBe(2);
  });

  it('never scales below one repetition', () => {
    expect(scaledWorkRepeats(1, ONE)).toBe(1);
  });

  it('a mid-curve bonus shrinks proportionally (rounded, not truncated)', () => {
    // bonus(10) ≈ 0.694: 15 / 1.694 ≈ 8.85 → 9 (truncation would give 8).
    expect(scaledWorkRepeats(15, experienceBonus(10))).toBe(9);
  });
});

describe('fightDamageBonus - hits with a weapon class buy extra damage', () => {
  it('is zero untrained and caps at +50% at combat mastery', () => {
    expect(fightDamageBonus(0)).toBe(ZERO);
    expect(fightDamageBonus(FIGHT_MASTERY_HITS)).toBe(FIGHT_DAMAGE_BONUS_MAX);
    expect(fightDamageBonus(FIGHT_MASTERY_HITS * 3)).toBe(FIGHT_DAMAGE_BONUS_MAX);
  });

  it('scales the shared curve onto the deeper 500-hit mastery', () => {
    // 50 hits = 10 curve repeats ≈ 69% of the halved cap ≈ +35%.
    expect(fx.toFloat(fightDamageBonus(50))).toBeCloseTo(0.347, 2);
  });

  it('withFightDamageBonus raises base damage by the truncated bonus fraction', () => {
    const sword = new Map([[FIGHT_EXPERIENCE_TYPE.SWORD, FIGHT_MASTERY_HITS]]);
    expect(withFightDamageBonus(10, sword, WEAPON_MAIN_TYPE.SWORD)).toBe(15);
    expect(withFightDamageBonus(10, sword, WEAPON_MAIN_TYPE.AXE)).toBe(10); // untrained class
    expect(withFightDamageBonus(10, new Map(), WEAPON_MAIN_TYPE.SWORD)).toBe(10); // no hits yet
    expect(withFightDamageBonus(10, sword, undefined)).toBe(10); // a class-less weapon
  });
});

describe('work-credit wiring - an experienced gatherer fells in fewer swings, not faster ones', () => {
  const WOOD_MASTERY_XP = 1000; // 100 repeats at the fixture wood track's factor 10

  /** A woodcutter with `xp` on its wood track, a 3-chop tree, and one completed swing (duration 1). */
  const swingOnce = (xp: number) => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = settlerAt(sim, { jobType: WOODCUTTER, position: { x: fx.fromInt(1), y: fx.fromInt(0) } });
    if (xp > 0) sim.world.mut(e, Settler).experience.set(WOOD_TRACK, xp);
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 4, harvestAtomic: 24 });
    sim.world.add(tree, Felling, { chopsLeft: 3 });
    sim.world.add(e, CurrentAtomic, {
      atomicId: 24,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1,
      effect: { kind: 'harvest', resource: tree, goodType: WOOD },
      targetEntity: tree,
      targetTile: null,
    });
    atomicSystem(sim.world, ctxOf(sim));
    return { sim, settler: e, tree };
  };

  it("a novice's swing lands one chop; a master's swing counts double", () => {
    const novice = swingOnce(0);
    expect(novice.sim.world.get(novice.tree, Felling).chopsLeft).toBe(2);
    const master = swingOnce(WOOD_MASTERY_XP);
    expect(master.sim.world.get(master.tree, Felling).chopsLeft).toBe(1);
    // A whole credit banks no fraction - the novice atomic keeps its historical shape.
    expect(novice.sim.world.get(novice.settler, CurrentAtomic).workCredit).toBeUndefined();
  });

  it('a mid-curve gatherer banks the fraction and cashes it on a later swing', () => {
    // 40 XP = 4 repeats → bonus ≈ 0.46: swings land 1, 1, then 2 chops (0.46 + 0.46 + 0.46 crosses 1).
    const { sim, settler, tree } = swingOnce(40);
    expect(sim.world.get(tree, Felling).chopsLeft).toBe(2);
    expect(sim.world.get(settler, CurrentAtomic).workCredit).toBeDefined();
    const rearm = () => {
      const atomic = sim.world.mut(settler, CurrentAtomic);
      atomic.elapsed = 0;
      atomic.duration = 1;
      delete atomic.restTail; // strip any breather - this drives raw swings only
      atomicSystem(sim.world, ctxOf(sim));
    };
    rearm();
    expect(sim.world.get(tree, Felling).chopsLeft).toBe(1);
    rearm();
    expect(sim.world.has(tree, Felling)).toBe(false); // the banked credit felled it a swing early
  });
});

describe('operatorProductionBonus - the transport trade never boosts output', () => {
  it('a carrier operator with heavy delivery XP still reads ZERO (its XP is display-only)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const carrier = settlerAt(sim, { jobType: CARRIER });
    sim.world.mut(carrier, Settler).experience.set(CARRIER_TRACK, 100_000);
    expect(operatorProductionBonus(sim.world, ctxOf(sim), carrier)).toBe(ZERO);
  });
});

describe('experienceRepeats - raw XP back to completed-work repeats', () => {
  const track = { typeId: 1, id: 't', jobType: 1, experienceFactor: 100 };

  it('divides the accrual rate back out, truncating partial credit', () => {
    expect(experienceRepeats(0, track)).toBe(0);
    expect(experienceRepeats(500, track)).toBe(5);
    expect(experienceRepeats(599, track)).toBe(5);
  });

  it('a rate-0 track represents no repeats', () => {
    expect(experienceRepeats(500, { ...track, experienceFactor: 0 })).toBe(0);
  });
});
