import type { TerrainMapFile } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { AuthoredJoinRows } from '../src/game/world/index.js';
import { worldTribes } from '../src/game/world-tribes.js';

/**
 * The tribe set a world loads art for. Every civilization costs its own building and settler atlas pages,
 * so the sheet takes the seats' tribes plus the tribes of the authored entities rather than every tribe
 * the content describes.
 */

const VIKING = 1;
const FRANK = 2;
const SARACEN = 4;
const EGYPT = 7;

const rows: AuthoredJoinRows = {
  tribes: [
    { typeId: VIKING, id: 'viking' },
    { typeId: FRANK, id: 'frank' },
    { typeId: SARACEN, id: 'saracen' },
    { typeId: 20, id: 'wolves' },
  ],
  buildingBobs: [
    { editName: 'viking home', level: 0, typeId: 6, tribeId: VIKING },
    { editName: 'Egypt Tower', level: 0, typeId: 40, tribeId: EGYPT },
  ],
};

const seats = (...tribeIds: number[]) => ({
  players: tribeIds.map((tribeId, player) => ({
    player,
    tribeId,
    colorId: player,
    type: 'human' as const,
  })),
});

function entities(over: Partial<NonNullable<TerrainMapFile['entities']>>): TerrainMapFile['entities'] {
  return { buildings: [], humans: [], animals: [], ...over };
}

describe('worldTribes', () => {
  it('always opens with the base tribe, which backs anything the others do not skin', () => {
    expect(worldTribes(null, undefined, {})).toEqual([VIKING]);
    expect(worldTribes(seats(SARACEN), undefined, rows)[0]).toBe(VIKING);
  });

  it('collects the seats roster tribes in ascending order behind the base', () => {
    expect(worldTribes(seats(SARACEN, FRANK, SARACEN), undefined, rows)).toEqual([VIKING, FRANK, SARACEN]);
  });

  it('collects the tribes of the authored settlers and houses', () => {
    const map = entities({
      humans: [{ tribe: 'frank', role: 'civilist', player: 0, hx: 2, hy: 2 }],
      buildings: [{ name: 'Egypt Tower', level: 0, player: 0, hx: 4, hy: 4 }],
    });
    expect(worldTribes(null, map, rows)).toEqual([VIKING, FRANK, EGYPT]);
  });

  it('ignores animal species and an unresolvable name, which draw through no civilization', () => {
    const map = entities({
      humans: [
        { tribe: 'wolves', role: 'civilist', player: 0, hx: 2, hy: 2 },
        { tribe: 'not a tribe', role: 'civilist', player: 0, hx: 3, hy: 3 },
      ],
      buildings: [{ name: 'no such house', level: 0, player: 0, hx: 4, hy: 4 }],
    });
    expect(worldTribes(null, map, rows)).toEqual([VIKING]);
  });
});
