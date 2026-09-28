import { adminCommand, components, type Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { briefingMatchObjectives, missionGoalList } from '../../src/game/mission-brief.js';
import { hasRealIr } from './helpers.js';
import { realMapSessionWorld } from './real-map-world.js';

function defeatOpponents(sim: Simulation): void {
  for (const entity of sim.world.query(components.Person, components.Owner)) {
    if ([3, 4, 5].includes(sim.world.get(entity, components.Owner).player)) {
      sim.enqueue(adminCommand({ kind: 'debugKill', target: entity }));
    }
  }
}

const FIRST_CHECK =
  Math.ceil(systems.MATCH_DEATH_GRACE_TICKS / systems.MATCH_DEATH_CHECK_INTERVAL_TICKS) *
  systems.MATCH_DEATH_CHECK_INTERVAL_TICKS;

describe.runIf(hasRealIr())('map victory through session setup', () => {
  it('awards the forest allies victory and completes the objective after the enemy seats die', async () => {
    const sim = await realMapSessionWorld('map=magiczny_las&ai=1,2,3,4,5');
    sim.step();
    expect(sim.matchRules()).toEqual({ participants: [0, 1, 2, 3, 4, 5], victory: 'elimination' });
    defeatOpponents(sim);
    sim.run(FIRST_CHECK - sim.tick - 1);
    expect(sim.matchOutcome(0)).toBe('undecided');
    sim.step();
    expect(sim.matchOutcome(0)).toBe('victory');
    expect(sim.events.current()).toContainEqual({ kind: 'playerWon', player: 0 });
    const goals = missionGoalList(
      {
        page: () => null,
        fallback: { title: '' },
        skirmishGoal: null,
        matchObjectives: briefingMatchObjectives(sim.missions),
      },
      sim.missionStatus(),
      (id) => String(id),
      sim.matchOutcome(0),
    );
    expect(goals.find((goal) => goal.key === '0')?.state).toBe('done');
  }, 30_000);

  it('does not run elimination with only the local seat participating', async () => {
    const sim = await realMapSessionWorld('map=magiczny_las');
    sim.step();
    expect(sim.matchRules()).toEqual({ participants: [0], victory: 'elimination' });
    defeatOpponents(sim);
    sim.run(FIRST_CHECK - sim.tick + systems.MATCH_DEATH_CHECK_INTERVAL_TICKS);
    expect(sim.matchOutcome(0)).toBe('undecided');
  }, 30_000);
});
