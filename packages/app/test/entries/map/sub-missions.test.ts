import { MapScript } from '@open-northland/data';
import { exportSaveGame, parseSaveGame, serializeSaveGame } from '@open-northland/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import * as mapLoader from '../../../src/content/map/loader.js';
import * as mapsIndex from '../../../src/content/map/maps-index.js';
import { mapSubMissionLoader, validateSavedMap } from '../../../src/entries/map/sub-missions.js';
import { buildMapWorld } from '../../../src/entries/map/world.js';
import { AUTHORED_ENTITIES, AUTHORED_ROWS } from '../../support/authored-entities.js';
import { TINY_FINGERPRINT } from '../../support/catalog-maps.js';
import { authoredMapFile } from '../../support/world-maps.js';

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
    machineSeats: [],
    assistantSeats: [],
    fog: null,
    needs: null,
    alliedVision: null,
    peace: null,
    storageCapacity: null,
    missions: null,
    progression: null,
  });
  sim.run(5);
  return exportSaveGame(sim, { mapId: 'parent', entry: '?map=parent&lang=pl' });
}

beforeEach(() => {
  vi.spyOn(mapsIndex, 'loadMapList').mockResolvedValue([
    {
      id: 'child',
      fingerprint: TINY_FINGERPRINT,
      picture: false,
      minimap: false,
      campaign: { campaignId: 0, missionId: 91 },
    },
  ]);
  vi.spyOn(mapLoader, 'loadTerrainMap').mockResolvedValue(map);
  vi.spyOn(mapLoader, 'loadMapScript').mockResolvedValue(source);
});
afterEach(() => vi.restoreAllMocks());

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
  });

  it('refuses ambiguous or missing target pairs, missing parents and changed terrain before handover', async () => {
    const load = mapSubMissionLoader(inputs);
    const parent = parentSave();
    await expect(load({ kind: 'start', campaignId: 2, mapId: 91, mission: 0 }, parent)).rejects.toThrow(
      'found 0',
    );
    const pair = { campaignId: 0, missionId: 91 };
    vi.mocked(mapsIndex.loadMapList).mockResolvedValue([
      { id: 'child', fingerprint: TINY_FINGERPRINT, picture: false, minimap: false, campaign: pair },
      { id: 'twin', fingerprint: TINY_FINGERPRINT, picture: false, minimap: false, campaign: pair },
    ]);
    await expect(load({ kind: 'start', campaignId: 0, mapId: 91, mission: 0 }, parent)).rejects.toThrow(
      'found 2',
    );
    await expect(load({ kind: 'end', mission: 0 }, parent)).rejects.toThrow('No parent');
    await expect(
      validateSavedMap(inputs, { ...parent, header: { ...parent.header, mapFingerprint: 'bad' } }),
    ).rejects.toThrow('mapFingerprint');
  });

  it('passes a scene save without fetching map content: a scene builds its world from code', async () => {
    const parent = parentSave();
    await expect(
      validateSavedMap(inputs, { ...parent, header: { ...parent.header, mapId: 'scene:goods-catalog' } }),
    ).resolves.toBeUndefined();
    expect(mapLoader.loadTerrainMap).not.toHaveBeenCalled();
  });
});
