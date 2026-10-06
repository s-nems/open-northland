import { describe, expect, it } from 'vitest';
import { Position, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  formationNodes,
  MAX_UNIT_ORDER_MEMBERS,
  nodeOfPosition,
  positionOfNode,
  Simulation,
} from '../../src/index.js';
import { stampResourceFootprintData, unstampResourceFootprint } from '../../src/systems/footprint/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap, waterColumnMap } from '../fixtures/terrain.js';
import {
  HUT,
  mappedSim,
  placedBuilding,
  terrainOf,
  VIKING,
} from '../footprint/building-placement/support.js';

function person(sim: Simulation, hx: number, hy: number) {
  const id = sim.world.create();
  sim.world.add(id, Settler, { tribe: 1, jobType: null });
  sim.world.add(id, Position, positionOfNode(hx, hy));
  return id;
}

describe('fresh formation slots', () => {
  it('keeps each bank separate when a click near the shore names water', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: waterColumnMap(12, 8, 6) });
    const terrain = terrainOf(sim);
    const members = [person(sim, 4, 4), person(sim, 5, 4), person(sim, 18, 4), person(sim, 20, 4)];
    const before = sim.hashState();
    const groups = sim.formationSlots({ hx: 12, hy: 5 }, members, 2);
    expect(groups).toHaveLength(2);
    expect(groups?.flatMap((group) => group.members).sort()).toEqual([...members].sort());
    for (const group of groups ?? []) {
      expect(group.slots).toHaveLength(group.members.length);
      const components = new Set(
        group.members.map((id) => {
          const { hx, hy } = nodeOfPosition(sim.world.get(id, Position).x, sim.world.get(id, Position).y);
          return terrain.componentOf(terrain.nodeAt(hx, hy));
        }),
      );
      expect(components.size).toBe(1);
      for (const { hx, hy } of group.slots) {
        expect(terrain.isWalkable(terrain.nodeAt(hx, hy))).toBe(true);
        expect(components.has(terrain.componentOf(terrain.nodeAt(hx, hy)))).toBe(true);
        expect(hy % 2).toBe(1);
      }
    }
    expect(sim.hashState()).toBe(before);
  });

  it('blocks the full body of a selected building while allowing the selected settlers to vacate', () => {
    const sim = mappedSim();
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 10, y: 10, tribe: VIKING });
    sim.step();
    const building = placedBuilding(sim);
    const movers = [person(sim, 9, 9), person(sim, 11, 9), person(sim, 12, 9)];
    const idle = person(sim, 9, 10);
    const groups = sim.formationSlots({ hx: 10, hy: 10 }, [...movers, building]);
    expect(groups?.flatMap((group) => group.members)).toEqual(movers);
    const keys = groups?.flatMap((group) => group.slots.map(({ hx, hy }) => `${hx},${hy}`));
    expect(keys).toHaveLength(movers.length);
    expect(keys).not.toContain('10,10');
    expect(keys).not.toContain('11,10');
    expect(keys).not.toContain('9,10');
    expect(sim.formationSlots({ hx: 9, hy: 10 }, [idle])?.[0]?.slots).toEqual([{ hx: 9, hy: 10 }]);
  });

  it('reads structure footprints again on the next click, without a stale client cache', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(20, 16) });
    const member = person(sim, 2, 2);
    const target = { hx: 10, hy: 8 };
    expect(sim.formationSlots(target, [member])?.[0]?.slots).toEqual([target]);
    const obstacle = sim.world.create();
    sim.world.add(obstacle, Position, positionOfNode(target.hx, target.hy));
    stampResourceFootprintData(sim.world, obstacle, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
    expect(sim.formationSlots(target, [member])?.[0]?.slots).not.toContainEqual(target);
    unstampResourceFootprint(sim.world, obstacle);
    expect(sim.formationSlots(target, [member])?.[0]?.slots).toEqual([target]);
  });

  it('ignores duplicate, unknown and positionless members and bounds malformed requests', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(8, 6) });
    const member = person(sim, 2, 2);
    const inside = sim.world.create();
    sim.world.add(inside, Settler, { tribe: 1, jobType: null });
    expect(
      sim.formationSlots({ hx: -20, hy: 40 }, [member, member, inside, 99999 as Entity, -1 as Entity]),
    ).toEqual([{ members: [member], slots: [{ hx: 0, hy: 5 }] }]);
    expect(sim.formationSlots({ hx: 2, hy: 2 }, [])).toEqual([]);
    expect(sim.formationSlots({ hx: 2, hy: 2 }, [inside])).toEqual([]);
    expect(() =>
      sim.formationSlots({ hx: 0, hy: 0 }, Array(MAX_UNIT_ORDER_MEMBERS + 1).fill(member)),
    ).toThrow('invalid formation query');
    expect(() => sim.formationSlots({ hx: Number.NaN, hy: 0 }, [member])).toThrow('invalid formation query');
    expect(
      new Simulation({ seed: 1, content: testContent() }).formationSlots({ hx: 0, hy: 0 }, [member]),
    ).toBeNull();
  });

  it('finds 1000 legal and distinct slots around a shore in a single bounded scan', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: waterColumnMap(64, 48, 32) });
    const members = Array.from({ length: 1000 }, (_, i) =>
      person(sim, 2 + (i % 40), 2 + Math.floor(i / 40) * 2),
    );
    const groups = sim.formationSlots({ hx: 64, hy: 48 }, members, 2);
    const slots = groups?.flatMap((group) => group.slots) ?? [];
    expect(slots).toHaveLength(1000);
    expect(new Set(slots.map(({ hx, hy }) => `${hx},${hy}`)).size).toBe(1000);
    expect(slots.every(({ hx }) => hx < 64)).toBe(true);
  });

  it('fills legal gaps when military spacing would exclude a thin bank or halve a crowded destination', () => {
    const map = grassNodeMap(8, 3);
    const sim = new Simulation({
      seed: 1,
      content: testContent(),
      map: {
        ...map,
        typeIds: map.typeIds.map((_, i) => (Math.floor(i / 8) === 1 ? 0 : 1)),
      },
    });
    const members = Array.from({ length: 8 }, (_, i) => person(sim, i, 1));
    const groups = sim.formationSlots({ hx: 4, hy: 0 }, members, 2);
    expect(groups?.[0]?.slots).toHaveLength(8);
    expect(groups?.[0]?.slots.every(({ hy }) => hy === 1)).toBe(true);
    const crowded = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(4, 4) });
    const army = Array.from({ length: 16 }, (_, i) => person(crowded, i % 4, Math.floor(i / 4)));
    const slots = crowded.formationSlots({ hx: 2, hy: 2 }, army, 2)?.[0]?.slots ?? [];
    expect(slots).toHaveLength(16);
    expect(new Set(slots.map(({ hx, hy }) => `${hx},${hy}`)).size).toBe(16);
  });

  it.each([1, 2] as const)(
    'visits each on-map slot at most once on a thin blocked map, spacing %s',
    (spacing) => {
      const visited: string[] = [];
      expect(
        formationNodes(
          { hx: 4, hy: 1 },
          1000,
          3000,
          3,
          (hx, hy) => {
            visited.push(`${hx},${hy}`);
            return true;
          },
          spacing,
        ),
      ).toEqual([]);
      expect(new Set(visited).size).toBe(visited.length);
      expect(visited).toHaveLength(3000 * (spacing === 1 ? 3 : 1));
    },
  );
});
