import { MapModules } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Owner, Person, Settler } from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { CIVILIST_JOB } from '../../../src/systems/lifecycle/ageclass.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { FORTRESS, MAP, SIEGE, SPEARMAN, soldiersOf, VIKING } from '../../fixtures/map-escalation/keep.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

const HUMAN = 0;
const COMPUTER = 1;
const SOLDIERS_PER_SEAT = 3;

function startedWorld(demobilized: boolean): Simulation {
  const sim = new Simulation({
    seed: 3,
    content: aiContent(),
    map: grassNodeMap(MAP, MAP),
    mapModules: MapModules.parse({
      siege: SIEGE,
      ...(demobilized ? { demobilizedStart: { version: 1 } } : {}),
    }),
  });
  sim.enqueueSetup({ kind: 'setAiControl', player: COMPUTER, enabled: true });
  // A map-scripted camp: machine identity whose computer controller stays off.
  sim.enqueueSetup({ kind: 'setAiControl', player: FORTRESS, enabled: true, computerEnabled: false });
  [HUMAN, COMPUTER, FORTRESS].forEach((owner, row) => {
    for (let i = 0; i < SOLDIERS_PER_SEAT; i++)
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: SPEARMAN,
        x: 20 + 4 * i,
        y: 20 + 20 * row,
        tribe: VIKING,
        owner,
      });
  });
  sim.step();
  return sim;
}

function people(sim: Simulation, seat: number): number {
  return [...sim.world.query(Person, Owner)].filter((e) => sim.world.get(e, Owner).player === seat).length;
}

describe('map escalation - computer seats demobilize', () => {
  it('turns a computer seat’s soldiers into civilians at the start and leaves other seats armed', () => {
    const sim = startedWorld(true);
    const soldiers = (seat: number) => soldiersOf(sim, seat);

    expect(soldiers(COMPUTER)).toBe(0);
    expect(people(sim, COMPUTER)).toBe(SOLDIERS_PER_SEAT);
    const computerJobs = [...sim.world.query(Settler, Owner)]
      .filter((e) => sim.world.get(e, Owner).player === COMPUTER)
      .map((e) => sim.world.get(e, Settler).jobType);
    expect(computerJobs).toEqual(Array(SOLDIERS_PER_SEAT).fill(CIVILIST_JOB));
    expect(soldiers(HUMAN)).toBe(SOLDIERS_PER_SEAT);
    expect(soldiers(FORTRESS)).toBe(SOLDIERS_PER_SEAT);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('leaves a seat handed to the computer after the start armed', () => {
    const sim = startedWorld(true);
    sim.enqueueSetup({ kind: 'setAiControl', player: HUMAN, enabled: true });
    sim.step();
    expect(soldiersOf(sim, HUMAN)).toBe(SOLDIERS_PER_SEAT);
  });

  it('keeps every seat armed without the module', () => {
    const sim = startedWorld(false);
    expect(soldiersOf(sim, COMPUTER)).toBe(SOLDIERS_PER_SEAT);
  });
});
