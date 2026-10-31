import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  ComputerStrategy,
  MILITARY_PLANS,
  type MilitaryStrategyState,
} from '../../../../src/components/index.js';
import { Simulation } from '../../../../src/index.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../../../../src/systems/ai-shared/cadence.js';
import {
  DEFENSIVE_SEA_ARMY_MEN,
  ordersFor,
  POSTURE_REVIEW_EVERY_DECISIONS,
  POSTURE_SWITCH_REVIEWS,
  type PostureInputs,
  PREPARE_LEAD_TICKS,
  reviewMilitary,
  selectPosture,
} from '../../../../src/systems/computer-player/index.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';
import { makeAiSeat, placeHq, SEAT } from '../support.js';

const TARGET = 1;
/** The target owner's believed points the ratio cases weigh against. */
const ENEMY_POINTS = 100;

/** A seat with an army of `own` points, a target owner of {@link ENEMY_POINTS}, and nothing else. */
function inputs(own: number, overrides: Partial<PostureInputs> = {}): PostureInputs {
  return {
    ownPoints: own,
    ownMen: 0,
    targetOwner: TARGET,
    targetOverSea: false,
    targetPoints: ENEMY_POINTS,
    strongestPoints: ENEMY_POINTS,
    threatInTicks: null,
    underAttack: false,
    raidTargetKnown: false,
    holdAimed: false,
    ...overrides,
  };
}

function held(posture: MilitaryStrategyState['posture']): MilitaryStrategyState {
  return {
    ...selectPosture('balanced', inputs(ENEMY_POINTS), null),
    posture,
    plan: 'balanced',
    decidedAt: 0,
    challenger: null,
  };
}

describe('military plan', () => {
  it('is drawn once at the first strategy step and kept through every review and a save', () => {
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(64, 32) });
    makeAiSeat(sim, SEAT);
    placeHq(sim);
    sim.step();
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no carrier');
    const first = sim.world.tryGet(carrier, ComputerStrategy)?.military;
    expect(MILITARY_PLANS).toContain(first?.plan);
    // Another plan than the draw, so a redraw would show.
    const other = MILITARY_PLANS.find((plan) => plan !== first?.plan) ?? 'balanced';
    sim.world.mut(carrier, ComputerStrategy).military.plan = other;
    for (let i = 0; i < 2 * POSTURE_REVIEW_EVERY_DECISIONS * COMPUTER_DECISION_INTERVAL_TICKS; i++)
      sim.step();
    expect(sim.world.tryGet(carrier, ComputerStrategy)?.military.plan).toBe(other);
  });
});

