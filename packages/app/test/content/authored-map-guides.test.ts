import { existsSync, readFileSync } from 'node:fs';
import { TerrainMapFile } from '@open-northland/data';
import { components, nodeOfPosition } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapPath, realMapWorld } from './real-map-world.js';

const MAP_ID = 'polski_mlyn_1_1';

it.runIf(hasRealIr() && existsSync(realMapPath(MAP_ID)))(
  'loads every authored Polski Mlyn guide with its original owner and map point',
  async () => {
    const map = TerrainMapFile.parse(JSON.parse(readFileSync(realMapPath(MAP_ID), 'utf8')));
    const guides = map.entities?.guides ?? [];
    expect(guides.length).toBeGreaterThan(0);
    const { sim } = await realMapWorld({ mapId: MAP_ID, aiSeats: [] });
    const actual = [...sim.world.query(components.Signpost, components.Position, components.Owner)].map(
      (e) => {
        const position = sim.world.get(e, components.Position);
        return {
          player: sim.world.get(e, components.Owner).player,
          ...nodeOfPosition(position.x, position.y),
        };
      },
    );
    expect(actual).toEqual(guides);
  },
);
