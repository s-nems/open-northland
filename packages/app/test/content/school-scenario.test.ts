import { components, halfCellMapFromCells, Simulation, systems } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { VIKING } from '../../src/catalog/buildings.js';
import { TERRAIN_OPEN } from '../../src/catalog/terrain.js';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

it.skipIf(!hasRealIr())(
  'a worker walks into a real school and learns an already discovered civilian trade',
  async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const school = content.buildings.find((b) => b.kind === 'training' && b.workers.length === 0);
    const carpenter = content.jobs.find((j) => j.id === 'joiner');
    const collector = content.jobs.find((j) => j.id === 'collector');
    if (school === undefined || carpenter === undefined || collector === undefined)
      throw new Error('missing school catalog');
    // A trade is discovered for the player by a worker who qualifies for it, so the resident joiner
    // spawns with the XP its viking `needforjob` row asks for; a fresh joiner would discover nothing.
    const joinerNeed = content.tribes
      .find((t) => t.typeId === VIKING)
      ?.jobRequirements.find(
        (r) => r.requirement === 'need' && r.target === 'job' && r.targetId === carpenter.typeId,
      );
    if (joinerNeed === undefined) throw new Error('real content no longer gates the joiner');
    const qualifyingExperience = joinerNeed.experienceTypes.map(
      (trackId) =>
        [
          trackId,
          systems.rawXpForRepeats(
            content.jobExperience.find((t) => t.typeId === trackId),
            joinerNeed.amount,
          ),
        ] as const,
    );
    const size = 24;
    const sim = new Simulation({
      seed: 5,
      content,
      map: halfCellMapFromCells({
        width: size,
        height: size,
        typeIds: new Array(size * size).fill(TERRAIN_OPEN),
      }),
    });
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: school.typeId,
      x: 20,
      y: 20,
      tribe: VIKING,
      owner: HUMAN_PLAYER,
      force: true,
    });
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: collector.typeId,
      x: 20,
      y: 28,
      tribe: VIKING,
      owner: HUMAN_PLAYER,
    });
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: carpenter.typeId,
      x: 30,
      y: 28,
      tribe: VIKING,
      owner: HUMAN_PLAYER,
      experience: qualifyingExperience,
    });
    sim.step();
    const house = [...sim.world.query(components.Building)][0];
    const pupil = [...sim.world.query(components.Settler)].find(
      (e) => sim.world.get(e, components.Settler).jobType === collector.typeId,
    );
    if (house === undefined || pupil === undefined) throw new Error('setup failed');
    sim.enqueueSetup({ kind: 'learn', entity: pupil, house, target: 'job', typeId: carpenter.typeId });
    sim.run(1000);
    expect(sim.world.get(pupil, components.Settler).jobType).toBe(carpenter.typeId);
    expect(sim.world.get(pupil, components.Settler).learned?.job).toContain(carpenter.typeId);
    expect(sim.checkInvariants()).toEqual([]);
  },
  30_000,
);