describe('military posture', () => {
  it('prepares inside the lead time of a forecast attack and not outside it', () => {
    const strong = 2 * ENEMY_POINTS;
    const inside = selectPosture('balanced', inputs(strong, { threatInTicks: PREPARE_LEAD_TICKS }), null);
    expect(inside.posture).toBe('prepare');
    expect(inside.evidence).toContain('forecastThreat');
    const outside = selectPosture(
      'balanced',
      inputs(strong, { threatInTicks: PREPARE_LEAD_TICKS + 1 }),
      null,
    );
    expect(outside.posture).toBe('attack');
    expect(outside.evidence).not.toContain('forecastThreat');
    // A stronger enemy far off does not hide the forecast; a raid on the settlement does.
    const weak = { threatInTicks: 0, strongestPoints: 2 * strong };
    expect(selectPosture('balanced', inputs(strong, weak), null).posture).toBe('prepare');
    expect(selectPosture('balanced', inputs(strong, { ...weak, underAttack: true }), null).posture).toBe(
      'defend',
    );
  });

  it('defends under a raid and against a clearly stronger enemy', () => {
    expect(selectPosture('aggressive', inputs(2 * ENEMY_POINTS, { underAttack: true }), null).posture).toBe(
      'defend',
    );
    expect(selectPosture('aggressive', inputs(ENEMY_POINTS / 2), null).posture).toBe('defend');
  });

  it('sends no wave and holds the army home while it defends or prepares', () => {
    for (const plan of MILITARY_PLANS) {
      for (const posture of ['defend', 'prepare'] as const) {
        expect(ordersFor(plan, posture)).toEqual(
          expect.objectContaining({ launchRatio: null, holdHome: true }),
        );
      }
    }
  });

  it('lets a flank-raiding seat raid in every posture but defence and a forecast attack', () => {
    for (const plan of MILITARY_PLANS) {
      expect(ordersFor(plan, 'attack', [], true)).toEqual(
        expect.objectContaining({ raidsAllowed: true, flankRaids: true }),
      );
      expect(ordersFor(plan, 'prepare', ['buildingUp'], true).raidsAllowed).toBe(true);
      expect(ordersFor(plan, 'prepare', ['forecastThreat'], true).raidsAllowed).toBe(false);
      expect(ordersFor(plan, 'defend', ['underAttack'], true).raidsAllowed).toBe(false);
      expect(ordersFor(plan, 'defend', ['outmatched'], true).raidsAllowed).toBe(false);
      expect(ordersFor(plan, 'harass', [], true)).toEqual(
        expect.objectContaining({ raidsAllowed: true, flankRaids: false }),
      );
      expect(ordersFor(plan, 'attack').raidsAllowed).toBe(false);
    }
  });

  it('keeps a flank raid already out striking through a forecast attack, not through defence', () => {
    for (const plan of MILITARY_PLANS) {
      expect(ordersFor(plan, 'prepare', ['forecastThreat'], true).raidsRecalled).toBe(false);
      expect(ordersFor(plan, 'defend', ['underAttack'], true).raidsRecalled).toBe(true);
      expect(ordersFor(plan, 'prepare', ['forecastThreat']).raidsRecalled).toBe(true);
      expect(ordersFor(plan, 'harass').raidsRecalled).toBe(false);
    }
  });

  it('holds an area while it builds up or attacks, never against a stronger enemy or a forecast attack', () => {
    for (const plan of MILITARY_PLANS) {
      expect(ordersFor(plan, 'defend', ['outmatched']).hold).toBeNull();
      expect(ordersFor(plan, 'prepare', ['forecastThreat']).hold).toBeNull();
      expect(ordersFor(plan, 'prepare', ['buildingUp']).hold).not.toBeNull();
      expect(ordersFor(plan, 'attack').hold).not.toBeNull();
      // A raid on the settlement leaves a hold already out there in the area.
      expect(ordersFor(plan, 'defend', ['underAttack']).hold).not.toBeNull();
    }
    expect(ordersFor('defensive', 'harass').hold).toBeNull();
    const share = (plan: 'aggressive' | 'defensive') => {
      const tuning = ordersFor(plan, 'attack').hold;
      return tuning === null ? 0 : tuning.spareShare.num / tuning.spareShare.den;
    };
    expect(share('aggressive')).toBeGreaterThan(share('defensive'));
  });

  it('attacks at a lower edge for an aggressive plan than for a defensive one', () => {
    const posture = (plan: 'aggressive' | 'balanced' | 'defensive', own: number) =>
      selectPosture(plan, inputs(own), null).posture;
    const shortOfParity = ENEMY_POINTS - ENEMY_POINTS / 10;
    expect(posture('aggressive', shortOfParity)).toBe('attack');
    expect(posture('balanced', shortOfParity)).not.toBe('attack');
    expect(posture('balanced', ENEMY_POINTS)).toBe('attack');
    expect(posture('defensive', ENEMY_POINTS)).not.toBe('attack');
    expect(posture('defensive', (3 * ENEMY_POINTS) / 2)).toBe('attack');
  });

  it('lands a defensive army too big to keep home from parity when its target lies over the sea', () => {
    const big = (overrides: Partial<PostureInputs> = {}) =>
      inputs(ENEMY_POINTS, { ownMen: DEFENSIVE_SEA_ARMY_MEN, targetOverSea: true, ...overrides });
    const chosen = selectPosture('defensive', big(), null);
    expect(chosen.posture).toBe('attack');
    expect(chosen.evidence).toContain('armyOutgrown');
    expect(ordersFor('defensive', 'attack', chosen.evidence).launchRatio).toEqual({ num: 1, den: 1 });
    expect(ordersFor('defensive', 'attack').launchRatio).toEqual({ num: 3, den: 2 });
    expect(selectPosture('defensive', big(), 'attack').posture).toBe('attack');
    // Once landing, a few men and points lost keep the attack inside its hold band.
    const thinned = big({ ownMen: DEFENSIVE_SEA_ARMY_MEN - 1, ownPoints: ENEMY_POINTS - 1 });
    expect(selectPosture('defensive', thinned, 'attack').posture).toBe('attack');
    expect(selectPosture('defensive', thinned, null).posture).toBe('prepare');
    // Smaller, on the same land, or short of what it believes defends the target: it keeps building up.
    expect(selectPosture('defensive', big({ ownMen: DEFENSIVE_SEA_ARMY_MEN - 1 }), null).posture).toBe(
      'prepare',
    );
    expect(selectPosture('defensive', big({ targetOverSea: false }), null).posture).toBe('prepare');
    expect(selectPosture('defensive', big({ targetPoints: ENEMY_POINTS + 1 }), null).posture).toBe('prepare');
  });

  it('never attacks with no army, even against a target taken at parity', () => {
    // An enemy the seat knows nothing of is believed as strong as the seat: zero against zero.
    const blind = inputs(0, { targetPoints: 0, strongestPoints: null });
    expect(selectPosture('aggressive', blind, null).posture).toBe('prepare');
    expect(selectPosture('balanced', blind, 'attack').posture).toBe('prepare');
  });

  it('builds up for the hold on a map won by holding an area, unless a stronger enemy or an attack comes', () => {
    const rich = inputs(2 * ENEMY_POINTS, { holdAimed: true, raidTargetKnown: true });
    for (const plan of MILITARY_PLANS) {
      expect(selectPosture(plan, rich, null)).toEqual(
        expect.objectContaining({ posture: 'prepare', evidence: expect.arrayContaining(['buildingUp']) }),
      );
    }
    expect(selectPosture('balanced', { ...rich, underAttack: true }, null).posture).toBe('defend');
    expect(selectPosture('balanced', { ...rich, ownPoints: ENEMY_POINTS / 2 }, null).posture).toBe('defend');
    expect(selectPosture('balanced', { ...rich, threatInTicks: 0 }, null).posture).toBe('prepare');
  });

  it('harasses for the harasser plan, and for another once it has seen a raid target', () => {
    expect(selectPosture('harasser', inputs(2 * ENEMY_POINTS), null).posture).toBe('harass');
    const weaker = ENEMY_POINTS - 1;
    expect(selectPosture('balanced', inputs(weaker), null).posture).toBe('prepare');
    expect(selectPosture('balanced', inputs(weaker, { raidTargetKnown: true }), null).posture).toBe('harass');
  });

  it('keeps an attack a little below its launch edge, and changes a calm posture only after reviews in a row', () => {
    const slipped = ENEMY_POINTS - ENEMY_POINTS / 20;
    expect(selectPosture('balanced', inputs(slipped), 'attack').posture).toBe('attack');
    expect(selectPosture('balanced', inputs(slipped), null).posture).not.toBe('attack');

    const harass = selectPosture('balanced', inputs(slipped, { raidTargetKnown: true }), null);
    let state = held('attack');
    for (let review = 1; review < POSTURE_SWITCH_REVIEWS; review++)
      state = reviewMilitary(state, harass, review);
    expect(state.posture).toBe('attack');
    expect(state.challenger).toEqual({ posture: 'harass', reviews: POSTURE_SWITCH_REVIEWS - 1 });
    state = reviewMilitary(state, harass, POSTURE_SWITCH_REVIEWS);
    expect(state).toEqual(expect.objectContaining({ posture: 'harass', decidedAt: POSTURE_SWITCH_REVIEWS }));

    // A forecast attack does not wait.
    const prepare = selectPosture('balanced', inputs(slipped, { threatInTicks: 0 }), 'harass');
    expect(reviewMilitary(state, prepare, POSTURE_SWITCH_REVIEWS + 1).posture).toBe('prepare');
  });
});
