import { GFX_DIR_TO_FACING } from '@open-northland/render/data';
import { describe, expect, it } from 'vitest';
import { FACING, programFrameLists } from '../src/content/settler-gfx/index.js';

/**
 * The slip repair on a program's per-facing lists. Lists are written here in render facing order (SW, W,
 * NW, NE, E, SE, S, N) and handed over in the source's `<dir>` order, the order the records carry.
 */

const { SE, S, N, NW } = FACING;

function inDirOrder(byFacing: readonly (readonly number[])[]): number[][] {
  return GFX_DIR_TO_FACING.map((facing) => [...(byFacing[facing] ?? [])]);
}

/** A six-block clip of two frames per facing, each hex facing cutting its own block. */
const HEX = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [8, 9],
  [10, 11],
];
const HEX_ROW = 12;

describe('programFrameLists', () => {
  it('gives a vertical that runs past the clip its usual hex neighbour', () => {
    // The viking unarmed punch: S and N lay out a seventh and eighth block the clip does not have, which
    // are the sleep clip's frames.
    const lists = programFrameLists(inDirOrder([...HEX, [12, 13], [14, 15]]), HEX_ROW);
    expect(lists[S]).toEqual(HEX[SE]);
    expect(lists[N]).toEqual(HEX[NW]);
  });

  it('gives a vertical straddling two facings its usual hex neighbour', () => {
    // The longbow shot at N starts on the NW block's tail and runs into NE's.
    const lists = programFrameLists(inDirOrder([...HEX, HEX[SE] ?? [], [5, 6]]), HEX_ROW);
    expect(lists[N]).toEqual(HEX[NW]);
  });

  it('gives a hex facing that left its block the list this program cuts inside it', () => {
    // The frankish two-hander at SE copies a shorter clip's offsets; its S list holds SE's own cut.
    const slipped = [...HEX.slice(0, SE), [9, 10], [10, 11], HEX[NW] ?? []];
    const lists = programFrameLists(inDirOrder(slipped), HEX_ROW);
    expect(lists[SE]).toEqual([10, 11]);
  });

  it('keeps sound lists, a vertical copying a hex facing and a composition moving back and forth', () => {
    // The talk clip's S list turns from SE to SW and back, a composition rather than a misplaced cut.
    const composed = [10, 11, 0, 1, 0, 11];
    const authored = [...HEX, composed, HEX[NW] ?? []];
    expect(programFrameLists(inDirOrder(authored), HEX_ROW)).toEqual(authored);
  });

  it('leaves a program with no facing-block layout as authored', () => {
    const authored = [[0, 1], [2, 3], [4], [5], [6], [0], [1], [2]];
    expect(programFrameLists(inDirOrder(authored), 7)).toEqual(authored);
    expect(programFrameLists([[0, 5, 9]], HEX_ROW)).toEqual([[0, 5, 9]]);
  });
});
