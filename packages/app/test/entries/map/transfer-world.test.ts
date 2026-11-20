import { NO_RULE_OVERRIDES } from '@open-northland/lockstep';
import { expect, it } from 'vitest';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import {
  decodeMapTransfer,
  encodeMapTransfer,
  readVerifiedMapDocuments,
  verifyMapDocuments,
} from '../../../src/content/transfer/index.js';
import { buildMapWorld } from '../../../src/entries/map/world.js';
import { AUTHORED_ENTITIES, AUTHORED_ROWS } from '../../support/authored-entities.js';
import { authoredMapFile } from '../../support/world-maps.js';

it('boots transferred authored map and roster with the same world hash', async () => {
  const source = verifyMapDocuments('island', authoredMapFile(AUTHORED_ENTITIES), {
    players: [
      { player: 0, type: 'human', tribeId: 1, colorId: 2 },
      { player: 1, type: 'ai', tribeId: 1, colorId: 3 },
    ],
    diplomacy: [{ from: 0, to: 1, state: 'friend' }],
  });
  const received = await decodeMapTransfer(await encodeMapTransfer(source, { kind: 'user' }), {
    mapId: 'island',
    fingerprint: source.fingerprint,
    provenance: { kind: 'user' },
  });
  const worlds = [source, received].map((handle) => {
    const { map, script } = readVerifiedMapDocuments(handle);
    return buildMapWorld({
      map,
      ir: AUTHORED_ROWS as ContentIr,
      content: {},
      seed: 7,
      machineSeats: [],
      assistantSeats: [],
      playerRoster: script?.players ?? [],
      diplomacy: script?.diplomacy ?? [],
      ...NO_RULE_OVERRIDES,
    });
  });
  const [creator, guest] = worlds;
  expect(creator?.kind).toBe('authored');
  expect(guest?.sim.hashState()).toBe(creator?.sim.hashState());
});
