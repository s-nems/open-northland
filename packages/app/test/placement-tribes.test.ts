import { components, exportSaveGame, type Simulation, serializeSaveGame } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildMapWorld, restoreMapWorld } from '../src/entries/map/world.js';
import { PRIMARY_TRIBE } from '../src/game/rules.js';
import { runDemoWorld } from '../src/game/world/index.js';

const OTHER_TRIBE = 2;
const BASE_OPTIONS = {
  seed: 7,
  map: null,
  ir: null,
  demoOwner: 0,
  aiSeats: [],
  assistantSeats: [],
  fog: null,
  progression: null,
  needs: null,
} as const;

function contentWithOtherTribe() {
  const content = runDemoWorld(7, 1).content;
  const primary = content.tribes.find((tribe) => tribe.typeId === PRIMARY_TRIBE);
  if (primary === undefined) throw new Error('demo content has no primary tribe');
  return {
    ...content,
    tribes: [
      ...content.tribes.filter((tribe) => tribe.typeId !== OTHER_TRIBE),
      { ...primary, typeId: OTHER_TRIBE, id: 'other' },
    ],
  };
}

function options() {
  return {
    ...BASE_OPTIONS,
    content: { content: contentWithOtherTribe() },
    playerRoster: [{ player: 0, type: 'human' as const, tribeId: OTHER_TRIBE, colorId: 0 }],
  };
}

function bytes(sim: Simulation): string {
  return serializeSaveGame(exportSaveGame(sim));
}

describe('placement authority in map assembly and restore', () => {
  it('uses the roster even when the owned starting buildings have another civilization', () => {
    const { sim } = buildMapWorld(options());
    sim.step();
    expect(components.playerPlacementTribes(sim.world, 0)).toEqual([OTHER_TRIBE]);
    expect(components.playerPlacementTribes(sim.world, 1)).toEqual([PRIMARY_TRIBE]);
    for (const entity of sim.world.query(components.Building)) {
      expect(sim.world.get(entity, components.Building).tribe).toBe(PRIMARY_TRIBE);
    }
  });

  it('does not append duplicate setup when restoring before the roster commands have applied', () => {
    const opts = options();
    const { sim } = buildMapWorld(opts);
    const restored = restoreMapWorld(opts, exportSaveGame(sim)).sim;
    expect(bytes(restored)).toBe(bytes(sim));
    sim.step();
    restored.step();
    expect(restored.hashState()).toBe(sim.hashState());
    expect(components.playerPlacementTribes(restored.world, 0)).toEqual([OTHER_TRIBE]);
  });

  it('fills missing legacy authority from the map roster before the next tick', () => {
    const opts = options();
    const legacy = runDemoWorld(7, 1, undefined, { ...opts.content, owner: 0 });
    expect(components.playerPlacementTribes(legacy.world, 0)).toBeNull();
    const restored = restoreMapWorld(opts, exportSaveGame(legacy)).sim;
    restored.step();
    expect(components.playerPlacementTribes(restored.world, 0)).toEqual([OTHER_TRIBE]);
  });

  it('preserves an explicit saved deny rule rather than replacing it with a default', () => {
    const opts = options();
    const { sim } = buildMapWorld(opts);
    sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: 0, tribes: [] });
    sim.step();
    const restored = restoreMapWorld(opts, exportSaveGame(sim)).sim;
    expect(bytes(restored)).toBe(bytes(sim));
    expect(components.playerPlacementTribes(restored.world, 0)).toEqual([]);
  });
});
