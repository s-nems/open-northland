import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../../../src/core/loop.js';
import { technologyTable } from '../../../../src/systems/computer-player/technology/requirements.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import {
  FARM_TYPE,
  FARMER,
  FARMER_TRACK,
  MILL_TYPE,
  MILLER,
  MILLER_GATE_REPEATS,
  SCHOOL_TYPE,
  technologyContent,
  VIKING,
} from '../support.js';

describe('technology table', () => {
  it("names a gated workshop's enabling trade, threshold, crediting work and school course", () => {
    const table = technologyTable(technologyContent(), VIKING);
    expect(table?.houses.get(MILL_TYPE)?.jobs).toEqual([
      {
        kind: 'job',
        typeId: MILLER,
        enablingJobs: [FARMER],
        needs: [
          {
            amount: MILLER_GATE_REPEATS,
            tracks: [
              {
                track: FARMER_TRACK,
                job: FARMER,
                work: { kind: 'craft', goods: [], workshops: [FARM_TYPE] },
              },
            ],
          },
        ],
        school: { lessonTicks: MILLER_GATE_REPEATS * TICKS_PER_SECOND, schools: [SCHOOL_TYPE] },
      },
    ]);
  });

  it('is absent for a tribe without a technology table', () => {
    expect(technologyTable(aiContent(), VIKING)).toBeNull();
  });
});
