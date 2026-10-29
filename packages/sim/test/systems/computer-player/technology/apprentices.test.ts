import { describe, expect, it } from 'vitest';
import { noteSettlerProgress, Settler, SettlerProgress } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import type { Simulation } from '../../../../src/index.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import { DEFAULT_BUILD_ORDER, lineStatuses } from '../../../../src/systems/computer-player/index.js';
import { seatApprentices } from '../../../../src/systems/computer-player/technology/apprentices.js';
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
  MILLER_GATE_XP,
  placeHq,
  SEAT,
  spawnMen,
  technologyContent,
  VIKING,
} from '../support.js';

const content = technologyContent();

/** A seat whose standing farm employs two farmers, the first with half the miller's gate on his track,
 *  while the bread line's mill still waits on the miller. */
function seat(): { sim: Simulation; practised: Entity; green: Entity } {
  const sim = aiSim(1, content);
  placeHq(sim);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: FARM_TYPE,
    x: HQ_X + 8,
    y: HQ_Y + 6,
    tribe: VIKING,
    owner: SEAT,
    force: true,
  });
  spawnMen(sim, 12);
  sim.step();
  const farm = entityOfBuilding(sim, FARM_TYPE);
  const men = [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Settler).jobType === CIVILIST);
  const [green, practised] = men;
  if (green === undefined || practised === undefined) throw new Error('setup: two spawned men');
  for (const e of [green, practised])
    sim.enqueueSetup({ kind: 'assignWorker', entity: e, building: farm, jobPriority: [FARMER] });
  sim.step();
  setFarmerXp(sim, practised, MILLER_GATE_XP / 2);
  return { sim, practised, green };
}

function setFarmerXp(sim: Simulation, e: Entity, xp: number): void {
  sim.world.mut(e, SettlerProgress).experience.set(FARMER_TRACK, xp);
  noteSettlerProgress(sim.world, e);
  sim.step();
}

function apprentices(sim: Simulation): Entity[] {
  const ctx = { ...ctxOf(sim), content };
  const statuses = lineStatuses(sim.world, ctx, SEAT, ownedBuildings(sim.world, SEAT), DEFAULT_BUILD_ORDER);
  return [...seatApprentices(sim.world, ctx, SEAT, DEFAULT_BUILD_ORDER, statuses)];
}

describe('technology apprentices', () => {
  it('pins the farmer most practised toward the miller and keeps him at the farm until he earns it', () => {
    const { sim, practised } = seat();
    // The lower id has no repeats, so the practised farmer is the one pinned.
    expect(apprentices(sim)).toEqual([practised]);
    const ctx = { ...ctxOf(sim), content };
    const moves = [...collectModule.run(sim.world, ctx, SEAT)].filter(
      (c) => (c.kind === 'setJob' || c.kind === 'assignWorker') && c.entity === practised,
    );
    expect(moves).toEqual([]);
    // The debug read names the same man and leaves the world as it was.
    const before = sim.hashState();
    const pinned = sim.computerApprentices(SEAT).filter((view) => view.man !== null);
    expect(pinned.map((view) => view.man)).toEqual([practised]);
    expect(sim.hashState()).toBe(before);

    // Over the threshold the miller is discovered, and nothing is left to pin him for.
    setFarmerXp(sim, practised, MILLER_GATE_XP);
    expect(apprentices(sim)).toEqual([]);
  });
});
