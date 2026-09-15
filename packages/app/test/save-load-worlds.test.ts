import {
  exportSaveGame,
  FOG_MODE,
  parseSaveGame,
  type SaveGame,
  type Simulation,
  serializeSaveGame,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import { buildMapWorld, restoreMapWorld } from '../src/entries/map/world.js';
import { collisionScene } from '../src/scenes/collision.js';
import { createSceneSim, restoreSceneSim } from '../src/scenes/index.js';
import { AUTHORED_ENTITIES, AUTHORED_ROWS } from './support/authored-entities.js';
import { authoredMapFile } from './support/world-maps.js';

/**
 * The app-layer restore paths must resolve the exact content and terrain their fresh builders do:
 * for every world kind, a run's export restores to the same hash and re-exports the same bytes.
 * This is what keeps `restoreMapWorld`/`restoreSceneSim` from drifting away from the builders.
 */

const AUTHORED_IR = AUTHORED_ROWS as ContentIr;

const BASE_OPTIONS = {
  seed: 7,
  content: {},
  aiSeats: [],
  assistantSeats: [0],
  fog: null,
  progression: null,
  needs: null,
  missions: null,
} as const;

function exported(sim: Simulation, token: string): { save: SaveGame; bytes: string } {
  const bytes = serializeSaveGame(exportSaveGame(sim, { mapId: token }));
  return { save: parseSaveGame(JSON.parse(bytes)), bytes };
}

function expectExactRestore(live: Simulation, restored: Simulation, bytes: string, token: string): void {
  expect(restored.hashState()).toBe(live.hashState());
  expect(serializeSaveGame(exportSaveGame(restored, { mapId: token }))).toBe(bytes);
}

describe('restoreMapWorld', () => {
  it('preserves saved scripted fog and participant policy despite current boot defaults', () => {
    const options = {
      ...BASE_OPTIONS,
      map: authoredMapFile(AUTHORED_ENTITIES),
      ir: AUTHORED_IR,
      script: { missions: { missions: [] }, participants: [0, 2] },
      missions: true,
      fog: FOG_MODE.OFF,
    };
    const { sim } = buildMapWorld(options);
    sim.run(2);
    const { save, bytes } = exported(sim, 'm1');
    const { sim: restored } = restoreMapWorld(
      { ...options, script: { ...options.script, participants: [5, 6] } },
      save,
    );
    expect(restored.fogMode()).toBe(FOG_MODE.OFF);
    expect(restored.matchRules()).toEqual({ participants: [0, 2], victory: 'script' });
    expectExactRestore(sim, restored, bytes, 'm1');
    sim.run(1);
    restored.run(1);
    expect(restored.hashState()).toBe(sim.hashState());
  });

  it('round-trips an authored world through the authored content resolution', () => {
    const options = { ...BASE_OPTIONS, map: authoredMapFile(AUTHORED_ENTITIES), ir: AUTHORED_IR };
    const { sim } = buildMapWorld(options);
    sim.run(30);
    const { save, bytes } = exported(sim, 'm1');
    const restored = restoreMapWorld(options, save);
    expect(restored.kind).toBe('authored');
    expectExactRestore(sim, restored.sim, bytes, 'm1');
  });

  it('round-trips a bare world', () => {
    const options = { ...BASE_OPTIONS, map: authoredMapFile(), ir: AUTHORED_IR };
    const { sim } = buildMapWorld(options);
    sim.run(10);
    const { save, bytes } = exported(sim, 'm1');
    const restored = restoreMapWorld(options, save);
    expect(restored.kind).toBe('bare');
    expectExactRestore(sim, restored.sim, bytes, 'm1');
  });

  it('round-trips the demo fallback world with its owner tagging', () => {
    const options = { ...BASE_OPTIONS, map: null, ir: null, demoOwner: 3 };
    const { sim } = buildMapWorld(options);
    sim.run(10);
    const { save, bytes } = exported(sim, 'm1');
    const restored = restoreMapWorld(options, save);
    expect(restored.kind).toBe('demo');
    expectExactRestore(sim, restored.sim, bytes, 'm1');
  });

  it('rejects a save whose map fingerprint the resolved world cannot honor', () => {
    const { sim } = buildMapWorld({ ...BASE_OPTIONS, map: authoredMapFile(), ir: AUTHORED_IR });
    const { save } = exported(sim, 'm1');
    expect(() => restoreMapWorld({ ...BASE_OPTIONS, map: null, ir: null }, save)).toThrow(/mapFingerprint/);
  });
});

describe('restoreSceneSim', () => {
  it('round-trips a scene world without re-running its build or rules', () => {
    const sim = createSceneSim(collisionScene);
    sim.run(20);
    const token = `scene:${collisionScene.id}`;
    const { save, bytes } = exported(sim, token);
    expectExactRestore(sim, restoreSceneSim(collisionScene, save), bytes, token);
  });
});
