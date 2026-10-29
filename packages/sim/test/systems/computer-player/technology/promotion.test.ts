import { describe, expect, it } from 'vitest';
import { noteSettlerProgress, Settler, SettlerProgress } from '../../../../src/components/index.js';
import type { PlayerCommand } from '../../../../src/core/commands/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import type { Simulation } from '../../../../src/index.js';
import {
  aiSim,
  CIVILIST,
  collectModule,
  ctxOf,
  entityOfBuilding,
  FARM_TYPE,
  FARMER,
  FARMER_TRACK,
  HQ_X,
  HQ_Y,
  MILL_TYPE,
  MILLER,
  MILLER_GATE_XP,
  placeHq,
  SEAT,
  spawnMen,
  technologyContent,
  VIKING,
} from '../support.js';

/** A seat with a standing farm and mill, its farm worked by one farmer holding `farmerXp` on his track. */
function seat(farmerXp: number): { sim: Simulation; farmer: Entity; run: () => PlayerCommand[] } {
  const content = technologyContent();
  const sim = aiSim(1, content);
  placeHq(sim);
  // Forced: the mill stands before anyone discovered the miller its tier asks for.
  for (const [buildingType, dx] of [
    [FARM_TYPE, 8],
    [MILL_TYPE, -8],
  ] as const)
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType,
      x: HQ_X + dx,
      y: HQ_Y + 6,
      tribe: VIKING,
      owner: SEAT,
      force: true,
    });
  spawnMen(sim, 12);
  sim.step();
  const farmer = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === CIVILIST);
  if (farmer === undefined) throw new Error('setup: no spawned man');
  sim.enqueueSetup({
    kind: 'assignWorker',
    entity: farmer,
    building: entityOfBuilding(sim, FARM_TYPE),
    jobPriority: [FARMER],
  });
  sim.step();
  sim.world.mut(farmer, SettlerProgress).experience.set(FARMER_TRACK, farmerXp);
  noteSettlerProgress(sim.world, farmer);
  sim.step();
  const run = (): PlayerCommand[] => [...collectModule.run(sim.world, { ...ctxOf(sim), content }, SEAT)];
  return { sim, farmer, run };
}

const posts = (commands: readonly PlayerCommand[], building: Entity, job: number): PlayerCommand[] =>
  commands.filter((c) => c.kind === 'assignWorker' && c.building === building && c.jobPriority[0] === job);

describe('technology promotion', () => {
  it('leaves a gated slot empty while no man qualifies for it', () => {
    const { sim, run } = seat(0);
    expect(posts(run(), entityOfBuilding(sim, MILL_TYPE), MILLER)).toEqual([]);
  });

  it('promotes the qualified farmer to the mill and refills his farm post with a fresh man', () => {
    const { sim, farmer, run } = seat(MILLER_GATE_XP);
    const mill = entityOfBuilding(sim, MILL_TYPE);
    const farm = entityOfBuilding(sim, FARM_TYPE);
    const first = run();
    expect(posts(first, mill, MILLER)).toEqual([
      { kind: 'assignWorker', entity: farmer, building: mill, jobPriority: [MILLER] },
    ]);
    for (const c of first) sim.enqueueSetup(c);
    sim.step();
    expect(sim.world.get(farmer, Settler).jobType).toBe(MILLER);
    const refill = posts(run(), farm, FARMER);
    expect(refill.length).toBeGreaterThan(0);
    expect(refill.some((c) => c.kind === 'assignWorker' && c.entity === farmer)).toBe(false);
  });
});
