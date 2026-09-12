import { expect, it } from 'vitest';
import {
  Building,
  grantScriptUnlock,
  Owner,
  setMapPermission,
  setProfessionProgression,
} from '../../src/components/index.js';
import { exportSaveGame, restoreSimulation, Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import { FIRST_PASS, firingSim } from './support.js';

const PLAYER = 0;
const RIVAL = 1;
const TRIBE = 1;
const CUTTER = 1;
const CARPENTER = 2;
const SAWMILL = 2;
const PLANK = 2;

function content() {
  const data = testContent();
  const tribe = data.tribes[0];
  if (tribe === undefined) throw new Error('Missing fixture tribe');
  tribe.jobEnables = [
    { kind: 'house', targetId: SAWMILL, jobType: CUTTER },
    { kind: 'job', targetId: CARPENTER, jobType: CUTTER },
    { kind: 'good', targetId: PLANK, jobType: CUTTER },
  ];
  tribe.jobRequirements = [];
  return data;
}

it('isolates every technology gate by owner and invalidates on ownership transfer', () => {
  const sim = new Simulation({ seed: 1, content: content() });
  const worker = settlerAt(sim, { jobType: CUTTER, tribe: TRIBE });
  sim.world.add(worker, Owner, { player: RIVAL });
  for (const kind of ['house', 'job', 'good'] as const) {
    expect(sim.unlockStatus(kind, SAWMILL, TRIBE, PLAYER).enabled).toBe(false);
    expect(sim.unlockStatus(kind, SAWMILL, TRIBE, RIVAL).enabled).toBe(true);
  }
  sim.world.mut(worker, Owner).player = PLAYER;
  expect(sim.unlockStatus('house', SAWMILL, TRIBE, PLAYER).enabled).toBe(true);
  expect(sim.unlockStatus('house', SAWMILL, TRIBE, RIVAL).enabled).toBe(false);
});

it('AllowGood removes a map ban without granting technology, and survives save/load', () => {
  const sim = firingSim([{ opcode: 'AllowGood', player: PLAYER, tribe: TRIBE, good: PLANK }], content());
  setMapPermission(sim.world, { player: PLAYER, tribe: TRIBE, kind: 'good', typeId: PLANK, allowed: false });
  expect(sim.unlockStatus('good', PLANK, TRIBE, PLAYER).allowed).toBe(false);
  sim.run(FIRST_PASS);
  expect(sim.unlockStatus('good', PLANK, TRIBE, PLAYER)).toMatchObject({ allowed: true, enabled: false });
  const { sim: restored } = restoreSimulation(exportSaveGame(sim), {
    content: sim.content,
    map: grassNodeMap(48, 48),
    ...(sim.missions !== undefined ? { missions: sim.missions } : {}),
  });
  expect(restored.unlockStatus('good', PLANK, TRIBE, PLAYER)).toEqual(
    sim.unlockStatus('good', PLANK, TRIBE, PLAYER),
  );
});

it('EnableHouse opens both the placement probe and the command for the selected seat only', () => {
  const sim = new Simulation({ seed: 1, content: content(), map: grassNodeMap(48, 48) });
  expect(sim.placementProbe(SAWMILL, PLAYER, TRIBE)?.canPlace(20, 20)).toBe(false);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: SAWMILL,
    tribe: TRIBE,
    owner: PLAYER,
    x: 20,
    y: 20,
  });
  sim.step();
  expect(sim.unlockStatus('house', SAWMILL, TRIBE, PLAYER).enabled).toBe(false);
  grantScriptUnlock(sim.world, 'enabled', PLAYER, TRIBE, 'house', SAWMILL);
  expect(sim.placementProbe(SAWMILL, PLAYER, TRIBE)?.canPlace(20, 20)).toBe(true);
  expect(sim.placementProbe(SAWMILL, RIVAL, TRIBE)?.canPlace(20, 20)).toBe(false);
  expect([...sim.world.query(Building)]).toHaveLength(0);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: SAWMILL,
    tribe: TRIBE,
    owner: PLAYER,
    x: 20,
    y: 20,
  });
  sim.step();
  expect([...sim.world.query(Building)]).toHaveLength(1);
});

it('progression off lifts prerequisites but preserves explicit map restrictions', () => {
  const sim = new Simulation({ seed: 1, content: content() });
  setProfessionProgression(sim.world, false);
  expect(sim.unlockStatus('house', SAWMILL, TRIBE, PLAYER).enabled).toBe(true);
  setMapPermission(sim.world, {
    player: PLAYER,
    tribe: TRIBE,
    kind: 'house',
    typeId: SAWMILL,
    allowed: false,
  });
  expect(sim.unlockStatus('house', SAWMILL, TRIBE, PLAYER).enabled).toBe(false);
});

it('a profession requires the player’s own prerequisite, independently of individual experience', () => {
  const sim = new Simulation({ seed: 1, content: content() });
  const trainee = settlerAt(sim, { jobType: null, tribe: TRIBE });
  sim.world.add(trainee, Owner, { player: PLAYER });
  expect(sim.canChooseJob(trainee, CARPENTER)).toBe(false);
  grantScriptUnlock(sim.world, 'enabled', PLAYER, TRIBE, 'job', CARPENTER);
  expect(sim.canChooseJob(trainee, CARPENTER)).toBe(true);
});
