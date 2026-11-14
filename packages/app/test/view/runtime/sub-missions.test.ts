import { type ExportSaveOptions, exportSaveGame, type SaveGame, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../../../sim/test/fixtures/content.js';
import { replayPlan } from '../../../src/view/runtime/sub-missions.js';

const sim = new Simulation({ seed: 3, content: testContent() });
const save = (options: ExportSaveOptions): SaveGame => exportSaveGame(sim, options);

describe('replayPlan', () => {
  it('replays this map under a new seed with the settings changed in play', () => {
    const params = new URLSearchParams('map=saga&player=1&seed=42&lang=pl');
    const plan = replayPlan(params, undefined);
    params.set('lang', 'eng');
    expect(plan?.scope).toBe('thisMap');
    expect(plan?.search()).toBe('?map=saga&player=1&lang=eng');
  });

  it("replays a nested sub-mission's main map as it launched, with the page's live settings", () => {
    const main = save({ mapId: 'saga', entry: '?map=saga&player=1&seed=42&lang=pl' });
    const cave = save({ mapId: 'cave', entry: '?map=cave&player=1&seed=42&lang=pl', parent: main });
    const params = new URLSearchParams('map=isle&seed=42&lang=pl');
    const plan = replayPlan(params, save({ mapId: 'isle', entry: '?map=isle', parent: cave }));
    params.delete('lang');
    params.set('sound', 'off');
    expect(plan?.scope).toBe('mainMap');
    expect(plan?.search()).toBe('?map=saga&player=1&sound=off');
  });

  it('offers no replay when the main map names no world', () => {
    expect(replayPlan(new URLSearchParams('map=isle'), save({}))).toBeNull();
  });
});
