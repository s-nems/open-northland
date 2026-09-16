import { describe, expect, it } from 'vitest';
import { Chest, LandscapeResource, OpenedChest, Position } from '../../src/components/index.js';
import { exportSaveGame, restoreSimulation, type TerrainMap } from '../../src/index.js';
import { nodeOfPosition } from '../../src/nav/halfcell.js';
import { createChest } from '../../src/systems/chests/index.js';
import { SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import { FIRST_PASS, failedResultsUntil, holds, missionSim, POINT } from './support.js';

const WOODEN_CHEST = 85;

function chestMap(): TerrainMap {
  return {
    ...grassNodeMap(48, 48),
    landscapes: {
      types: [
        {
          typeId: WOODEN_CHEST,
          walk: [{ dx: 0, dy: 0 }],
          build: [{ dx: 0, dy: 0 }],
          groups: [],
          chest: { kind: 'wooden', gfxIndex: 845 },
        },
      ],
      placements: [],
    },
  };
}

describe('mission chests', () => {
  it('places a deterministic category reward and lets a later mission detect it immediately', () => {
    const missions = [
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [],
        results: [{ opcode: 'SetRandomChestOnPosition' as const, amount: 2, point: POINT }],
      },
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [{ opcode: 'ChestNearPos' as const, point: POINT, range: 0 }],
        results: [{ opcode: 'Exit' as const }],
      },
    ];
    const map = chestMap();
    const sim = missionSim(missions, testContent(), map);
    sim.run(FIRST_PASS);

    const [chest] = [...sim.world.query(Chest, LandscapeResource, Position)];
    if (chest === undefined) throw new Error('script did not place its chest');
    expect(sim.world.get(chest, Chest)).toMatchObject({ kind: 'wooden', contents: 52 });
    expect(nodeOfPosition(sim.world.get(chest, Position).x, sim.world.get(chest, Position).y)).toEqual(POINT);
    expect(sim.landscapeEdits().added).toEqual([
      { id: 0, typeId: WOODEN_CHEST, ...POINT, level: 52, resourceBacked: true },
    ]);
    expect(sim.events.current()).toContainEqual({ kind: 'missionExit', mission: 1 });

    const restored = restoreSimulation(exportSaveGame(sim), {
      content: sim.content,
      map,
      missions: { missions },
    });
    expect(restored.hashState()).toBe(sim.hashState());
    expect([...restored.world.query(Chest, LandscapeResource)]).toHaveLength(1);
  });

  it('finds the nearest free land when the requested point is occupied', () => {
    const map = chestMap();
    const sim = missionSim(
      [
        {
          active: true,
          visible: false,
          successfullIf: SUCCESSFUL_IF.all,
          goals: [],
          results: [{ opcode: 'SetRandomChestOnPosition', amount: 2, point: POINT }],
        },
      ],
      testContent(),
      map,
    );
    createChest(sim.world, sim.content, { kind: 'wooden', contents: 20, x: POINT.hx, y: POINT.hy });
    sim.run(FIRST_PASS);

    const positions = [...sim.world.query(Chest, Position)].map((entity) => {
      const p = sim.world.get(entity, Position);
      return nodeOfPosition(p.x, p.y);
    });
    expect(positions).toHaveLength(2);
    expect(positions).toContainEqual(POINT);
    expect(positions.filter((point) => point.hx !== POINT.hx || point.hy !== POINT.hy)).toHaveLength(1);
  });

  it('chooses a random clear position and reward reproducibly', () => {
    const missions = [
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [],
        results: [{ opcode: 'SetRandomChestOnRandomPos' as const, amount: 1 | 128 }],
      },
    ];
    const first = missionSim(missions, testContent(), chestMap());
    const second = missionSim(missions, testContent(), chestMap());
    first.run(FIRST_PASS);
    second.run(FIRST_PASS);

    expect(first.hashState()).toBe(second.hashState());
    const [chest] = [...first.world.query(Chest, LandscapeResource, Position)];
    if (chest === undefined) throw new Error('script did not place its random chest');
    expect([7, 8, 9, 10, 11, 12, 94, 95]).toContain(first.world.get(chest, Chest).contents);
    const point = nodeOfPosition(first.world.get(chest, Position).x, first.world.get(chest, Position).y);
    expect(point.hx).toBeGreaterThan(0);
    expect(point.hy).toBeGreaterThan(0);
    expect(point.hx).toBeLessThan(47);
    expect(point.hy).toBeLessThan(47);
  });

  it('does not count an opened chest and treats the empty category as an intentional no-op', () => {
    const goal = { opcode: 'ChestNearPos' as const, point: POINT, range: 0 };
    const sim = missionSim(
      [
        {
          active: true,
          visible: false,
          successfullIf: SUCCESSFUL_IF.all,
          goals: [goal],
          results: [],
        },
      ],
      testContent(),
      chestMap(),
    );
    createChest(sim.world, sim.content, {
      kind: 'wooden',
      contents: 20,
      x: POINT.hx,
      y: POINT.hy,
    });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
    const opened = missionSim(
      [
        {
          active: true,
          visible: false,
          successfullIf: SUCCESSFUL_IF.all,
          goals: [goal],
          results: [],
        },
      ],
      testContent(),
      chestMap(),
    );
    const openedChest = createChest(opened.world, opened.content, {
      kind: 'wooden',
      contents: 20,
      x: POINT.hx,
      y: POINT.hy,
    });
    opened.world.remove(openedChest, Chest);
    opened.world.add(openedChest, OpenedChest, {});
    opened.run(FIRST_PASS);
    expect(holds(opened)).toBe(false);

    const empty = missionSim(
      [
        {
          active: true,
          visible: false,
          successfullIf: SUCCESSFUL_IF.all,
          goals: [],
          results: [{ opcode: 'SetRandomChestOnRandomPos', amount: 32 }],
        },
      ],
      testContent(),
      chestMap(),
    );
    expect(failedResultsUntil(empty, FIRST_PASS)).toEqual([]);
    expect([...empty.world.query(Chest)]).toEqual([]);

    const invalid = missionSim(
      [
        {
          active: true,
          visible: false,
          successfullIf: SUCCESSFUL_IF.all,
          goals: [],
          results: [{ opcode: 'SetRandomChestOnRandomPos', amount: 0 }],
        },
      ],
      testContent(),
      chestMap(),
    );
    expect(failedResultsUntil(invalid, FIRST_PASS)).toEqual(['SetRandomChestOnRandomPos']);
  });
});
