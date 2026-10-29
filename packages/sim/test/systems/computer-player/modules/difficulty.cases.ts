import { describe, expect, it } from 'vitest';
import { AiControl, aiControlEntity } from '../../../../src/components/index.js';
import { Simulation } from '../../../../src/index.js';
import {
  LATE_GAME_FROM_TICKS,
  MID_GAME_FROM_TICKS,
  SITES_GROW_FROM_TICKS,
} from '../../../../src/systems/computer-player/game-phase.js';
import {
  AI_PROFILES,
  type BuildOrder,
  type BuildOrderEntry,
  DEFAULT_BUILD_ORDER,
  orderSteps,
  profileBuildOrder,
  sitePace,
} from '../../../../src/systems/computer-player/index.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { SEAT } from '../support.js';

/** The most any entry of `order` asks for of `building`. */
function mostOf(order: BuildOrder, building: string): number {
  let most = 0;
  for (const entry of orderSteps(order)) {
    if (
      (entry.kind === 'place' || entry.kind === 'upgrade' || entry.kind === 'housing') &&
      entry.building === building
    ) {
      most = Math.max(most, entry.count);
    }
  }
  return most;
}

const catapultJoinery = (entry: BuildOrderEntry): boolean =>
  entry.kind === 'place' && entry.role === 'catapult';
const denseTowerLane = (entry: BuildOrderEntry): boolean =>
  entry.kind === 'towerCoverage' && entry.lane === true;

describe('AI difficulty profiles', () => {
  it('plays the whole build order on hard', () => {
    expect(profileBuildOrder(DEFAULT_BUILD_ORDER, AI_PROFILES.hard)).toBe(DEFAULT_BUILD_ORDER);
  });

  it('stops the lower difficulties earlier and drops what they go without', () => {
    const medium = profileBuildOrder(DEFAULT_BUILD_ORDER, AI_PROFILES.medium);
    expect(mostOf(medium, 'work_smithy_01')).toBe(AI_PROFILES.medium.buildingCaps.work_smithy_01);
    expect(mostOf(medium, 'home_level_00')).toBe(AI_PROFILES.medium.buildingCaps.home_level_00);
    expect(orderSteps(medium).some(catapultJoinery)).toBe(true);
    expect(orderSteps(medium).some(denseTowerLane)).toBe(true);

    const easy = profileBuildOrder(DEFAULT_BUILD_ORDER, AI_PROFILES.easy);
    for (const [building, cap] of Object.entries(AI_PROFILES.easy.buildingCaps)) {
      expect(mostOf(easy, building)).toBeLessThanOrEqual(cap);
    }
    expect(mostOf(easy, 'work_coin_mint')).toBe(1);
    expect(mostOf(easy, 'work_druid_01')).toBe(1);
    expect(orderSteps(easy).some(catapultJoinery)).toBe(false);
    expect(orderSteps(easy).some(denseTowerLane)).toBe(false);
    // The same order object every decision, so the caches keyed on it hold.
    expect(profileBuildOrder(DEFAULT_BUILD_ORDER, AI_PROFILES.easy)).toBe(easy);
  });

  it('keeps one construction site on easy in every phase and on medium through the opening hour', () => {
    for (const tick of [0, SITES_GROW_FROM_TICKS, MID_GAME_FROM_TICKS, LATE_GAME_FROM_TICKS]) {
      expect(sitePace(AI_PROFILES.easy, tick).sites).toBe(1);
      expect(sitePace(AI_PROFILES.medium, tick).sites).toBe(tick < MID_GAME_FROM_TICKS ? 1 : 2);
    }
  });

  it('sets the difficulty through setAiControl and keeps it when a later command omits it', () => {
    const sim = new Simulation({ seed: 1, content: aiContent() });
    const difficulty = (): string | undefined => {
      const carrier = aiControlEntity(sim.world, SEAT);
      return carrier === null ? undefined : sim.world.get(carrier, AiControl).difficulty;
    };
    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true });
    sim.step();
    expect(difficulty()).toBe('hard');
    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, difficulty: 'easy' });
    sim.step();
    expect(difficulty()).toBe('easy');
    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true });
    sim.step();
    expect(difficulty()).toBe('easy');
  });
});
