import { expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import {
  decodeMapTransfer,
  encodeMapTransfer,
  readVerifiedMapDocuments,
  verifyMapDocuments,
} from '../../src/content/transfer/index.js';
import { buildMapWorld } from '../../src/entries/map/world.js';
import { AUTHORED_ENTITIES, AUTHORED_ROWS } from '../support/authored-entities.js';
import { authoredMapFile } from '../support/world-maps.js';

it('boots transferred authored map and roster with the same initial and future world hashes', () => {
  const source = verifyMapDocuments('island', authoredMapFile(AUTHORED_ENTITIES), {
    players: [
      { player: 0, type: 'human', tribeId: 1, colorId: 2 },
      { player: 1, type: 'ai', tribeId: 1, colorId: 3 },
    ],
    diplomacy: [{ from: 0, to: 1, state: 'friend' }],
  });
  const received = decodeMapTransfer(encodeMapTransfer(source, { kind: 'user' }), {
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
      aiSeats: [],
      assistantSeats: [],
      playerRoster: script?.players ?? [],
      diplomacy: script?.diplomacy ?? [],
      fog: null,
      needs: null,
      progression: null,
    });
  });
  const [creator, guest] = worlds;
  expect(creator?.kind).toBe('authored');
  expect(guest?.sim.hashState()).toBe(creator?.sim.hashState());
  creator?.sim.run(20);
  guest?.sim.run(20);
  expect(guest?.sim.hashState()).toBe(creator?.sim.hashState());
});
