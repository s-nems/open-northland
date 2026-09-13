import { components, halfCellMapFromCells, Simulation } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { TERRAIN_OPEN } from '../../src/catalog/terrain.js';
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
      tribe: 1,
      owner: 0,
      force: true,
    });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: collector.typeId, x: 20, y: 28, tribe: 1, owner: 0 });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: carpenter.typeId, x: 30, y: 28, tribe: 1, owner: 0 });
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
