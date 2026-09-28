import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { briefingMatchObjectives, missionGoalList, missionGoals } from '../../src/game/mission-brief.js';
import { hasRealIr } from './helpers.js';
import { realMapWorld } from './real-map-world.js';

describe.runIf(hasRealIr())('real map objective presentation', () => {
  it.each(['magiczny_las', 'diamentowa_dolina', 'nowa_nadzieja'])(
    '%s keeps its overall goal open after the opening briefing fires',
    async (mapId) => {
      const { sim } = await realMapWorld({ mapId, aiSeats: [], humanSeats: [0] });
      const matchObjectives = briefingMatchObjectives(sim.missions);
      expect([...matchObjectives]).toEqual(['0']);
      sim.run(systems.MISSION_EVALUATION_TICKS * 2);
      expect(sim.missionStatus()[0]).toMatchObject({ done: true, fireCount: 1 });
      const goals = missionGoalList(
        { page: () => null, fallback: { title: '' }, skirmishGoal: null, matchObjectives },
        sim.missionStatus(),
        (id) => String(id),
        sim.matchOutcome(0),
      );
      expect(goals.find((goal) => goal.key === '0')?.state).toBe('open');
      expect(sim.matchOutcome(0)).toBe('undecided');
    },
    30_000,
  );

  it('keeps a story map`s conditional goal states as reported by the simulation', async () => {
    const { sim } = await realMapWorld({ mapId: 'wielkie_sprzatanie', aiSeats: [], humanSeats: [0] });
    const matchObjectives = briefingMatchObjectives(sim.missions);
    expect(matchObjectives.size).toBe(0);
    sim.run(systems.MISSION_EVALUATION_TICKS * 3);
    const status = sim.missionStatus();
    const textOf = (id: number): string => String(id);
    const goals = missionGoalList(
      { page: () => null, fallback: { title: '' }, skirmishGoal: null, matchObjectives },
      status,
      textOf,
      sim.matchOutcome(0),
    );
    expect(goals.length).toBeGreaterThan(0);
    expect(goals).toEqual(missionGoals(status, textOf));
    expect(goals.some((goal) => goal.state === 'open')).toBe(true);
  }, 30_000);
});
