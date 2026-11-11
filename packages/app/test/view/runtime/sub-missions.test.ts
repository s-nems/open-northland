import { type ExportSaveOptions, exportSaveGame, type SaveGame, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../../../sim/test/fixtures/content.js';
import { mainMapReplaySearch } from '../../../src/view/runtime/sub-missions.js';

const sim = new Simulation({ seed: 3, content: testContent() });
const save = (options: ExportSaveOptions): SaveGame => exportSaveGame(sim, options);

describe('mainMapReplaySearch', () => {
  it("replays a nested sub-mission's main map as it was launched, under a new seed", () => {
    const main = save({ mapId: 'saga', entry: '?map=saga&player=1&seed=42&lang=pl' });
    const cave = save({ mapId: 'cave', entry: '?map=cave&player=1&seed=42', parent: main });
    expect(mainMapReplaySearch(save({ mapId: 'isle', entry: '?map=isle&seed=42', parent: cave }))).toBe(
      '?map=saga&player=1&lang=pl',
    );
    expect(mainMapReplaySearch(main)).toBe('?map=saga&player=1&lang=pl');
  });

  it('offers no replay when the main map names no world', () => {
    expect(mainMapReplaySearch(save({}))).toBeNull();
  });
});
