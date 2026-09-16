import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTerrainMap } from '@open-northland/data';
import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildCollisionTerrain, type CollisionIrView } from '../../src/content/collision.js';
import { newWorldSim } from '../../src/game/world/build.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

const { FishSwarm, Position } = components;

describe.runIf(hasRealIr())('authored map fish swarms', () => {
  it('carries one real decoded lafm table through terrain assembly into persistent sim entities', async () => {
    const mapsDir = resolve(contentDir(), 'maps');
    const files = readdirSync(mapsDir)
      .filter((name) => name.endsWith('.json') && !name.slice(0, -'.json'.length).includes('.'))
      .sort();
    const authored = files
      .map((name) => parseTerrainMap(JSON.parse(readFileSync(resolve(mapsDir, name), 'utf8'))))
      .find((map) => (map.fishSwarms?.length ?? 0) > 0);
    if (authored === undefined || authored.fishSwarms === undefined) {
      throw new Error('fresh content contains no populated authored fish table');
    }

    const { merge } = await loadContentUnderTest();
    const terrain = buildCollisionTerrain(authored, rawIrUnderTest() as CollisionIrView);
    const sim = newWorldSim(1, terrain, merge.content);
    const entities = [...sim.world.query(FishSwarm, Position)];

    expect(entities).toHaveLength(authored.fishSwarms.length);
    const first = entities[0];
    const source = authored.fishSwarms[0];
    if (first === undefined || source === undefined) throw new Error('first authored swarm missing');
    expect(sim.world.get(first, FishSwarm)).toMatchObject({
      count: source.count,
      continent: source.continent,
    });
  });
});
