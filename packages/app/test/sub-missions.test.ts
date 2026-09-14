import { MapScript } from '@open-northland/data';
import { exportSaveGame, parseSaveGame, serializeSaveGame } from '@open-northland/sim';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import { loadMapScript, loadTerrainMap } from '../src/content/map-loader.js';
import { loadMapList } from '../src/content/maps-index.js';
import { mapSubMissionLoader, validateSavedMap } from '../src/entries/map/sub-missions.js';
import { buildMapWorld } from '../src/entries/map/world.js';
import { evaluateSaveFile } from '../src/view/runtime/save-load/evaluate.js';
import { AUTHORED_ENTITIES, AUTHORED_ROWS } from './support/authored-entities.js';
import { authoredMapFile } from './support/world-maps.js';

vi.mock('../src/content/map-loader.js', () => ({
  loadTerrainMap: vi.fn(),
  loadMapScript: vi.fn(),
}));
vi.mock('../src/content/maps-index.js', () => ({ loadMapList: vi.fn() }));

const inputs = {
  ir: AUTHORED_ROWS as ContentIr,
  content: {},
  params: new URLSearchParams('map=parent&lang=pl'),
};
const map = authoredMapFile(AUTHORED_ENTITIES);
const source = MapScript.parse({ players: [], diplomacy: [], missions: [] });
function parentSave() {
  const { sim } = buildMapWorld({
    ...inputs,
    map,
    seed: 7,
    aiSeats: [],
    assistantSeats: [],
    fog: null,
    needs: null,
    missions: null,
    progression: null,
  });
  sim.run(5);
  return exportSaveGame(sim, { mapId: 'parent', entry: '?map=parent&lang=pl' });
}

beforeEach(() => {
  vi.mocked(loadMapList).mockResolvedValue([
    { id: 'child', minimap: false, campaign: { campaignId: 0, missionId: 91 } },
  ]);
  vi.mocked(loadTerrainMap).mockResolvedValue(map);
  vi.mocked(loadMapScript).mockResolvedValue(source);
});

describe('map sub-mission worlds', () => {
  it('resolves campaign zero, embeds a detached parent and returns to its complete save after serialization', async () => {
    const parent = parentSave();
    const load = mapSubMissionLoader(inputs);
    const child = await load({ kind: 'start', campaignId: 0, mapId: 91, mission: 0 }, parent);
    expect(child.header.mapId).toBe('child');
    expect(child.parent).toEqual(parent);
    expect(child.parent).not.toBe(parent);
    const saved = parseSaveGame(JSON.parse(serializeSaveGame(child)));
    const returned = await load({ kind: 'end', mission: 1 }, saved);
    expect(returned).toEqual(parent);
    expect(returned.parent).toBeUndefined();
    expect(
      evaluateSaveFile(serializeSaveGame(saved), {
        worldToken: 'parent',
        rootWorldToken: 'parent',
        irVersion: parent.header.irVersion,
        mapFingerprint: parent.header.mapFingerprint,
      }),
    ).toEqual({ ok: true, save: saved });
    expect(
      evaluateSaveFile(serializeSaveGame(saved), {
        worldToken: 'other',
        rootWorldToken: 'other',
        irVersion: parent.header.irVersion,
        mapFingerprint: parent.header.mapFingerprint,
      }),
    ).toEqual({ ok: false, reason: 'wrongWorld' });
  });

  it('refuses ambiguous or missing target pairs, missing parents and changed terrain before handover', async () => {
    const load = mapSubMissionLoader(inputs);
    const parent = parentSave();
    await expect(load({ kind: 'start', campaignId: 2, mapId: 91, mission: 0 }, parent)).rejects.toThrow(
      'found 0',
    );
    const pair = { campaignId: 0, missionId: 91 };
    vi.mocked(loadMapList).mockResolvedValue([
      { id: 'child', minimap: false, campaign: pair },
      { id: 'twin', minimap: false, campaign: pair },
    ]);
    await expect(load({ kind: 'start', campaignId: 0, mapId: 91, mission: 0 }, parent)).rejects.toThrow(
      'found 2',
    );
    await expect(load({ kind: 'end', mission: 0 }, parent)).rejects.toThrow('No parent');
    await expect(
      validateSavedMap(inputs, { ...parent, header: { ...parent.header, mapFingerprint: 'bad' } }),
    ).rejects.toThrow('mapFingerprint');
  });
});
