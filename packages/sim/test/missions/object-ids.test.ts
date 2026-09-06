import { describe, expect, it } from 'vitest';
import { MissionBehaviour, MissionObjectId } from '../../src/components/index.js';
import { cellAnchorNode, Simulation } from '../../src/index.js';
import { missionObjectIds, missionObjects } from '../../src/systems/missions/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The mission object ids placements carry into the world, and the lookup the goals address them
 * through. An id names a group, so several placements share one and every lookup answers a list.
 */

const VIKING = 1;
const BEAR = 10;
const WOODCUTTER = 1;
const HEADQUARTERS = 1;
const SQUAD_ID = 200;
const CAMP_ID = 1000;

function placed(): Simulation {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(20, 20) });
  const at = (x: number, y: number): { x: number; y: number } => {
    const n = cellAnchorNode(x, y);
    return { x: n.hx, y: n.hy };
  };
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HEADQUARTERS,
    tribe: VIKING,
    force: true,
    missionId: CAMP_ID,
    ...at(2, 2),
  });
  for (const x of [6, 8]) {
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      tribe: VIKING,
      missionId: SQUAD_ID,
      behaviourFlags: 16937,
      ...at(x, 6),
    });
  }
  // An unaddressed settler beside them: no id column, so no component and no group.
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, tribe: VIKING, ...at(10, 6) });
  sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: BEAR, count: 1, missionId: SQUAD_ID, ...at(12, 6) });
  sim.step();
  return sim;
}

describe('mission object ids on placed entities', () => {
  it('stamps the authored id and behaviour mask, and nothing on a placement without one', () => {
    const sim = placed();
    const stamped = [...sim.world.query(MissionObjectId)];
    expect(stamped).toHaveLength(4); // one house, two settlers, one animal
    expect([...sim.world.query(MissionBehaviour)].map((e) => sim.world.get(e, MissionBehaviour))).toEqual([
      { flags: 16937 },
      { flags: 16937 },
    ]);
    expect(missionObjectIds(sim.world)).toEqual([SQUAD_ID, CAMP_ID]);
  });

  it('groups every carrier of one id, ascending, across humans, houses and animals', () => {
    const sim = placed();
    const squad = missionObjects(sim.world, SQUAD_ID);
    expect(squad).toHaveLength(3);
    expect([...squad]).toEqual([...squad].sort((a, b) => a - b));
    expect(missionObjects(sim.world, CAMP_ID)).toHaveLength(1);
    expect(missionObjects(sim.world, 4242)).toEqual([]);
  });

  it('drops a removed entity from its group on the next lookup', () => {
    const sim = placed();
    const first = missionObjects(sim.world, SQUAD_ID)[0];
    if (first === undefined) throw new Error('the placed squad carries no entity to remove');
    sim.world.destroy(first);
    expect(missionObjects(sim.world, SQUAD_ID)).toHaveLength(2);
    expect(missionObjects(sim.world, SQUAD_ID)).not.toContain(first);
  });
});
