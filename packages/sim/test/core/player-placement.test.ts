import { describe, expect, it } from 'vitest';
import { Building, PlayerPlacementRules, playerPlacementTribes } from '../../src/components/index.js';
import {
  adminCommand,
  aiCommand,
  type Entity,
  exportSaveGame,
  parseCommandEnvelope,
  playerCommand,
  replay,
  restoreSimulation,
  Simulation,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

const placement = { kind: 'placeBuilding', buildingType: 1, x: 4, y: 4, tribe: 1 } as const;

function fresh(): Simulation {
  return new Simulation({ seed: 3, content: testContent() });
}

function declare(sim: Simulation, tribes: readonly number[]): void {
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: 0, tribes });
}

function buildings(sim: Simulation): Entity[] {
  return [...sim.world.query(Building)];
}

describe('roster-authorized placement tribes', () => {
  it.each([playerCommand, aiCommand])(
    'refuses undeclared seats for both human and AI envelopes',
    (envelope) => {
      const sim = fresh();
      sim.enqueue(envelope(0, placement));
      sim.step();
      expect(playerPlacementTribes(sim.world, 0)).toBeNull();
      expect(buildings(sim)).toEqual([]);
      expect(sim.commands.log).toHaveLength(1);
    },
  );

  it.each([playerCommand, aiCommand])(
    'admits declared tribes and rejects foreign and unknown ones',
    (envelope) => {
      const sim = fresh();
      declare(sim, [1]);
      sim.enqueue(envelope(0, placement));
      sim.enqueue(envelope(0, { ...placement, tribe: 13 }));
      sim.enqueue(envelope(0, { ...placement, tribe: 999 }));
      sim.enqueue(envelope(1, placement));
      sim.step();
      expect(buildings(sim)).toHaveLength(1);
      expect(sim.commands.log).toHaveLength(5);
      expect(sim.checkInvariants()).toEqual([]);
    },
  );

  it('keeps list preference while deduplicating and permits an explicit empty list', () => {
    const sim = fresh();
    declare(sim, [13, 1, 13]);
    sim.step();
    expect(playerPlacementTribes(sim.world, 0)).toEqual([13, 1]);
    declare(sim, []);
    sim.enqueue(playerCommand(0, placement));
    sim.step();
    expect(playerPlacementTribes(sim.world, 0)).toEqual([]);
    expect(buildings(sim)).toEqual([]);
  });

  it('does not partially apply a declaration containing unknown content', () => {
    const sim = fresh();
    declare(sim, [1]);
    declare(sim, [13, 999]);
    sim.step();
    expect(playerPlacementTribes(sim.world, 0)).toEqual([1]);
  });

  it('does not let a seat declare its own permissions', () => {
    expect(() =>
      parseCommandEnvelope({
        v: 1,
        origin: 'player',
        player: 0,
        command: { kind: 'setPlayerPlacementTribes', player: 0, tribes: [1] },
      }),
    ).toThrow(/may not issue/);
  });

  it('preserves trusted mixed-tribe map placements independently of seat permissions', () => {
    const sim = fresh();
    declare(sim, []);
    sim.enqueueSetup({ ...placement, owner: 0 });
    sim.enqueue(adminCommand({ ...placement, tribe: 13, owner: 0 }));
    sim.step();
    expect(buildings(sim).map((entity) => sim.world.get(entity, Building).tribe)).toEqual([1, 13]);
  });

  it('saves and restores permissions; a legacy world remains undeclared and cannot place', () => {
    const legacy = fresh();
    const resumedLegacy = restoreSimulation(exportSaveGame(legacy), { content: legacy.content });
    expect(playerPlacementTribes(resumedLegacy.world, 0)).toBeNull();
    resumedLegacy.enqueue(playerCommand(0, placement));
    resumedLegacy.step();
    expect(buildings(resumedLegacy)).toEqual([]);

    const live = fresh();
    declare(live, [1]);
    live.step();
    const restored = restoreSimulation(exportSaveGame(live), { content: live.content });
    expect(playerPlacementTribes(restored.world, 0)).toEqual([1]);
    for (const sim of [live, restored]) {
      sim.enqueue(playerCommand(0, placement));
      sim.step();
    }
    expect(restored.hashState()).toBe(live.hashState());
    expect(buildings(restored)).toHaveLength(1);
  });

  it('rejects malformed or unknown tribe rules restored from a save', () => {
    const sim = fresh();
    declare(sim, [1]);
    sim.step();
    const carrier = sim.world.lowestEntityWith(PlayerPlacementRules);
    if (carrier === null) throw new Error('missing permission carrier');
    sim.world.mut(carrier, PlayerPlacementRules).tribes.set(0, [999]);
    expect(() => restoreSimulation(exportSaveGame(sim), { content: sim.content })).toThrow(
      /PlayerPlacementRules tribes/,
    );
  });

  it('replays roster setup and produces identical digests on independently built clients', () => {
    const a = fresh();
    const b = fresh();
    for (const sim of [a, b]) {
      sim.setSyncDigest(true);
      declare(sim, [1]);
      sim.enqueue(playerCommand(0, placement));
      sim.enqueue(aiCommand(0, { ...placement, tribe: 999 }));
      sim.step();
    }
    expect(a.hashState()).toBe(b.hashState());
    expect(a.syncDigest()).toEqual(b.syncDigest());
    const replayed = replay({ content: a.content, seed: 3, log: a.commands.log, untilTick: 1 });
    expect(replayed.hashState()).toBe(a.hashState());
  });
});
