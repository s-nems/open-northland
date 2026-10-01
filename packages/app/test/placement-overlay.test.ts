import type { NodeGridAnswer } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { NodeGridProbe } from '../src/session/index.js';
import { makeLitOverlaySource } from '../src/view/placement-overlay.js';

const MAP = { width: 8, height: 6 } as const;
const AREA = { minHx: 0, minHy: 0, maxHx: 2 * MAP.width - 1, maxHy: 2 * MAP.height - 1 } as const;
/** `NodeGridAnswer.accepted` values: refused, accepted, and refused on an upgrade's ground. */
const REFUSED = 0;
const ACCEPTED = 1;
const UPGRADE_GROUND = 2;
const GROWTH = { col: 5, row: 4 } as const;
const ROCK = { col: 9, row: 7 } as const;
const camera = { offsetX: 0, offsetY: 0, scale: 1 };
const SCREEN = { width: 1920, height: 1080 };

/** A road probe whose one answer covers the map: the growth node is upgrade ground, the rock refused. */
function roadProbe(): NodeGridProbe {
  const width = AREA.maxHx + 1;
  const accepted = new Uint8Array(width * (AREA.maxHy + 1)).fill(ACCEPTED);
  accepted[GROWTH.row * width + GROWTH.col] = UPGRADE_GROUND;
  accepted[ROCK.row * width + ROCK.col] = REFUSED;
  const answer: NodeGridAnswer = { area: AREA, accepted, key: 'answer' };
  return {
    answerAt: () => answer,
    at: () => null,
    freshAt: () => Promise.resolve(null),
    keyWithin: () => answer.key,
  };
}

describe('the line tool wash', () => {
  it('tints upgrade ground apart from the plain refusals it dims', () => {
    const probe = roadProbe();
    const wash = makeLitOverlaySource(
      { road: () => probe, palisade: () => probe },
      { fogView: () => null },
      MAP,
    );
    const refused = (col: number, row: number): boolean =>
      (col === GROWTH.col && row === GROWTH.row) || (col === ROCK.col && row === ROCK.row);
    const lit = { key: 'lit', has: (col: number, row: number) => !refused(col, row) };

    const frame = wash(lit, { tool: 'road' }, camera, SCREEN.width, SCREEN.height);

    expect(frame?.reserved).toEqual([GROWTH]);
    expect(frame?.blocked).toEqual([ROCK]);
  });
});
