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
  ordersFor,
  POSTURE_REVIEW_EVERY_DECISIONS,
  POSTURE_SWITCH_REVIEWS,
  type PostureInputs,
  PREPARE_LEAD_TICKS,
  reviewMilitary,
  seatStrategyOf,
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
    targetOwner: TARGET,
    targetPoints: ENEMY_POINTS,
    strongestPoints: ENEMY_POINTS,
    threatInTicks: null,
    underAttack: false,
    raidTargetKnown: false,
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
    const first = seatStrategyOf(sim.world, SEAT).strategy?.military;
    expect(MILITARY_PLANS).toContain(first?.plan);
    // Another plan than the draw, so a redraw would show.
    const other = MILITARY_PLANS.find((plan) => plan !== first?.plan) ?? 'balanced';
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no carrier');
    sim.world.mut(carrier, ComputerStrategy).military.plan = other;
    for (let i = 0; i < 2 * POSTURE_REVIEW_EVERY_DECISIONS * COMPUTER_DECISION_INTERVAL_TICKS; i++)
      sim.step();
    expect(seatStrategyOf(sim.world, SEAT).strategy?.military.plan).toBe(other);
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
